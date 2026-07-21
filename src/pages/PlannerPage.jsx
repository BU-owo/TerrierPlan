import { useState, useEffect, useRef, useCallback } from 'react';
import { signOut } from 'firebase/auth';
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
import HubSidebar from '../components/planner/HubSidebar';
import BulletinPanel from '../components/planner/BulletinPanel';
import './planner.css';

const EMPTY_SEMESTERS = () => Array.from({ length: 8 }, () => []);
const LOCAL_STORAGE_KEY = 'terrierplan_session';

export default function PlannerPage() {
  const { user, loading: authLoading } = useAuth();

  // ── Plan list ─────────────────────────────────────────────────────────────
  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [planName, setPlanName] = useState('My Plan');
  const [semesters, setSemesters] = useState(EMPTY_SEMESTERS);
  const [isTransfer, setIsTransfer] = useState(false);

  // ── Course data caches ────────────────────────────────────────────────────
  const [courseMap, setCourseMap] = useState({}); // courseKey → course doc
  const [creditsMap, setCreditsMap] = useState({}); // courseKey → credits

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeSemIndex, setActiveSemIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'saved' | 'error' | ''
  const [isDirty, setIsDirty] = useState(false);
  const [unsavedChangesWarning, setUnsavedChangesWarning] = useState(false);

  const saveTimeoutRef = useRef(null);
  const isInitialLoad = useRef(true);
  const hasUnsavedChanges = useRef(false);

  // ── Load plans on sign-in ─────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return; // Wait for auth to load

    if (user) {
      // User is logged in
      loadPlans(user.uid).then(async (list) => {
        // Check if we have a guest plan to migrate
        const guestPlan = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (guestPlan) {
          try {
            const parsedGuest = JSON.parse(guestPlan);
            // Migrate guest plan to Firestore
            await migrateGuestPlan(user.uid, parsedGuest);
            // Reload plans to show the migrated one
            const updatedList = await loadPlans(user.uid);
            if (updatedList.length > 0) {
              await loadPlan(user.uid, updatedList[0].id, updatedList);
            }
          } catch (err) {
            console.error('Error migrating guest plan:', err);
            // Fall back to loading first plan if migration fails
            if (list.length > 0) {
              await loadPlan(user.uid, list[0].id, list);
            }
          }
        } else if (list.length === 0) {
          await createDefaultPlan(user.uid);
        } else {
          await loadPlan(user.uid, list[0].id, list);
        }
      });
    } else {
      // User is not logged in — load from local storage
      loadLocalPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, authLoading]);

  // ── Warn before losing unsaved changes ─────────────────────────────────────
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (isDirty) {
        const message = user
          ? 'You have unsaved changes. Your plan will not be saved if you leave.'
          : 'You have unsaved changes. Sign in to save your plan, or your changes will be lost when you leave.';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, user]);

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
        persistPlan(user.uid, activePlanId, planName, semesters, isTransfer);
      } else {
        console.warn('⚠️  [autosave] activePlanId is null, skipping save');
      }
    }, 1500);

    return () => {
      clearTimeout(saveTimeoutRef.current);
      console.log('🧹 [autosave] Cleaning up timeout');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesters, planName, isTransfer, isDirty]);

  // ── Local plan management (for auth-optional browsing) ─────────────────────
  function saveLocalPlan() {
    const plan = {
      name: planName,
      semesters,
      isTransfer,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(plan));
  }

  function loadLocalPlan() {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const plan = JSON.parse(stored);
        setPlanName(plan.name || 'My Plan');
        setSemesters(plan.semesters || EMPTY_SEMESTERS());
        setIsTransfer(plan.isTransfer || false);
        setIsDirty(false);
      }
    } catch (err) {
      console.error('Error loading local plan:', err);
    }
  }

  async function migrateGuestPlan(uid, guestPlan) {
    // Create a new plan in Firestore from the guest localStorage data
    const ref = await addDoc(collection(db, 'users', uid, 'plans'), {
      name: guestPlan.name || 'Imported Plan',
      semesters: guestPlan.semesters || EMPTY_SEMESTERS(),
      isTransfer: guestPlan.isTransfer || false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // Only clear localStorage after successful Firestore write
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    console.log('✅ Guest plan migrated to Firestore:', ref.id);
    return ref.id;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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
    const semData = data.semesters ?? EMPTY_SEMESTERS();
    setActivePlanId(planId);
    setPlanName(data.name ?? 'My Plan');
    setSemesters(semData);
    setIsTransfer(data.isTransfer ?? false);
    setIsDirty(false);
    if (list) setPlans(list);
    // Fetch course data for courses already in the plan
    const allKeys = semData.flat();
    if (allKeys.length > 0) {
      await fetchCourseData(allKeys);
    }
    isInitialLoad.current = false;
  }

  async function createDefaultPlan(uid) {
    isInitialLoad.current = true;
    const ref = await addDoc(collection(db, 'users', uid, 'plans'), {
      name: 'My Plan',
      major: '',
      semesters: EMPTY_SEMESTERS(),
      isTransfer: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActivePlanId(ref.id);
    setPlanName('My Plan');
    setSemesters(EMPTY_SEMESTERS());
    setIsTransfer(false);
    setPlans([{ id: ref.id, name: 'My Plan' }]);
    setIsDirty(false);
    isInitialLoad.current = false;
  }

  async function persistPlan(uid, planId, name, semData, transfer) {
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

      // Verify we have required data
      if (!uid) throw new Error('Missing uid');
      if (!planId) throw new Error('Missing planId');

      const planRef = doc(db, 'users', uid, 'plans', planId);
      console.log('📍 [persistPlan] Plan ref path:', planRef.path);

      const payload = {
        name,
        semesters: semData,
        isTransfer: transfer,
        updatedAt: serverTimestamp(),
      };

      console.log('💾 [persistPlan] Sending payload:', {
        ...payload,
        updatedAt: '(server-timestamp)',
      });

      // Attempt the write
      await updateDoc(planRef, payload);

      console.log('✅ [persistPlan] Write succeeded');
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2500);
      setIsDirty(false);
    } catch (err) {
      const errorDetails = {
        message: err.message,
        code: err.code,
        stack: err.stack,
      };
      console.error('❌ [persistPlan] Write failed:', errorDetails);
      console.error('🔍 [persistPlan] Debug log:', debugLog);

      // Log different error codes
      if (err.code === 'permission-denied') {
        console.error('⚠️  Permission denied — check Firestore rules and authentication');
      } else if (err.code === 'unauthenticated') {
        console.error('⚠️  User not authenticated — check auth state');
      } else if (err.code === 'failed-precondition') {
        console.error('⚠️  Failed precondition — possible document doesn\'t exist');
      }

      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
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
    if (!user) saveLocalPlan();
  }

  function handleMoveCourse(courseKey, fromSem, toSem) {
    setSemesters((prev) => {
      const next = prev.map((s) => [...s]);
      next[fromSem] = next[fromSem].filter((k) => k !== courseKey);
      next[toSem] = [...next[toSem], courseKey];
      return next;
    });
    setIsDirty(true);
    if (!user) saveLocalPlan();
  }

  function handleRemoveCourse(courseKey, semIndex) {
    setSemesters((prev) => {
      const next = prev.map((s) => [...s]);
      next[semIndex] = next[semIndex].filter((k) => k !== courseKey);
      return next;
    });
    setIsDirty(true);
    if (!user) saveLocalPlan();
  }

  function handleToggleTransfer(val) {
    setIsTransfer(val);
    setIsDirty(true);
    if (!user) saveLocalPlan();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const coursesInPlan = new Set(semesters.flat());

  const totalCredits = semesters
    .flat()
    .reduce((sum, key) => sum + (creditsMap[key] ?? 0), 0);

  if (authLoading) {
    return (
      <div className="auth-loading">
        <span className="auth-loading-paw">🐾</span>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="planner-layout">
      {/* ── Header ── */}
      <header className="planner-header">
        <div className="planner-header-logo">🐾 TerrierPlan</div>

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
                onDeletePlan={handleDeletePlan}
              />

              {totalCredits > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    opacity: 0.8,
                    background: 'rgba(255,255,255,.18)',
                    padding: '2px 10px',
                    borderRadius: 20,
                    marginLeft: 8,
                  }}
                >
                  {totalCredits} cr total
                </span>
              )}
            </>
          ) : (
            <div
              style={{
                fontSize: 13,
                opacity: 0.9,
                fontStyle: 'italic',
              }}
            >
              Browsing as guest — sign in to save your plans
            </div>
          )}
        </div>

        <div className="planner-header-user">
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
                onClick={() => signOut(auth)}
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              className="btn-signin"
              onClick={() => window.location.href = '/login'}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="planner-body">
        {/* Left: search */}
        <aside className="planner-left">
          <CourseSearch
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
            onMoveCourse={handleMoveCourse}
            onRemoveCourse={handleRemoveCourse}
          />
        </main>

        {/* Right: HUB tracker */}
        <aside className="planner-right">
          <HubSidebar
            semesters={semesters}
            courseMap={courseMap}
            isTransfer={isTransfer}
            onToggleTransfer={handleToggleTransfer}
          />
        </aside>
      </div>

      {/* ── Bulletin Panel ── */}
      <BulletinPanel />

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
    </div>
  );
}
