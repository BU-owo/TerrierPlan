import { useState, useEffect, useRef, useCallback } from 'react';
import { signOut } from 'firebase/auth';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  documentId,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import PlanSelector from '../components/planner/PlanSelector';
import CourseSearch from '../components/planner/CourseSearch';
import SemesterBoard from '../components/planner/SemesterBoard';
import CourseCard from '../components/planner/CourseCard';
import SidePanelTabs from '../components/planner/SidePanelTabs';
import BulletinPanel from '../components/planner/BulletinPanel';
import ImportTranscriptModal from '../components/planner/ImportTranscriptModal';
import ExtraTermsPanel from '../components/planner/ExtraTermsPanel';
import ExternalCreditsPanel from '../components/planner/ExternalCreditsPanel';
import { normalizeExternalCredits, normalizeExternalCredit } from '../utils/externalCredits';
import './planner.css';
import '../App.css';

const EMPTY_SEMESTERS = () => Array.from({ length: 8 }, () => []);
const LOCAL_STORAGE_KEY = 'terrierplan_session';

// Firestore rejects arrays nested directly inside arrays, so `semesters`
// (array of arrays of courseKeys) can't be written as-is. Store it as an
// object keyed by semester index instead; these two helpers are the only
// places that should ever cross the array ⇄ object boundary.
function semestersToFirestore(semesters) {
  return (semesters || EMPTY_SEMESTERS()).reduce((obj, courseKeys, i) => {
    obj[i] = courseKeys;
    return obj;
  }, {});
}

function semestersFromFirestore(stored) {
  if (Array.isArray(stored)) return stored; // tolerate any pre-fix docs written before this migration
  if (!stored) return EMPTY_SEMESTERS();
  const length = Math.max(8, ...Object.keys(stored).map((k) => Number(k) + 1));
  return Array.from({ length }, (_, i) => stored[i] ?? []);
}

// Shared across Strict Mode double-invokes of the auth effect so we only
// migrate (and clear localStorage) once per guest session → sign-in.
let guestMigrationPromise = null;
const DEBUG_IMPORT = import.meta.env.DEV;

function debugPlanner(stage, payload) {
  if (!DEBUG_IMPORT) return;
  console.log(`[DEBUG PlannerPage] ${stage}`, payload);
}

export default function PlannerPage({ theme = 'light', onToggleTheme }) {
  const { user, loading: authLoading } = useAuth();

  // ── Plan list ─────────────────────────────────────────────────────────────
  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [planName, setPlanName] = useState('My Plan');
  const [semesters, setSemesters] = useState(EMPTY_SEMESTERS);
  const [isTransfer, setIsTransfer] = useState(false);
  const [majorBulletinUrl, setMajorBulletinUrl] = useState(null);
  const [extraTerms, setExtraTerms] = useState([]);
  const [externalCredits, setExternalCredits] = useState([]);
  const [cumulativeGpa, setCumulativeGpa] = useState(null);
  const [earnedCredits, setEarnedCredits] = useState(null);
  const [gradePoints, setGradePoints] = useState(null);

  // ── Course data caches ────────────────────────────────────────────────────
  const [courseMap, setCourseMap] = useState({}); // courseKey → course doc
  const [creditsMap, setCreditsMap] = useState({}); // courseKey → credits

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeSemIndex, setActiveSemIndex] = useState(0);
  // Which single panel is shown on narrow/mobile screens: 'search' | 'board' | 'hub'
  const [mobileView, setMobileView] = useState('board');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'saved' | 'error' | ''
  const [isDirty, setIsDirty] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverlay, setDragOverlay] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deletePlanId, setDeletePlanId] = useState(null); // non-null → confirm-delete modal open for this plan id

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const saveTimeoutRef = useRef(null);
  const isInitialLoad = useRef(true);
  const hasUnsavedChanges = useRef(false);
  const pendingLeaveAction = useRef(null);

  // ── Load plans on sign-in (and migrate any guest plan first) ──────────────
  useEffect(() => {
    if (authLoading) return; // Wait for auth to load

    let cancelled = false;

    async function migrateGuestPlanIfNeeded(uid) {
      // Deduplicate concurrent calls (React Strict Mode remounts the effect)
      if (!guestMigrationPromise) {
        const guestRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!guestRaw) {
          guestMigrationPromise = Promise.resolve(null);
        } else {
          // Claim immediately so a sibling effect cannot also migrate / createDefault
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          guestMigrationPromise = (async () => {
            try {
              const parsedGuest = JSON.parse(guestRaw);
              return await migrateGuestPlan(uid, parsedGuest);
            } catch (err) {
              console.error('Error migrating guest plan:', err);
              localStorage.setItem(LOCAL_STORAGE_KEY, guestRaw);
              guestMigrationPromise = null; // allow retry on next sign-in attempt
              return null;
            }
          })();
        }
      }
      return guestMigrationPromise;
    }

    async function initForUser(uid) {
      // 1. Migrate guest plan BEFORE loadPlans/createDefaultPlan
      const migratedId = await migrateGuestPlanIfNeeded(uid);
      if (cancelled) return;

      // 2. Load existing plans (migrated doc is additive — never overwrites)
      let list = [];
      try {
        list = await loadPlans(uid);
      } catch (err) {
        console.error('Error loading plans:', err);
        return;
      }
      if (cancelled) return;

      if (migratedId) {
        await loadPlan(uid, migratedId, list);
      } else if (list.length === 0) {
        await createDefaultPlan(uid);
      } else {
        await loadPlan(uid, list[0].id, list);
      }
    }

    if (user) {
      initForUser(user.uid);
    } else {
      // Signed out — allow a future sign-in to migrate a new guest plan
      guestMigrationPromise = null;
      loadLocalPlan();
      isInitialLoad.current = false;
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, authLoading]);

  // ── Keep hasUnsavedChanges ref in sync with isDirty ───────────────────────
  useEffect(() => {
    hasUnsavedChanges.current = isDirty;
  }, [isDirty]);

  // ── Warn before losing unsaved changes (tab close / refresh) ───────────────
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!hasUnsavedChanges.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ── In-app leave confirmation ─────────────────────────────────────────────
  function requestLeave(action) {
    if (!hasUnsavedChanges.current) {
      action();
      return;
    }
    pendingLeaveAction.current = action;
    setShowLeaveModal(true);
  }

  function handleStay() {
    pendingLeaveAction.current = null;
    setShowLeaveModal(false);
  }

  function handleLeaveAnyway() {
    const action = pendingLeaveAction.current;
    pendingLeaveAction.current = null;
    setShowLeaveModal(false);
    // Flush guest plan so sign-in migration has the latest board state
    if (!user) saveLocalPlan();
    // Clear dirty so beforeunload does not also fire on programmatic navigation
    hasUnsavedChanges.current = false;
    setIsDirty(false);
    action?.();
  }

  function handleInternalLinkClick(e) {
    const anchor = e.target.closest?.('a[href]');
    if (!anchor || !hasUnsavedChanges.current) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }

    // Only intercept same-origin / relative navigations
    let url;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) return;

    e.preventDefault();
    requestLeave(() => {
      window.location.href = url.href;
    });
  }

  // ── Autosave on change ────────────────────────────────────────────────────
  useEffect(() => {
    if (isInitialLoad.current || !isDirty || !user) {
      if (!user) console.log('⏭️  [autosave] Skipped: not logged in');
      if (!isDirty) console.log('⏭️  [autosave] Skipped: no dirty changes');
      if (isInitialLoad.current) console.log('⏭️  [autosave] Skipped: initial load');
      return;
    }

    console.log('⏲️  [autosave] Debounce scheduled for 1500ms');
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      console.log('⏱️  [autosave] Debounce fired, calling persistPlan');
      if (activePlanId) {
        persistPlan(user.uid, activePlanId, planName, semesters, isTransfer, {
          extraTerms,
          externalCredits,
          cumulativeGpa,
          earnedCredits,
          gradePoints,
          majorBulletinUrl,
        });
      } else {
        console.warn('⚠️  [autosave] activePlanId is null, skipping save');
      }
    }, 1500);

    return () => {
      clearTimeout(saveTimeoutRef.current);
      console.log('🧹 [autosave] Cleaning up timeout');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesters, planName, isTransfer, isDirty, extraTerms, externalCredits, cumulativeGpa, earnedCredits, gradePoints, majorBulletinUrl]);

  // ── Guest: persist to localStorage after React commits the new state ──────
  // Handlers used to call saveLocalPlan() immediately after setSemesters(),
  // which wrote the *previous* board (stale closure) — so the last course
  // change was never stored, and a single-course plan looked "lost" on sign-in.
  useEffect(() => {
    if (user || authLoading || isInitialLoad.current || !isDirty) return;
    saveLocalPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesters, planName, isTransfer, isDirty, extraTerms, externalCredits, cumulativeGpa, earnedCredits, gradePoints, majorBulletinUrl, user, authLoading]);

  // ── Local plan management (for auth-optional browsing) ─────────────────────
  function saveLocalPlan(overrides = {}) {
    const normalizedExternalCredits = normalizeExternalCredits(overrides.externalCredits ?? externalCredits);
    const plan = {
      name: overrides.name ?? planName,
      major: overrides.major ?? '',
      majorBulletinUrl: overrides.majorBulletinUrl ?? majorBulletinUrl,
      semesters: overrides.semesters ?? semesters,
      isTransfer: overrides.isTransfer ?? isTransfer,
      extraTerms: overrides.extraTerms ?? extraTerms,
      externalCredits: normalizedExternalCredits,
      cumulativeGpa: overrides.cumulativeGpa ?? cumulativeGpa,
      earnedCredits: overrides.earnedCredits ?? earnedCredits,
      gradePoints: overrides.gradePoints ?? gradePoints,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(plan));
    debugPlanner('saveLocalPlan-written', {
      transferCredits: normalizedExternalCredits.filter((c) => c?.type === 'transfer'),
      externalCredits: normalizedExternalCredits,
    });
    try {
      const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
      debugPlanner('saveLocalPlan-readback', {
        transferCredits: (stored.externalCredits || []).filter((c) => c?.type === 'transfer'),
        externalCredits: stored.externalCredits || [],
      });
    } catch (err) {
      console.error('[DEBUG PlannerPage] saveLocalPlan-readback-parse-failed', err);
    }
  }

  function loadLocalPlan() {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const plan = JSON.parse(stored);
        setPlanName(plan.name || 'My Plan');
        setSemesters(plan.semesters || EMPTY_SEMESTERS());
        setIsTransfer(plan.isTransfer || false);
        setMajorBulletinUrl(plan.majorBulletinUrl ?? null);
        setExtraTerms(plan.extraTerms || []);
        const normalizedExternalCredits = normalizeExternalCredits(plan.externalCredits);
        setExternalCredits(normalizedExternalCredits);
        debugPlanner('loadLocalPlan-read', {
          transferCredits: normalizedExternalCredits.filter((c) => c?.type === 'transfer'),
          externalCredits: normalizedExternalCredits,
        });
        setCumulativeGpa(plan.cumulativeGpa ?? null);
        setEarnedCredits(plan.earnedCredits ?? null);
        setGradePoints(plan.gradePoints ?? null);
        setIsDirty(false);
        const extraKeys = (plan.extraTerms || []).flatMap((t) => t.courseKeys || []);
        const allKeys = [...(plan.semesters || []).flat(), ...extraKeys];
        if (allKeys.length > 0) fetchCourseData(allKeys);
      }
    } catch (err) {
      console.error('Error loading local plan:', err);
    }
  }

  async function migrateGuestPlan(uid, guestPlan) {
    const name = await uniquePlanName(uid, guestPlan.name || 'Imported Plan');
    // Always addDoc — never overwrite an existing saved plan
    const ref = await addDoc(collection(db, 'users', uid, 'plans'), {
      name,
      major: guestPlan.major || '',
      majorBulletinUrl: guestPlan.majorBulletinUrl ?? null,
      semesters: semestersToFirestore(guestPlan.semesters),
      isTransfer: guestPlan.isTransfer || false,
      extraTerms: guestPlan.extraTerms || [],
      externalCredits: normalizeExternalCredits(guestPlan.externalCredits),
      cumulativeGpa: guestPlan.cumulativeGpa ?? null,
      earnedCredits: guestPlan.earnedCredits ?? null,
      gradePoints: guestPlan.gradePoints ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    console.log('✅ Guest plan migrated to Firestore:', ref.id);
    return ref.id;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Appends the lowest unused " N" suffix (starting at 2) if baseName already
  // exists among this user's plans, so new plans never share a display name.
  async function uniquePlanName(uid, baseName) {
    const snap = await getDocs(collection(db, 'users', uid, 'plans'));
    const existingNames = new Set(snap.docs.map((d) => d.data().name));
    if (!existingNames.has(baseName)) return baseName;
    let n = 2;
    while (existingNames.has(`${baseName} ${n}`)) n++;
    return `${baseName} ${n}`;
  }

  async function loadPlans(uid) {
    const q = query(
      collection(db, 'users', uid, 'plans'),
      orderBy('updatedAt', 'desc'),
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setPlans(list);
    return list;
  }

  async function loadPlan(uid, planId, list) {
    isInitialLoad.current = true;
    const snap = await getDoc(doc(db, 'users', uid, 'plans', planId));
    if (!snap.exists()) return;
    const data = snap.data();
    const semData = semestersFromFirestore(data.semesters);
    const extra = data.extraTerms ?? [];
    const normalizedExternalCredits = normalizeExternalCredits(data.externalCredits);
    debugPlanner('loadPlan-from-firestore', {
      planId,
      transferCredits: normalizedExternalCredits.filter((c) => c?.type === 'transfer'),
      externalCredits: normalizedExternalCredits,
    });
    setActivePlanId(planId);
    setPlanName(data.name ?? 'My Plan');
    setSemesters(semData);
    setIsTransfer(data.isTransfer ?? false);
    setMajorBulletinUrl(data.majorBulletinUrl ?? null);
    setExtraTerms(extra);
    setExternalCredits(normalizedExternalCredits);
    setCumulativeGpa(data.cumulativeGpa ?? null);
    setEarnedCredits(data.earnedCredits ?? null);
    setGradePoints(data.gradePoints ?? null);
    setIsDirty(false);
    if (list) setPlans(list);
    const allKeys = [
      ...semData.flat(),
      ...extra.flatMap((t) => t.courseKeys || []),
    ];
    if (allKeys.length > 0) {
      await fetchCourseData(allKeys);
    }
    isInitialLoad.current = false;
  }

  async function createDefaultPlan(uid) {
    isInitialLoad.current = true;
    const name = await uniquePlanName(uid, 'My Plan');
    const ref = await addDoc(collection(db, 'users', uid, 'plans'), {
      name,
      major: '',
      majorBulletinUrl: null,
      semesters: semestersToFirestore(EMPTY_SEMESTERS()),
      isTransfer: false,
      extraTerms: [],
      externalCredits: [],
      cumulativeGpa: null,
      earnedCredits: null,
      gradePoints: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActivePlanId(ref.id);
    setPlanName(name);
    setSemesters(EMPTY_SEMESTERS());
    setIsTransfer(false);
    setMajorBulletinUrl(null);
    setExtraTerms([]);
    setExternalCredits([]);
    setCumulativeGpa(null);
    setEarnedCredits(null);
    setGradePoints(null);
    setPlans([{ id: ref.id, name }]);
    setIsDirty(false);
    isInitialLoad.current = false;
  }

  async function persistPlan(uid, planId, name, semData, transfer, extras = {}) {
    setSaving(true);
    const debugLog = {
      timestamp: new Date().toISOString(),
      uid,
      planId,
      name,
      semesterCount: semData.length,
      totalCoursesInPlan: semData.flat().length,
      isTransfer: transfer,
    };

    try {
      console.log('🔄 [persistPlan] Starting save:', debugLog);

      if (!uid) throw new Error('Missing uid');
      if (!planId) throw new Error('Missing planId');

      const planRef = doc(db, 'users', uid, 'plans', planId);
      console.log('📍 [persistPlan] Plan ref path:', planRef.path);

      const payload = {
        name,
        semesters: semestersToFirestore(semData),
        isTransfer: transfer,
        majorBulletinUrl: extras.majorBulletinUrl ?? majorBulletinUrl,
        extraTerms: extras.extraTerms ?? extraTerms,
        externalCredits: normalizeExternalCredits(extras.externalCredits ?? externalCredits),
        cumulativeGpa: extras.cumulativeGpa ?? cumulativeGpa,
        earnedCredits: extras.earnedCredits ?? earnedCredits,
        gradePoints: extras.gradePoints ?? gradePoints,
        updatedAt: serverTimestamp(),
      };

      console.log('💾 [persistPlan] Sending payload:', {
        ...payload,
        updatedAt: '(server-timestamp)',
      });
      debugPlanner('persistPlan-payload', {
        planId,
        transferCredits: (payload.externalCredits || []).filter((c) => c?.type === 'transfer'),
        externalCredits: payload.externalCredits || [],
      });

      await updateDoc(planRef, payload);

      const writtenSnap = await getDoc(planRef);
      const written = writtenSnap.exists() ? writtenSnap.data() : null;
      debugPlanner('persistPlan-firestore-readback', {
        planId,
        transferCredits: (written?.externalCredits || []).filter((c) => c?.type === 'transfer'),
        externalCredits: written?.externalCredits || [],
      });

      console.log('✅ [persistPlan] Write succeeded');
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2500);
      setIsDirty(false);
      return true;
    } catch (err) {
      const errorDetails = {
        message: err.message,
        code: err.code,
        stack: err.stack,
      };
      console.error('❌ [persistPlan] Write failed:', errorDetails);
      console.error('🔍 [persistPlan] Debug log:', debugLog);

      if (err.code === 'permission-denied') {
        console.error('⚠️  Permission denied — check Firestore rules and authentication');
      } else if (err.code === 'unauthenticated') {
        console.error('⚠️  User not authenticated — check auth state');
      } else if (err.code === 'failed-precondition') {
        console.error('⚠️  Failed precondition — possible document doesn\'t exist');
      }

      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Fetch course docs (batched, up to 30 per query)
  const fetchCourseData = useCallback(
    async (courseKeys) => {
      const missing = courseKeys.filter((k) => !courseMap[k]);
      if (missing.length === 0) return;

      const newCourses = {};
      for (let i = 0; i < missing.length; i += 30) {
        const batch = missing.slice(i, i + 30);
        const q = query(
          collection(db, 'courses'),
          where(documentId(), 'in', batch),
        );
        const snap = await getDocs(q);
        snap.docs.forEach((d) => { newCourses[d.id] = d.data(); });
      }
      setCourseMap((prev) => ({ ...prev, ...newCourses }));
      fetchCredits(Object.keys(newCourses));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseMap],
  );

  // Fetch credits from sections (batched)
  async function fetchCredits(courseKeys) {
    const missing = courseKeys.filter((k) => !(k in creditsMap));
    if (missing.length === 0) return;
    const newCredits = {};
    for (let i = 0; i < missing.length; i += 30) {
      const batch = missing.slice(i, i + 30);
      const snap = await getDocs(
        query(collection(db, 'sections'), where('courseKey', 'in', batch)),
      );
      snap.docs.forEach((d) => {
        const { courseKey, credits } = d.data();
        if (!(courseKey in newCredits) && credits != null) {
          newCredits[courseKey] = credits;
        }
      });
    }
    setCreditsMap((prev) => ({ ...prev, ...newCredits }));
  }

  // ── Plan CRUD callbacks ───────────────────────────────────────────────────

  function handleSelectPlan(planId) {
    if (planId === activePlanId) return;
    loadPlan(user.uid, planId, null);
  }

  async function handleNewPlan() {
    await createDefaultPlan(user.uid);
    // reload the full plan list
    loadPlans(user.uid);
  }

  function handleRenamePlan(newName) {
    setPlanName(newName);
    setIsDirty(true);
    // update plans list label locally
    setPlans((prev) =>
      prev.map((p) => (p.id === activePlanId ? { ...p, name: newName } : p)),
    );
  }

  function requestDeletePlan(planId) {
    setDeletePlanId(planId);
  }

  function cancelDeletePlan() {
    setDeletePlanId(null);
  }

  async function confirmDeletePlan() {
    const planId = deletePlanId;
    setDeletePlanId(null);
    await handleDeletePlan(planId);
  }

  async function handleDeletePlan(planId) {
    await deleteDoc(doc(db, 'users', user.uid, 'plans', planId));
    const remaining = plans.filter((p) => p.id !== planId);
    if (remaining.length === 0) {
      await createDefaultPlan(user.uid);
    } else {
      await loadPlan(user.uid, remaining[0].id, remaining);
    }
  }

  // ── Board callbacks ───────────────────────────────────────────────────────

  function handleAddCourse(courseKey, semIndex) {
    const alreadyPlaced = semesters.some((sem) => sem.includes(courseKey));
    if (alreadyPlaced) return;
    setSemesters((prev) => {
      const next = prev.map((s) => [...s]);
      next[semIndex] = [...next[semIndex], courseKey];
      return next;
    });
    setIsDirty(true);
    if (!courseMap[courseKey]) fetchCourseData([courseKey]);
    // On mobile the board is a separate tab from search — jump over so the
    // user can see the course land in its semester.
    setMobileView('board');
  }

  function handleMoveCourse(courseKey, fromSem, toSem) {
    setSemesters((prev) => {
      const next = prev.map((s) => [...s]);
      next[fromSem] = next[fromSem].filter((k) => k !== courseKey);
      next[toSem] = [...next[toSem], courseKey];
      return next;
    });
    setIsDirty(true);
  }

  function handleRemoveCourse(courseKey, semIndex) {
    setSemesters((prev) => {
      const next = prev.map((s) => [...s]);
      next[semIndex] = next[semIndex].filter((k) => k !== courseKey);
      return next;
    });
    setIsDirty(true);
  }

  function handleDragStart({ active }) {
    const courseKey = active.data.current?.courseKey ?? active.id;
    setDraggingId(active.id);
    setDragOverlay({
      courseKey,
      data: active.data.current?.course ?? courseMap[courseKey],
      credits: creditsMap[courseKey],
    });
  }

  function handleDragEnd({ active, over }) {
    setDraggingId(null);
    setDragOverlay(null);
    if (!over) return;

    const match = String(over.id).match(/^col-(\d+)$/);
    if (!match) return;
    const destIndex = parseInt(match[1], 10);
    const courseKey = active.data.current?.courseKey ?? active.id;
    const from = active.data.current?.from;

    if (from === 'search') {
      handleAddCourse(courseKey, destIndex);
      return;
    }

    const srcIndex = semesters.findIndex((sem) => sem.includes(courseKey));
    if (srcIndex === -1 || srcIndex === destIndex) return;
    handleMoveCourse(courseKey, srcIndex, destIndex);
  }

  function handleDragCancel() {
    setDraggingId(null);
    setDragOverlay(null);
  }

  function handleToggleTransfer(val) {
    setIsTransfer(val);
    setIsDirty(true);
  }

  function handleMajorSelect(url) {
    setMajorBulletinUrl(url || null);
    setIsDirty(true);
  }

  async function handleTranscriptImport(result) {
    const normalizedExternalCredits = normalizeExternalCredits(result.externalCredits);
    debugPlanner('handleTranscriptImport-result', {
      transferCredits: normalizedExternalCredits.filter((c) => c?.type === 'transfer'),
      externalCredits: normalizedExternalCredits,
      summary: result.summary,
    });
    const importedCourseKeys = [
      ...result.semesters.flat(),
      ...result.extraTerms.flatMap((term) => term.courseKeys || []),
    ];

    setSemesters(result.semesters);
    setExtraTerms(result.extraTerms);
    setExternalCredits(normalizedExternalCredits);
    setCumulativeGpa(result.cumulativeGpa);
    setEarnedCredits(result.earnedCredits);
    setGradePoints(result.gradePoints);
    setIsDirty(true);

    if (importedCourseKeys.length > 0) {
      fetchCourseData(importedCourseKeys).catch((err) => {
        console.error('Error loading imported course details:', err);
      });
    }

    if (user && activePlanId) {
      const saved = await persistPlan(user.uid, activePlanId, planName, result.semesters, isTransfer, {
        extraTerms: result.extraTerms,
        externalCredits: normalizedExternalCredits,
        cumulativeGpa: result.cumulativeGpa,
        earnedCredits: result.earnedCredits,
        gradePoints: result.gradePoints,
      });
      if (!saved) throw new Error('Could not save imported transcript');
    } else {
      // Avoid stale React state when saving a guest import.
      saveLocalPlan({
        semesters: result.semesters,
        extraTerms: result.extraTerms,
        externalCredits: normalizedExternalCredits,
        cumulativeGpa: result.cumulativeGpa,
        earnedCredits: result.earnedCredits,
        gradePoints: result.gradePoints,
      });
    }
  }

  function handleRemoveExtraTermCourse(term, courseKey) {
    setExtraTerms((prev) => prev
      .map((extraTerm) => extraTerm.term === term
        ? { ...extraTerm, courseKeys: extraTerm.courseKeys.filter((key) => key !== courseKey) }
        : extraTerm)
      .filter((extraTerm) => extraTerm.courseKeys.length > 0));
    setIsDirty(true);
  }

  function handleRemoveExternalCredit(creditIdOrIndex) {
    setExternalCredits((prev) => {
      if (typeof creditIdOrIndex === 'number') {
        return prev.filter((_, creditIndex) => creditIndex !== creditIdOrIndex);
      }
      return prev.filter((credit) => credit?.id !== creditIdOrIndex);
    });
    setIsDirty(true);
  }

  function handleUpdateExternalCredit(creditIdOrIndex, patch) {
    setExternalCredits((prev) => prev.map((credit, creditIndex) => {
      const matches = typeof creditIdOrIndex === 'number'
        ? creditIndex === creditIdOrIndex
        : credit?.id === creditIdOrIndex;
      return matches
        ? (normalizeExternalCredit({ ...credit, ...patch }) || { ...credit, ...patch })
        : credit;
    }));
    setIsDirty(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const extraCourseKeys = extraTerms.flatMap((term) => term.courseKeys || []);
  const coursesInPlan = new Set([...semesters.flat(), ...extraCourseKeys]);

  // Unlike HUB (which excludes externalCredits entirely), the requirements
  // engine should see transfer/AP-equivalent courses too — they can satisfy
  // a major requirement even though they never count toward HUB.
  const requirementsCourseKeys = [
    ...semesters.flat(),
    ...extraCourseKeys,
    ...externalCredits.map((c) => c?.courseKey).filter(Boolean),
  ];

  const planCourseCredits = [...semesters.flat(), ...extraCourseKeys]
    .reduce((sum, key) => sum + (creditsMap[key] ?? 0), 0);

  const externalCreditTotal = (externalCredits || []).reduce((sum, credit) => {
    if (!credit) return sum;
    const creditValue = Number(credit.credits);
    if (!Number.isFinite(creditValue)) return sum;

    if (credit.type === 'ap' || credit.type === 'ib') {
      return sum + creditValue;
    }

    if (credit.type === 'transfer') {
      const mapped = Boolean(String(credit.courseKey || '').trim());
      return mapped ? sum + creditValue : sum;
    }

    return sum;
  }, 0);

  const totalCredits = planCourseCredits + externalCreditTotal;

  if (authLoading) {
    return (
      <div className="auth-loading">
        <img
          className="auth-loading-paw"
          src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
          alt="TerrierPlan"
          width={32}
          height={32}
        />
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="planner-layout" onClickCapture={handleInternalLinkClick}>
      {/* ── Header ── */}
      <header className="planner-header">
        <div className="planner-header-logo">
          <img
            src="/faviconred.png"
            alt=""
            width={18}
            height={18}
          />
          TerrierPlan
        </div>

        <div className="planner-header-center">
          {user ? (
            <>
              <PlanSelector
                plans={plans}
                activePlanId={activePlanId}
                planName={planName}
                saving={saving}
                saveStatus={saveStatus}
                onSelectPlan={handleSelectPlan}
                onRenamePlan={handleRenamePlan}
                onNewPlan={handleNewPlan}
                onDeletePlan={requestDeletePlan}
              />

              {totalCredits > 0 && (
                <span className="planner-credits-badge">
                  {totalCredits} cr total
                </span>
              )}
            </>
          ) : (
            <div className="planner-guest-label">
              Browsing as guest — sign in to save your plans
            </div>
          )}
          <button
            type="button"
            className="btn-import-transcript"
            onClick={() => setShowImportModal(true)}
            title="Import Transcript"
          >
            <span className="btn-import-transcript-icon" aria-hidden="true">📄</span>
            <span className="btn-import-transcript-label">Import Transcript</span>
          </button>
        </div>

        <div className="planner-header-user">
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {user?.photoURL && (
            <img
              className="planner-header-avatar"
              src={user.photoURL}
              alt=""
              referrerPolicy="no-referrer"
            />
          )}
          {user ? (
            <>
              <span className="planner-header-name">
                {user?.displayName?.split(' ')[0]}
              </span>
              <button
                className="btn-signout"
                onClick={() => requestLeave(() => signOut(auth))}
                title="Sign out"
              >
                <span className="btn-signout-icon" aria-hidden="true">⎋</span>
                <span className="btn-signout-label">Sign out</span>
              </button>
            </>
          ) : (
            <button
              className="btn-signin"
              onClick={() =>
                requestLeave(() => {
                  saveLocalPlan();
                  window.location.href = '/login';
                })
              }
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      {/* data-mobile-view lets CSS show only one panel at a time on narrow screens */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="planner-body" data-mobile-view={mobileView}>
          {/* Left: search */}
          <aside className="planner-left">
            <CourseSearch
              theme={theme}
              activeSemIndex={activeSemIndex}
              onActiveSemChange={setActiveSemIndex}
              coursesInPlan={coursesInPlan}
              onAddCourse={handleAddCourse}
            />
          </aside>

          {/* Center: semester board */}
          <main className="planner-center">
            <SemesterBoard
              semesters={semesters}
              courseMap={courseMap}
              creditsMap={creditsMap}
              activeSemIndex={activeSemIndex}
              onSemesterClick={setActiveSemIndex}
              onRemoveCourse={handleRemoveCourse}
              draggingId={draggingId}
            />
            <ExtraTermsPanel
              extraTerms={extraTerms}
              courseMap={courseMap}
              creditsMap={creditsMap}
              onRemoveCourse={handleRemoveExtraTermCourse}
            />
            <ExternalCreditsPanel
              externalCredits={externalCredits}
              onRemove={handleRemoveExternalCredit}
              onUpdate={handleUpdateExternalCredit}
            />
          </main>

          {/* Right: HUB / Requirements / Credits status tabs */}
          <aside className="planner-right">
            <SidePanelTabs
              semesters={semesters}
              extraCourseKeys={extraCourseKeys}
              externalCredits={externalCredits}
              courseMap={courseMap}
              creditsMap={creditsMap}
              isTransfer={isTransfer}
              onToggleTransfer={handleToggleTransfer}
              majorBulletinUrl={majorBulletinUrl}
              planCourseKeys={requirementsCourseKeys}
              onMajorSelect={handleMajorSelect}
            />
          </aside>
        </div>

        <DragOverlay dropAnimation={null}>
          {dragOverlay ? (
            <CourseCard
              courseKey={dragOverlay.courseKey}
              data={dragOverlay.data}
              credits={dragOverlay.credits}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* ── Bulletin Panel ── */}
      <BulletinPanel
        selectedProgramUrl={majorBulletinUrl || ''}
        onProgramSelect={handleMajorSelect}
      />

      <ImportTranscriptModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        semesters={semesters}
        extraTerms={extraTerms}
        externalCredits={externalCredits}
        onImport={handleTranscriptImport}
      />

      {/* ── Mobile tab bar (hidden on wide screens via CSS; stays bottom-most
           so the bulletin panel expands upward above it) ── */}
      <nav className="mobile-tab-bar" aria-label="Planner sections">
        <button
          className={`mobile-tab-btn${mobileView === 'search' ? ' active' : ''}`}
          onClick={() => setMobileView('search')}
        >
          <span className="mobile-tab-icon" aria-hidden="true">🔍</span>
          Search
        </button>
        <button
          className={`mobile-tab-btn${mobileView === 'board' ? ' active' : ''}`}
          onClick={() => setMobileView('board')}
        >
          <span className="mobile-tab-icon" aria-hidden="true">📅</span>
          Planner
        </button>
        <button
          className={`mobile-tab-btn${mobileView === 'hub' ? ' active' : ''}`}
          onClick={() => setMobileView('hub')}
        >
          <span className="mobile-tab-icon" aria-hidden="true">🎯</span>
          Status
        </button>
      </nav>

      {/* ── Sign-in prompt for unsaved changes (unauthenticated) ── */}
      {!user && isDirty && (
        <div className="unauthenticated-banner">
          <div className="banner-content">
            <p>📌 Your plan is saved locally. Sign in to sync it to the cloud.</p>
            <a href="/login" className="banner-signin-link">
              Sign in →
            </a>
          </div>
        </div>
      )}

      {/* ── Unsaved changes leave confirmation ── */}
      {showLeaveModal && (
        <div className="beta-overlay" role="dialog" aria-modal="true" aria-labelledby="unsaved-modal-title">
          <div className="beta-modal">
            <img
              className="beta-modal-paw"
              src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
              alt="TerrierPlan"
              width={48}
              height={48}
            />
            <h2 id="unsaved-modal-title">Unsaved changes</h2>
            <p>
              {user
                ? 'You have unsaved changes. These will be lost if you leave without saving.'
                : 'You have unsaved changes. Sign in to save your plan, or your changes will be lost.'}
            </p>
            <div className="unsaved-modal-actions">
              <button
                type="button"
                className="unsaved-modal-stay"
                onClick={handleStay}
              >
                Stay
              </button>
              <button
                type="button"
                className="beta-dismiss-btn unsaved-modal-leave"
                onClick={handleLeaveAnyway}
              >
                {user ? 'Leave anyway' : 'Continue to sign in'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete plan confirmation ── */}
      {deletePlanId && (
        <div className="beta-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-plan-modal-title">
          <div className="beta-modal">
            <img
              className="beta-modal-paw"
              src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
              alt="TerrierPlan"
              width={48}
              height={48}
            />
            <h2 id="delete-plan-modal-title">
              Delete "{plans.find((p) => p.id === deletePlanId)?.name ?? planName}"?
            </h2>
            <p>This cannot be undone. The plan and everything in it will be permanently deleted.</p>
            <div className="unsaved-modal-actions">
              <button
                type="button"
                className="unsaved-modal-stay"
                onClick={cancelDeletePlan}
              >
                Cancel
              </button>
              <button
                type="button"
                className="beta-dismiss-btn unsaved-modal-leave"
                onClick={confirmDeletePlan}
              >
                Delete plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
