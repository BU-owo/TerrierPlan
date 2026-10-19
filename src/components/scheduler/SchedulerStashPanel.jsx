import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { loadAllCourses } from '../../utils/courseQuery';
import { CURRENT_TERM_LABEL } from '../../utils/term';
import SchedulerCourseRow from './SchedulerCourseRow';

// Same key PlannerPage saves the guest plan under (its LOCAL_STORAGE_KEY).
const GUEST_PLAN_KEY = 'terrierplan_session';
// Same prefix PlannerPage records the open plan's id under, per uid. Read
// only — the scheduler never writes it.
const ACTIVE_PLAN_KEY_PREFIX = 'terrierplan_active_plan_';
// Scheduler-only: the plan picked in this tab's "One plan" select, per uid.
const SELECTED_PLAN_KEY_PREFIX = 'terrierplan_scheduler_stash_plan_';
// Per-browser view preferences for this tab (not part of any plan).
const SCOPE_KEY = 'terrierplan_scheduler_stash_scope'; // 'plan' | 'all'
const HIDE_UNOFFERED_KEY = 'terrierplan_scheduler_stash_hide_unoffered'; // '1' | '0'

function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // unavailable storage: the choice just isn't remembered
  }
}

function stashKeys(raw) {
  return Array.isArray(raw) ? [...new Set(raw.filter((k) => typeof k === 'string'))] : [];
}

// Signed in: every plan (one getDocs), newest-updated first, plus the two
// stored ids the selected plan is picked from.
async function readAccountPlans(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'plans'));
  const plans = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .sort((a, b) => (b.data.updatedAt?.toMillis?.() ?? 0) - (a.data.updatedAt?.toMillis?.() ?? 0))
    .map(({ id, data }) => ({ id, name: data.name || 'My Plan', keys: stashKeys(data.stash) }));
  return {
    plans,
    savedId: readPref(`${SELECTED_PLAN_KEY_PREFIX}${uid}`),
    activeId: readPref(`${ACTIVE_PLAN_KEY_PREFIX}${uid}`),
  };
}

// Guest: the planner's local session blob. Missing or corrupt = empty.
function readGuestStash() {
  try {
    return { keys: stashKeys(JSON.parse(localStorage.getItem(GUEST_PLAN_KEY))?.stash) };
  } catch {
    return { keys: [] };
  }
}

// All plans: union deduped by courseKey (newest plan's order first), with
// the names of the plans each key is in.
function unionStashes(plans) {
  const planNamesByKey = {};
  const keys = [];
  for (const plan of plans) {
    for (const key of plan.keys) {
      if (!planNamesByKey[key]) {
        planNamesByKey[key] = [];
        keys.push(key);
      }
      planNamesByKey[key].push(plan.name);
    }
  }
  return { keys, planNamesByKey };
}

function EmptyPaw({ theme }) {
  return (
    <img
      className="search-empty-paw"
      src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
      alt="TerrierPlan paw logo"
      width={28}
      height={28}
    />
  );
}

// The scheduler's "Paw-tential" tab (see SchedulerLeftTabs): the planner's
// stash, read-only — this never writes a plan, the guest session, or the
// planner's active-plan key. Read once each time the tab opens (`active`),
// not subscribed; signed in reads Firestore only, guest reads localStorage
// only. The One plan / All plans toggle and the plan select re-slice the
// same read, no refetch.
export default function SchedulerStashPanel({
  active,
  user,
  authLoading,
  draftCourseKeys,
  onAddCourse,
  // Opens the one CourseInfoPanel owned by SchedulerLeftTabs.
  onShowCourseInfo,
  theme = 'light',
}) {
  const uid = user?.uid ?? null;
  const [scope, setScope] = useState(() => (readPref(SCOPE_KEY) === 'all' ? 'all' : 'plan'));
  const [hideUnoffered, setHideUnoffered] = useState(() => readPref(HIDE_UNOFFERED_KEY) !== '0');
  // Signed in: { uid, plans, savedId, activeId }; guest: { uid: null, keys };
  // or { uid, error: true }. Tagged with the uid it was read for so a
  // sign-in/out never shows the other one's list.
  const [loaded, setLoaded] = useState(null);
  // A select pick made since the last read ({ uid, planId }), or null.
  const [picked, setPicked] = useState(null);
  const [courseById, setCourseById] = useState(null);

  function changeScope(next) {
    setScope(next);
    writePref(SCOPE_KEY, next);
  }

  function changePlan(planId) {
    setPicked({ uid, planId });
    writePref(`${SELECTED_PLAN_KEY_PREFIX}${uid}`, planId);
  }

  function changeHideUnoffered(next) {
    setHideUnoffered(next);
    writePref(HIDE_UNOFFERED_KEY, next ? '1' : '0');
  }

  // Shared catalog cache (courseQuery.js), same as SchedulerSearch.
  useEffect(() => {
    let cancelled = false;
    loadAllCourses()
      .then((courses) => {
        if (!cancelled) setCourseById(new Map(courses.map((c) => [c.id, c])));
      })
      .catch((err) => {
        console.error('Failed to load courses:', err);
        if (!cancelled) setCourseById(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active || authLoading) return undefined;
    let cancelled = false;
    (uid ? readAccountPlans(uid) : Promise.resolve(readGuestStash()))
      .then((result) => {
        if (!cancelled) setLoaded({ uid, ...result });
      })
      .catch((err) => {
        console.error('Could not load Paw-tential courses:', err);
        if (!cancelled) setLoaded({ uid, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [active, authLoading, uid]);

  // Same rule as SchedulerSearch: only gate once the catalog carries
  // `inCurrentTerm`, otherwise every course would be blocked.
  const gateByCurrentTerm = useMemo(
    () => Boolean(courseById) && [...courseById.values()].some((c) => c.inCurrentTerm),
    [courseById],
  );

  const ready = loaded && loaded.uid === uid && courseById;
  const plans = ready && !loaded.error && uid ? loaded.plans : [];

  // Signed in, "One plan": this session's pick, else the saved pick, else the
  // plan the planner has open, else the newest plan — skipping any that no
  // longer exist.
  let selectedPlan = null;
  if (plans.length > 0) {
    const candidates = [picked?.uid === uid ? picked.planId : null, loaded.savedId, loaded.activeId];
    selectedPlan = candidates.map((id) => id && plans.find((p) => p.id === id)).find(Boolean) ?? plans[0];
  }

  let keys = [];
  let planNamesByKey = null;
  if (ready && !loaded.error) {
    if (!uid) keys = loaded.keys;
    else if (scope === 'all') ({ keys, planNamesByKey } = unionStashes(plans));
    else if (selectedPlan) keys = selectedPlan.keys;
  }

  const hiding = gateByCurrentTerm && hideUnoffered;
  // Draft courses always stay visible, same as SchedulerSearch.
  const visibleKeys = hiding
    ? keys.filter((key) => courseById.get(key)?.inCurrentTerm || draftCourseKeys.has(key))
    : keys;
  const hiddenCount = keys.length - visibleKeys.length;

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <h2>Paw-tential Courses</h2>
        {selectedPlan && (
          <div className="search-sem-target">
            <div
              className="hub-year-toggle-group"
              role="group"
              aria-label="Which plans' Paw-tential courses to show"
              style={{ flex: 1, marginBottom: 0 }}
            >
              <button
                type="button"
                className={`hub-year-toggle-btn${scope === 'plan' ? ' active' : ''}`}
                aria-pressed={scope === 'plan'}
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => changeScope('plan')}
              >
                One plan
              </button>
              <button
                type="button"
                className={`hub-year-toggle-btn${scope === 'all' ? ' active' : ''}`}
                aria-pressed={scope === 'all'}
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => changeScope('all')}
              >
                All plans
              </button>
            </div>
          </div>
        )}
        {selectedPlan && scope === 'plan' && plans.length >= 2 && (
          <div className="search-sem-target">
            <label htmlFor="sched-stash-plan">Plan</label>
            <select
              id="sched-stash-plan"
              className="search-sem-select"
              style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={selectedPlan.name}
              value={selectedPlan.id}
              onChange={(e) => changePlan(e.target.value)}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        {gateByCurrentTerm && (
          <div className="search-sem-target">
            <label className="sched-time-mode-switch">
              <input
                type="checkbox"
                role="switch"
                checked={hideUnoffered}
                onChange={(e) => changeHideUnoffered(e.target.checked)}
              />
              <span className="sched-time-mode-switch-track"><span className="sched-time-mode-switch-thumb" /></span>
              <span>Hide not offered in {CURRENT_TERM_LABEL}</span>
            </label>
          </div>
        )}
      </div>

      <div className="search-results">
        {!ready && <div className="search-loading">Loading…</div>}

        {ready && loaded.error && <div className="search-empty">Couldn&apos;t load your Paw-tential courses.</div>}

        {ready && !loaded.error && keys.length === 0 && (
          <div className="search-empty">
            <EmptyPaw theme={theme} />
            Nothing stashed yet.
          </div>
        )}

        {ready && !loaded.error && keys.length > 0 && visibleKeys.length === 0 && (
          <div className="search-empty">
            <EmptyPaw theme={theme} />
            Nothing offered in {CURRENT_TERM_LABEL}.{' '}
            <button type="button" className="hub-stash-link" onClick={() => changeHideUnoffered(false)}>
              Show
            </button>
          </div>
        )}

        {hiding && hiddenCount > 0 && visibleKeys.length > 0 && (
          <p className="stash-panel-hint" style={{ margin: '0 0 6px' }}>
            {hiddenCount} hidden
          </p>
        )}

        {ready && !loaded.error && visibleKeys.map((courseKey) => (
          <SchedulerCourseRow
            key={courseKey}
            courseKey={courseKey}
            course={courseById.get(courseKey)}
            added={draftCourseKeys.has(courseKey)}
            noCurrentTerm={gateByCurrentTerm && !courseById.get(courseKey)?.inCurrentTerm}
            planNames={planNamesByKey?.[courseKey]}
            onAdd={onAddCourse}
            onShowInfo={onShowCourseInfo}
          />
        ))}
      </div>
    </div>
  );
}
