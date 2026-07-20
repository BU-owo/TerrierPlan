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

export default function PlannerPage() {
  const { user } = useAuth();

  // ── Plan list ─────────────────────────────────────────────────────────────
  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [planName, setPlanName] = useState('My Plan');
  const [semesters, setSemesters] = useState(EMPTY_SEMESTERS);

  // ── Course data caches ────────────────────────────────────────────────────
  const [courseMap, setCourseMap] = useState({}); // courseKey → course doc
  const [creditsMap, setCreditsMap] = useState({}); // courseKey → credits

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeSemIndex, setActiveSemIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'saved' | 'error' | ''
  const [isDirty, setIsDirty] = useState(false);

  const saveTimeoutRef = useRef(null);
  const isInitialLoad = useRef(true);

  // ── Load plans on sign-in ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    loadPlans(user.uid).then(async (list) => {
      if (list.length === 0) {
        await createDefaultPlan(user.uid);
      } else {
        await loadPlan(user.uid, list[0].id, list);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // ── Autosave on change ────────────────────────────────────────────────────
  useEffect(() => {
    if (isInitialLoad.current || !isDirty || !activePlanId || !user) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      persistPlan(user.uid, activePlanId, planName, semesters);
    }, 1500);
    return () => clearTimeout(saveTimeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesters, planName, isDirty]);

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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActivePlanId(ref.id);
    setPlanName('My Plan');
    setSemesters(EMPTY_SEMESTERS());
    setPlans([{ id: ref.id, name: 'My Plan' }]);
    setIsDirty(false);
    isInitialLoad.current = false;
  }

  async function persistPlan(uid, planId, name, semData) {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', uid, 'plans', planId), {
        name,
        semesters: semData,
        updatedAt: serverTimestamp(),
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2500);
      setIsDirty(false);
    } catch {
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

  // ── Derived ───────────────────────────────────────────────────────────────

  const coursesInPlan = new Set(semesters.flat());

  const totalCredits = semesters
    .flat()
    .reduce((sum, key) => sum + (creditsMap[key] ?? 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="planner-layout">
      {/* ── Header ── */}
      <header className="planner-header">
        <div className="planner-header-logo">🐾 TerrierPlan</div>

        <div className="planner-header-center">
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
          <span className="planner-header-name">
            {user?.displayName?.split(' ')[0]}
          </span>
          <button
            className="btn-signout"
            onClick={() => signOut(auth)}
          >
            Sign out
          </button>
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
          <HubSidebar semesters={semesters} courseMap={courseMap} />
        </aside>
      </div>

      {/* ── Bulletin Panel ── */}
      <BulletinPanel />
    </div>
  );
}
