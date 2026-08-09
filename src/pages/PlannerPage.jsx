import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import RequirementsFullView from '../components/planner/RequirementsFullView';
import BulletinPanel from '../components/planner/BulletinPanel';
import ImportTranscriptModal from '../components/planner/ImportTranscriptModal';
import ExtraTermsPanel from '../components/planner/ExtraTermsPanel';
import ExternalCreditsPanel from '../components/planner/ExternalCreditsPanel';
import { normalizeExternalCredits, normalizeExternalCredit } from '../utils/externalCredits';
import { normalizeSemesters, normalizeGridSummerTerms, entryCourseKey } from '../utils/courseEntry';
import { semesterLabel } from '../utils/hubConstants';
import './planner.css';
import '../App.css';

const EMPTY_SEMESTERS = () => Array.from({ length: 8 }, () => []);
const LOCAL_STORAGE_KEY = 'terrierplan_session';

// A "target" identifies where a course lives/goes: a plain number is a grid
// slot index (Fall/Spring), the string `summer:{year}` is that year's
// optional Summer slot (see SemesterBoard). Shared by every add/move/
// remove/lock handler below so both slot kinds go through one code path.
function isSummerTarget(target) {
  return typeof target === 'string' && target.startsWith('summer:');
}
function summerYearFromTarget(target) {
  return target.slice('summer:'.length);
}

// Firestore rejects arrays nested directly inside arrays, so `semesters`
// (array of arrays of course entries) can't be written as-is. Store it as an
// object keyed by semester index instead; these two helpers are the only
// places that should ever cross the array ⇄ object boundary.
function semestersToFirestore(semesters) {
  return (semesters || EMPTY_SEMESTERS()).reduce((obj, entries, i) => {
    obj[i] = entries;
    return obj;
  }, {});
}

function semestersFromFirestore(stored) {
  if (Array.isArray(stored)) return normalizeSemesters(stored); // tolerate any pre-fix docs written before this migration
  if (!stored) return EMPTY_SEMESTERS();
  const length = Math.max(8, ...Object.keys(stored).map((k) => Number(k) + 1));
  return normalizeSemesters(Array.from({ length }, (_, i) => stored[i] ?? []));
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
  const [searchParams, setSearchParams] = useSearchParams();
  // Whether the initial `?view=requirements` URL param (if any) has been
  // consulted yet — gated on the plan actually being loaded, so a linked/
  // refreshed full view doesn't flash open before plan data (semesters,
  // courseMap, majorBulletinUrl) exists. See the effect below.
  const [hasAppliedInitialView, setHasAppliedInitialView] = useState(false);

  // ── Plan list ─────────────────────────────────────────────────────────────
  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [planName, setPlanName] = useState('My Plan');
  const [semesters, setSemesters] = useState(EMPTY_SEMESTERS);
  // { [year]: courseEntry[] } — a year's optional Summer slot, keyed by
  // 0-based year index; key presence (even []) means that year's Summer
  // column is toggled on. See "+ Add Summer term" in SemesterBoard.
  const [gridSummerTerms, setGridSummerTerms] = useState({});
  const [isTransfer, setIsTransfer] = useState(false);
  const [majorBulletinUrl, setMajorBulletinUrl] = useState(null);
  const [extraTerms, setExtraTerms] = useState([]);
  const [externalCredits, setExternalCredits] = useState([]);
  const [cumulativeGpa, setCumulativeGpa] = useState(null);
  const [earnedCredits, setEarnedCredits] = useState(null);
  const [gradePoints, setGradePoints] = useState(null);
  // { [requirementNodeId]: { type: 'waive'|'substitute', courseKey?, note?, createdAt } }
  // Student-reported petition/waive exceptions — informational only, never
  // written back to the requirements JSON. See requirementOverrides in SCHEMA.md.
  const [requirementOverrides, setRequirementOverrides] = useState({});

  // ── Course data caches ────────────────────────────────────────────────────
  const [courseMap, setCourseMap] = useState({}); // courseKey → course doc
  const [creditsMap, setCreditsMap] = useState({}); // courseKey → credits

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeSemIndex, setActiveSemIndex] = useState(0);
  // Which single panel is shown on narrow/mobile screens: 'search' | 'board' | 'hub'
  const [mobileView, setMobileView] = useState('board');
  // { subject, min, max, exclude } | null — set by "Browse eligible courses"
  // on a COURSE_RANGE requirement node, consumed by CourseSearch as an
  // additional filter alongside its own text/HUB filters.
  const [rangeFilter, setRangeFilter] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'saved' | 'error' | ''
  const [isDirty, setIsDirty] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverlay, setDragOverlay] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deletePlanId, setDeletePlanId] = useState(null); // non-null → confirm-delete modal open for this plan id

  // Full-screen Requirements view — an in-page overlay/mode, not a route (see
  // RequirementsFullView.jsx), so it shares this component's state instead of
  // duplicating it. Mirrored to `?view=requirements` for linkability/back-
  // button support; the URL is the source of truth once the initial load has
  // been applied (see hasAppliedInitialView above).
  const requirementsFullView = hasAppliedInitialView && searchParams.get('view') === 'requirements';

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

  // ── Apply `?view=requirements` once plan data is actually ready ───────────
  // Waits for the signed-in plan load (activePlanId set) or the guest local
  // plan load (which finishes synchronously inside the auth effect above, by
  // the time authLoading goes false with no user) before consulting the URL,
  // so a linked/refreshed full view never flashes open over an empty plan.
  useEffect(() => {
    if (hasAppliedInitialView || authLoading) return;
    if (user && !activePlanId) return; // signed-in plan still loading
    setHasAppliedInitialView(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, activePlanId, hasAppliedInitialView]);

  function openRequirementsFullView() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('view', 'requirements');
      return next;
    });
  }

  function closeRequirementsFullView() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('view');
      return next;
    });
  }

  // "Browse eligible courses" from within the full-screen view — same as the
  // compact sidebar's handleBrowseRange, but also exits full mode since
  // Search isn't part of the full view (it jumps back to the normal planner
  // layout, where Search is visible again).
  function handleBrowseRangeFromFullView(range) {
    handleBrowseRange(range);
    closeRequirementsFullView();
  }

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
          gridSummerTerms,
          externalCredits,
          cumulativeGpa,
          earnedCredits,
          gradePoints,
          majorBulletinUrl,
          requirementOverrides,
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
  }, [semesters, gridSummerTerms, planName, isTransfer, isDirty, extraTerms, externalCredits, cumulativeGpa, earnedCredits, gradePoints, majorBulletinUrl, requirementOverrides]);

  // ── Guest: persist to localStorage after React commits the new state ──────
  // Handlers used to call saveLocalPlan() immediately after setSemesters(),
  // which wrote the *previous* board (stale closure) — so the last course
  // change was never stored, and a single-course plan looked "lost" on sign-in.
  useEffect(() => {
    if (user || authLoading || isInitialLoad.current || !isDirty) return;
    saveLocalPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesters, gridSummerTerms, planName, isTransfer, isDirty, extraTerms, externalCredits, cumulativeGpa, earnedCredits, gradePoints, majorBulletinUrl, requirementOverrides, user, authLoading]);

  // ── Local plan management (for auth-optional browsing) ─────────────────────
  function saveLocalPlan(overrides = {}) {
    const normalizedExternalCredits = normalizeExternalCredits(overrides.externalCredits ?? externalCredits);
    const plan = {
      name: overrides.name ?? planName,
      major: overrides.major ?? '',
      majorBulletinUrl: overrides.majorBulletinUrl ?? majorBulletinUrl,
      semesters: overrides.semesters ?? semesters,
      gridSummerTerms: overrides.gridSummerTerms ?? gridSummerTerms,
      isTransfer: overrides.isTransfer ?? isTransfer,
      extraTerms: overrides.extraTerms ?? extraTerms,
      externalCredits: normalizedExternalCredits,
      cumulativeGpa: overrides.cumulativeGpa ?? cumulativeGpa,
      earnedCredits: overrides.earnedCredits ?? earnedCredits,
      gradePoints: overrides.gradePoints ?? gradePoints,
      requirementOverrides: overrides.requirementOverrides ?? requirementOverrides,
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
        const localSemesters = normalizeSemesters(plan.semesters || EMPTY_SEMESTERS());
        setSemesters(localSemesters);
        setGridSummerTerms(normalizeGridSummerTerms(plan.gridSummerTerms));
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
        setRequirementOverrides(plan.requirementOverrides ?? {});
        setIsDirty(false);
        const extraKeys = (plan.extraTerms || []).flatMap((t) => t.courseKeys || []);
        const summerKeys = Object.values(plan.gridSummerTerms || {}).flatMap(
          (entries) => (entries || []).map(entryCourseKey),
        );
        const allKeys = [
          ...localSemesters.flatMap((sem) => sem.map(entryCourseKey)),
          ...extraKeys,
          ...summerKeys,
        ];
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
      semesters: semestersToFirestore(normalizeSemesters(guestPlan.semesters)),
      gridSummerTerms: normalizeGridSummerTerms(guestPlan.gridSummerTerms),
      isTransfer: guestPlan.isTransfer || false,
      extraTerms: guestPlan.extraTerms || [],
      externalCredits: normalizeExternalCredits(guestPlan.externalCredits),
      cumulativeGpa: guestPlan.cumulativeGpa ?? null,
      earnedCredits: guestPlan.earnedCredits ?? null,
      gradePoints: guestPlan.gradePoints ?? null,
      requirementOverrides: guestPlan.requirementOverrides ?? {},
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
    const summerData = normalizeGridSummerTerms(data.gridSummerTerms);
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
    setGridSummerTerms(summerData);
    setIsTransfer(data.isTransfer ?? false);
    setMajorBulletinUrl(data.majorBulletinUrl ?? null);
    setExtraTerms(extra);
    setExternalCredits(normalizedExternalCredits);
    setCumulativeGpa(data.cumulativeGpa ?? null);
    setEarnedCredits(data.earnedCredits ?? null);
    setGradePoints(data.gradePoints ?? null);
    setRequirementOverrides(data.requirementOverrides ?? {});
    setIsDirty(false);
    if (list) setPlans(list);
    const allKeys = [
      ...semData.flatMap((sem) => sem.map(entryCourseKey)),
      ...extra.flatMap((t) => t.courseKeys || []),
      ...Object.values(summerData).flatMap((entries) => entries.map(entryCourseKey)),
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
      gridSummerTerms: {},
      isTransfer: false,
      extraTerms: [],
      externalCredits: [],
      cumulativeGpa: null,
      earnedCredits: null,
      gradePoints: null,
      requirementOverrides: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActivePlanId(ref.id);
    setPlanName(name);
    setSemesters(EMPTY_SEMESTERS());
    setGridSummerTerms({});
    setIsTransfer(false);
    setMajorBulletinUrl(null);
    setExtraTerms([]);
    setExternalCredits([]);
    setCumulativeGpa(null);
    setEarnedCredits(null);
    setGradePoints(null);
    setRequirementOverrides({});
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
        gridSummerTerms: extras.gridSummerTerms ?? gridSummerTerms,
        isTransfer: transfer,
        majorBulletinUrl: extras.majorBulletinUrl ?? majorBulletinUrl,
        extraTerms: extras.extraTerms ?? extraTerms,
        externalCredits: normalizeExternalCredits(extras.externalCredits ?? externalCredits),
        cumulativeGpa: extras.cumulativeGpa ?? cumulativeGpa,
        earnedCredits: extras.earnedCredits ?? earnedCredits,
        gradePoints: extras.gradePoints ?? gradePoints,
        requirementOverrides: extras.requirementOverrides ?? requirementOverrides,
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

  // entries at a target location — a plain number indexes into `semesters`,
  // a `summer:{year}` string indexes into `gridSummerTerms`.
  function entriesAtTarget(target) {
    return isSummerTarget(target)
      ? (gridSummerTerms[summerYearFromTarget(target)] || [])
      : (semesters[target] || []);
  }

  function setEntriesAtTarget(target, updater) {
    if (isSummerTarget(target)) {
      const year = summerYearFromTarget(target);
      setGridSummerTerms((prev) => ({ ...prev, [year]: updater(prev[year] || []) }));
    } else {
      setSemesters((prev) => {
        const next = prev.map((s) => [...s]);
        next[target] = updater(next[target] || []);
        return next;
      });
    }
  }

  // Scans both containers for a courseKey's current location, for drag-end
  // (which only knows the dropped-on column, not where the card came from).
  function findCourseTarget(courseKey) {
    const semIndex = semesters.findIndex((sem) => sem.some((e) => entryCourseKey(e) === courseKey));
    if (semIndex !== -1) return semIndex;
    for (const year of Object.keys(gridSummerTerms)) {
      if (gridSummerTerms[year].some((e) => entryCourseKey(e) === courseKey)) return `summer:${year}`;
    }
    return null;
  }

  function handleAddCourse(courseKey, target) {
    const alreadyPlaced = findCourseTarget(courseKey) !== null;
    if (alreadyPlaced) return;
    setEntriesAtTarget(target, (entries) => [
      ...entries,
      { courseKey, locked: false, source: 'manual' },
    ]);
    setIsDirty(true);
    if (!courseMap[courseKey]) fetchCourseData([courseKey]);
    // On mobile the board is a separate tab from search — jump over so the
    // user can see the course land in its semester.
    setMobileView('board');
  }

  // "Browse eligible courses" on a COURSE_RANGE requirement node — hands the
  // range to CourseSearch as a filter and, on mobile where Search/Requirements
  // are separate tabs, jumps over so the results are actually visible.
  function handleBrowseRange(range) {
    setRangeFilter(range);
    setMobileView('search');
  }

  function handleMoveCourse(courseKey, fromTarget, toTarget) {
    const entry = entriesAtTarget(fromTarget).find((e) => entryCourseKey(e) === courseKey);
    if (!entry) return;
    setEntriesAtTarget(fromTarget, (entries) => entries.filter((e) => entryCourseKey(e) !== courseKey));
    setEntriesAtTarget(toTarget, (entries) => [...entries, entry]);
    setIsDirty(true);
  }

  function handleRemoveCourse(courseKey, target) {
    setEntriesAtTarget(target, (entries) => entries.filter((e) => entryCourseKey(e) !== courseKey));
    setIsDirty(true);
  }

  // Student discretion, not enforcement — any course can be locked/unlocked
  // regardless of source. Locked cards disable their own drag/remove in
  // CourseCard, so this handler doesn't need to guard against those.
  function handleToggleLock(courseKey, target) {
    setEntriesAtTarget(target, (entries) => entries.map((e) =>
      entryCourseKey(e) === courseKey ? { ...e, locked: !e.locked } : e
    ));
    setIsDirty(true);
  }

  // Reveals (or, if empty, hides) a year's optional Summer column — see
  // "OPTIONAL SUMMER TERM PER YEAR". Key presence in gridSummerTerms is the
  // toggle state; hiding a non-empty column isn't offered in the UI so data
  // is never silently dropped here.
  function handleToggleSummerYear(year, enabled) {
    setGridSummerTerms((prev) => {
      const next = { ...prev };
      if (enabled) {
        if (!(year in next)) next[year] = [];
      } else {
        delete next[year];
      }
      return next;
    });
    setIsDirty(true);
  }

  // Adds one more Fall/Spring pair below the grid — see "VARIABLE YEAR COUNT".
  function handleAddYear() {
    setSemesters((prev) => [...prev, [], []]);
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

    const overId = String(over.id);
    const semMatch = overId.match(/^col-(\d+)$/);
    const summerMatch = overId.match(/^col-summer-(\d+)$/);
    if (!semMatch && !summerMatch) return;
    const destTarget = semMatch ? parseInt(semMatch[1], 10) : `summer:${summerMatch[1]}`;

    const courseKey = active.data.current?.courseKey ?? active.id;
    const from = active.data.current?.from;

    if (from === 'search') {
      handleAddCourse(courseKey, destTarget);
      return;
    }

    const srcTarget = findCourseTarget(courseKey);
    if (srcTarget === null || srcTarget === destTarget) return;
    handleMoveCourse(courseKey, srcTarget, destTarget);
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
      ...result.semesters.flatMap((sem) => sem.map(entryCourseKey)),
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

  // Student-reported "waive" or "substitute" exception for a requirement
  // node — see requirementOverrides in SCHEMA.md. Purely plan-scoped and
  // informational; last write for a given nodeId wins.
  function handleSetRequirementOverride(nodeId, override) {
    setRequirementOverrides((prev) => ({
      ...prev,
      [nodeId]: { ...override, createdAt: new Date().toISOString() },
    }));
    setIsDirty(true);
  }

  function handleRemoveRequirementOverride(nodeId) {
    setRequirementOverrides((prev) => {
      if (!(nodeId in prev)) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
    setIsDirty(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const gridCourseKeys = semesters.flatMap((sem) => sem.map(entryCourseKey));
  const gridSummerCourseKeys = Object.values(gridSummerTerms).flatMap(
    (entries) => entries.map(entryCourseKey),
  );
  // extraTerms (transcript overflow) and gridSummerTerms (planned per-year
  // Summer slots) are both "outside the 8-slot grid but still counts" —
  // combined here so HUB/CreditsPanel (which only take one flat list) see
  // both without caring which produced a given key.
  const extraCourseKeys = [
    ...extraTerms.flatMap((term) => term.courseKeys || []),
    ...gridSummerCourseKeys,
  ];
  const coursesInPlan = new Set([...gridCourseKeys, ...extraCourseKeys]);

  // courseKey -> { locked, source } — display-only lookup for the full
  // Requirements view's planned/completed chip distinction (never fed into
  // evaluateRequirementTree, which only ever sees flat courseKeys). extraTerms
  // entries carry no locked/source of their own (they're plain courseKey
  // strings — see courseEntry.js), but they only ever come from a parsed
  // transcript, so every course in there is functionally already-completed.
  const lockStatusMap = useMemo(() => {
    const map = {};
    semesters.forEach((sem) => {
      sem.forEach((entry) => {
        map[entryCourseKey(entry)] = {
          locked: Boolean(entry?.locked),
          source: entry?.source ?? 'manual',
        };
      });
    });
    Object.values(gridSummerTerms).forEach((entries) => {
      entries.forEach((entry) => {
        map[entryCourseKey(entry)] = {
          locked: Boolean(entry?.locked),
          source: entry?.source ?? 'manual',
        };
      });
    });
    extraTerms.forEach((term) => {
      (term.courseKeys || []).forEach((key) => {
        map[key] = { locked: true, source: 'transcript' };
      });
    });
    return map;
  }, [semesters, gridSummerTerms, extraTerms]);

  // Unlike HUB (which excludes externalCredits entirely), the requirements
  // engine should see transfer/AP-equivalent courses too — they can satisfy
  // a major requirement even though they never count toward HUB.
  const requirementsCourseKeys = [
    ...gridCourseKeys,
    ...extraCourseKeys,
    ...externalCredits.map((c) => c?.courseKey).filter(Boolean),
  ];

  const planCourseCredits = [...gridCourseKeys, ...extraCourseKeys]
    .reduce((sum, key) => sum + (creditsMap[key] ?? 0), 0);

  // Options for "add to" targets — grid semesters plus any toggled-on Summer
  // slots — shared by CourseSearch's dropdown and the SemesterPickerModal
  // fallback picker.
  const semesterOptions = [
    ...semesters.map((_, i) => ({ value: i, label: semesterLabel(i) })),
    ...Object.keys(gridSummerTerms)
      .map(Number)
      .sort((a, b) => a - b)
      .map((year) => ({ value: `summer:${year}`, label: `Year ${year + 1} – Summer` })),
  ];

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
            <span className="btn-import-transcript-icon" aria-hidden="true">Import</span>
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
                <span className="btn-signout-icon" aria-hidden="true">Out</span>
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
              semesterOptions={semesterOptions}
              coursesInPlan={coursesInPlan}
              onAddCourse={handleAddCourse}
              rangeFilter={rangeFilter}
              onClearRangeFilter={() => setRangeFilter(null)}
            />
          </aside>

          {/* Center: semester board */}
          <main className="planner-center">
            <SemesterBoard
              semesters={semesters}
              gridSummerTerms={gridSummerTerms}
              courseMap={courseMap}
              creditsMap={creditsMap}
              activeTarget={activeSemIndex}
              onSemesterClick={setActiveSemIndex}
              onRemoveCourse={handleRemoveCourse}
              onToggleLock={handleToggleLock}
              onToggleSummerYear={handleToggleSummerYear}
              onAddYear={handleAddYear}
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
              activeSemIndex={activeSemIndex}
              semesterOptions={semesterOptions}
              onAddCourse={handleAddCourse}
              onEnsureCourseData={fetchCourseData}
              onBrowseRange={handleBrowseRange}
              requirementOverrides={requirementOverrides}
              onSetRequirementOverride={handleSetRequirementOverride}
              onRemoveRequirementOverride={handleRemoveRequirementOverride}
              onOpenFullView={openRequirementsFullView}
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

      {/* ── Full-screen Requirements view (overlay/mode, not a route — see
           requirementsFullView above) ── */}
      {requirementsFullView && (
        <RequirementsFullView
          majorBulletinUrl={majorBulletinUrl}
          planCourseKeys={requirementsCourseKeys}
          onMajorSelect={handleMajorSelect}
          courseMap={courseMap}
          activeSemIndex={activeSemIndex}
          semesterOptions={semesterOptions}
          onAddCourse={handleAddCourse}
          onEnsureCourseData={fetchCourseData}
          onBrowseRange={handleBrowseRangeFromFullView}
          requirementOverrides={requirementOverrides}
          onSetRequirementOverride={handleSetRequirementOverride}
          onRemoveRequirementOverride={handleRemoveRequirementOverride}
          lockStatusMap={lockStatusMap}
          onClose={closeRequirementsFullView}
        />
      )}

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
          Search
        </button>
        <button
          className={`mobile-tab-btn${mobileView === 'board' ? ' active' : ''}`}
          onClick={() => setMobileView('board')}
        >
          Planner
        </button>
        <button
          className={`mobile-tab-btn${mobileView === 'hub' ? ' active' : ''}`}
          onClick={() => setMobileView('hub')}
        >
          Status
        </button>
      </nav>

      {/* ── Sign-in prompt for unsaved changes (unauthenticated) ── */}
      {!user && isDirty && (
        <div className="unauthenticated-banner">
          <div className="banner-content">
            <p>Your plan is saved locally. Sign in to sync it to the cloud.</p>
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
