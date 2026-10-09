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
  setDoc,
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
import HeaderMenu from '../components/planner/HeaderMenu';
import SearchPanelTabs from '../components/planner/SearchPanelTabs';
import SemesterBoard from '../components/planner/SemesterBoard';
import CourseCard from '../components/planner/CourseCard';
import SidePanelTabs from '../components/planner/SidePanelTabs';
import { PanelCollapseButton, PanelRail } from '../components/planner/PanelCollapseControls';
import usePanelCollapse from '../hooks/usePanelCollapse';
import RequirementsFullView from '../components/planner/RequirementsFullView';
import HubFullView from '../components/planner/HubFullView';
import ImportTranscriptModal from '../components/planner/ImportTranscriptModal';
import ExtraTermsPanel from '../components/planner/ExtraTermsPanel';
import ExternalCreditsPanel from '../components/planner/ExternalCreditsPanel';
import CourseInfoPanel from '../components/planner/CourseInfoPanel';
import AppHeader from '../components/AppHeader';
import GuestSignInButton from '../components/GuestSignInButton';
import HelpSupportModal from '../components/HelpSupportModal';
import { requestCatalogLoad } from '../utils/courseQuery';
import { normalizeExternalCredits, normalizeExternalCredit } from '../utils/externalCredits';
import {
  normalizeSemesters,
  normalizeGridSummerTerms,
  entryCourseKey,
  entriesCourseKeys,
  entriesNoteCredits,
  createNoteEntry,
  isNoteEntry,
  isSummerTarget,
  summerYearFromTarget,
  getSemesterStatus,
} from '../utils/courseEntry';
import { semesterLabel } from '../utils/hubConstants';
import { useHubProgress } from '../hooks/useHubProgress';
import { CURRENT_TERM } from '../utils/term';
import './planner.css';
import '../App.css';

const EMPTY_SEMESTERS = () => Array.from({ length: 8 }, () => []);
// "+ Add Year" stops here (see handleAddYear/SemesterBoard).
const MAX_PLAN_YEARS = 8;
const LOCAL_STORAGE_KEY = 'terrierplan_session';
// Per-browser display preference ('detailed' | 'overview'); not part of any plan.
const PLANNER_VIEW_KEY = 'terrierplan_planner_view';
// Overview needs the desktop 3-column layout; below this the mobile layout stays.
const OVERVIEW_MIN_WIDTH_QUERY = '(min-width: 861px)';
// A student's "current semester", completed courses, and AP/IB/transfer
// credits are facts about them, not about any one hypothetical plan — kept
// in their own storage key (signed-in: the top-level `users/{uid}` doc;
// guest: this key) so they carry over when switching plans or creating a
// new one, instead of being reset per-plan like semesters/gridSummerTerms/
// etc. are.
const PROFILE_STORAGE_KEY = 'terrierplan_profile';

// Backward compat: a guest who used the app before externalCredits moved
// into the shared profile still has it sitting only in the legacy per-plan
// session blob — loadLocalProfile falls back to this when the profile key
// itself has none.
function readLegacyGuestExternalCredits() {
  try {
    const legacyRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!legacyRaw) return [];
    const legacyPlan = JSON.parse(legacyRaw);
    return Array.isArray(legacyPlan?.externalCredits) ? legacyPlan.externalCredits : [];
  } catch {
    return [];
  }
}

function loadLocalProfile() {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    const externalCredits = Array.isArray(parsed?.externalCredits)
      ? parsed.externalCredits
      : readLegacyGuestExternalCredits();
    return {
      currentSemesterTarget: parsed?.currentSemesterTarget ?? null,
      completedCourseKeys: Array.isArray(parsed?.completedCourseKeys) ? parsed.completedCourseKeys : [],
      externalCredits,
    };
  } catch (err) {
    console.error('Error loading local profile:', err);
    return { currentSemesterTarget: null, completedCourseKeys: [], externalCredits: [] };
  }
}

// `profile` is { currentSemesterTarget, completedCourseKeys, externalCredits }.
function saveLocalProfile(profile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
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

// Firestore rejects a whole write that contains `undefined` anywhere. Returns
// a copy of `value` with object keys whose value is undefined dropped and
// undefined array items turned into null (length kept). Only plain objects and
// arrays are walked; Date/Timestamp/FieldValue-like instances pass through
// untouched. Never mutates its input. Dropped paths are pushed onto `removed`.
function stripUndefined(value, path, removed) {
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      if (item === undefined) {
        removed.push(`${path}[${i}]`);
        return null;
      }
      return stripUndefined(item, `${path}[${i}]`, removed);
    });
  }
  const proto = value !== null && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (proto === Object.prototype || proto === null) {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) {
        removed.push(`${path}.${key}`);
      } else {
        out[key] = stripUndefined(v, `${path}.${key}`, removed);
      }
    }
    return out;
  }
  return value;
}

function withoutUndefined(value, label) {
  const removed = [];
  const out = stripUndefined(value, label, removed);
  if (import.meta.env.DEV && removed.length > 0) {
    console.warn('[profile-undefined] removed undefined at:', removed);
  }
  return out;
}

function semestersFromFirestore(stored) {
  if (Array.isArray(stored)) return normalizeSemesters(stored); // tolerate any pre-fix docs written before this migration
  if (!stored) return EMPTY_SEMESTERS();
  const length = Math.max(8, ...Object.keys(stored).map((k) => Number(k) + 1));
  return normalizeSemesters(Array.from({ length }, (_, i) => stored[i] ?? []));
}

// A guest blob with nothing in it (default name, no courses, no settings) isn't
// worth an account plan. External credits live in the profile key, not here.
function isBlankGuestPlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  const isEmpty = (v) => v == null || (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0);
  const noneSet = (v) => v == null || v === '';
  return (
    (plan.semesters || []).every(isEmpty) &&
    Object.values(plan.gridSummerTerms || {}).every(isEmpty) &&
    isEmpty(plan.extraTerms) &&
    isEmpty(plan.stash) &&
    isEmpty(plan.requirementOverrides) &&
    noneSet(plan.majorBulletinUrl) &&
    noneSet(plan.cumulativeGpa) &&
    noneSet(plan.earnedCredits) &&
    noneSet(plan.gradePoints) &&
    !plan.isTransfer &&
    (plan.name || 'My Plan') === 'My Plan'
  );
}

// Shared across Strict Mode double-invokes of the auth effect so we only
// migrate (and clear localStorage) once per guest session → sign-in.
let guestMigrationPromise = null;
// Sign-in reaches every open tab, so a tab claims the guest-plan migration
// here before writing; another tab seeing a recent claim skips it. A claim
// left by a tab that closed mid-migration expires and the next sign-in
// retries (same approach as SchedulerPage's guest-schedules migration).
const PLAN_MIGRATION_CLAIM_KEY = 'terrierplan_planner_plan_migrating';
const MIGRATION_CLAIM_TTL_MS = 60_000;
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
  // Set when the signed-in initial load (loadPlans/loadPlan) fails, so the
  // board shows an error instead of "Loading your plans…" forever. Only
  // shown while no plan has loaded yet (see plansPending below).
  const [planLoadError, setPlanLoadError] = useState(false);
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
  // courseKey[] — saved-for-later courses, kept separate from the planner
  // grid (see SearchPanelTabs' "Paw-tential Courses" tab). Generic name so
  // the display label can change without a refactor.
  const [stash, setStash] = useState([]);
  // courseKey shown in the course info panel (null = closed). Owned here so
  // search, stash and placed-course cards all drive the one panel instance,
  // which is mounted outside every mobile-tab panel (see the render below).
  const [infoCourseKey, setInfoCourseKey] = useState(null);
  const closeCourseInfo = useCallback(() => setInfoCourseKey(null), []);
  // number | `summer:{year}` string | null — the semester slot the student
  // says they're currently in (same target encoding as add/move/lock
  // handlers); null means none set. courseKey[] — courses the student has
  // locked/marked complete. Both are facts about the *student*, not any one
  // plan, so they're loaded/saved independently of activePlanId (see
  // loadUserProfile/persistProfile/loadLocalProfile/saveLocalProfile) and
  // stay put across handleSelectPlan/handleNewPlan — locking a course or
  // picking a current semester in one plan carries straight over to every
  // other plan of this student's. See getSemesterStatus in courseEntry.js.
  const [currentSemesterTarget, setCurrentSemesterTarget] = useState(null);
  const [completedCourseKeys, setCompletedCourseKeys] = useState([]);
  const completedCourseKeySet = useMemo(
    () => new Set(completedCourseKeys),
    [completedCourseKeys],
  );

  // ── Course data caches ────────────────────────────────────────────────────
  const [courseMap, setCourseMap] = useState({}); // courseKey → course doc
  const [creditsMap, setCreditsMap] = useState({}); // courseKey → credits

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeSemIndex, setActiveSemIndex] = useState(0);
  // Which single panel is shown on narrow/mobile screens: 'search' | 'board' | 'hub'
  const [mobileView, setMobileView] = useState('board');
  const { collapsed: leftCollapsed, desktop: isDesktopLayout, setCollapsed: setLeftCollapsed } = usePanelCollapse('terrierplan_planner_left_collapsed');
  // 'detailed' | 'overview' — "All semesters" compact board (desktop only).
  const [boardView, setBoardView] = useState(() => {
    try {
      return localStorage.getItem(PLANNER_VIEW_KEY) === 'overview' ? 'overview' : 'detailed';
    } catch {
      return 'detailed';
    }
  });
  const [isWideLayout, setIsWideLayout] = useState(() => window.matchMedia(OVERVIEW_MIN_WIDTH_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(OVERVIEW_MIN_WIDTH_QUERY);
    const onChange = (e) => setIsWideLayout(e.matches);
    setIsWideLayout(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  function handleBoardViewChange(next) {
    setBoardView(next);
    try {
      localStorage.setItem(PLANNER_VIEW_KEY, next);
    } catch {
      // Preference just won't stick.
    }
  }
  const overviewActive = boardView === 'overview' && isWideLayout;
  // { subject, min, max, exclude } | null — set by "Browse eligible courses"
  // on a COURSE_RANGE requirement node, consumed by CourseSearch as an
  // additional filter alongside its own text/HUB filters.
  const [rangeFilter, setRangeFilter] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'saved' | 'error' | ''
  const [online, setOnline] = useState(() => navigator.onLine);
  // A signed-in profile write is queued/unsent (mirrors pendingProfileWriteRef,
  // which can't drive a render); only used for the offline badge.
  const [profileUnsaved, setProfileUnsaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverlay, setDragOverlay] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  // Which header button opened the import modal; only changes its copy.
  const [importVariant, setImportVariant] = useState('transcript');
  // 'idle' | 'busy' | 'error' — "Download plan PDF" button.
  const [planPdfStatus, setPlanPdfStatus] = useState('idle');
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [deletePlanId, setDeletePlanId] = useState(null); // non-null → confirm-delete modal open for this plan id

  // Full-screen Requirements view — an in-page overlay/mode, not a route (see
  // RequirementsFullView.jsx), so it shares this component's state instead of
  // duplicating it. Mirrored to `?view=requirements` for linkability/back-
  // button support; the URL is the source of truth once the initial load has
  // been applied (see hasAppliedInitialView above).
  const requirementsFullView = hasAppliedInitialView && searchParams.get('view') === 'requirements';
  // Same pattern, one `view` param slot — see HubFullView.jsx. The two are
  // mutually exclusive by construction (a single `view` value can't be
  // both), which matches reality: only one full-screen overlay is ever
  // open at a time.
  const hubFullView = hasAppliedInitialView && searchParams.get('view') === 'hub';

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const saveTimeoutRef = useRef(null);
  // Signed-in plan autosave bookkeeping. editVersionRef counts edits as the
  // autosave effect schedules them; pendingPlanWriteRef is the latest edit
  // not yet sent — captured with its own uid/planId/data at edit time, so a
  // flush (timer, plan switch, unmount, pagehide) can only ever write it to
  // the plan it was made on. Same idea as pendingProfileWriteRef below.
  const editVersionRef = useRef(0);
  const pendingPlanWriteRef = useRef(null);
  const planSavesInFlightRef = useRef(0);
  const flushPlanRef = useRef(null);
  const isInitialLoad = useRef(true);
  // uid the profile (currentSemesterTarget/completedCourseKeys) has actually
  // finished loading for — set at the end of loadUserProfile, reset to null
  // on sign-out. Guards the profile autosave effect so it can't fire with
  // stale/empty state and setDoc(merge) over the account's real data before
  // loadUserProfile has resolved (see issue 2 in the fix-up that added this).
  const profileLoadedForUid = useRef(null);
  const hasUnsavedChanges = useRef(false);
  const skipGuestSaveRef = useRef(false);
  const pendingLeaveAction = useRef(null);

  // ── Load plans on sign-in (and migrate any guest plan first) ──────────────
  useEffect(() => {
    if (authLoading) return; // Wait for auth to load

    let cancelled = false;

    async function migrateGuestPlanIfNeeded(uid) {
      // Deduplicate concurrent calls (React Strict Mode remounts the effect)
      if (!guestMigrationPromise) {
        const guestRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
        let guestBlank = false;
        if (guestRaw) {
          try {
            guestBlank = isBlankGuestPlan(JSON.parse(guestRaw));
          } catch {
            guestBlank = false;
          }
        }
        if (guestBlank) {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          guestMigrationPromise = Promise.resolve(null);
          return guestMigrationPromise;
        }
        const claimedAt = Number(localStorage.getItem(PLAN_MIGRATION_CLAIM_KEY)) || 0;
        if (!guestRaw || Date.now() - claimedAt < MIGRATION_CLAIM_TTL_MS) {
          guestMigrationPromise = Promise.resolve(null);
        } else {
          // Claim immediately so a sibling effect or another tab cannot also
          // migrate / createDefault. The guest plan itself stays in
          // localStorage until the Firestore write has succeeded.
          localStorage.setItem(PLAN_MIGRATION_CLAIM_KEY, String(Date.now()));
          guestMigrationPromise = (async () => {
            try {
              const parsedGuest = JSON.parse(guestRaw);
              const migratedId = await migrateGuestPlan(uid, parsedGuest);
              localStorage.removeItem(LOCAL_STORAGE_KEY);
              return migratedId;
            } catch (err) {
              console.error('Error migrating guest plan:', err);
              guestMigrationPromise = null; // allow retry on next sign-in attempt
              return null;
            } finally {
              localStorage.removeItem(PLAN_MIGRATION_CLAIM_KEY);
            }
          })();
        }
      }
      return guestMigrationPromise;
    }

    async function initForUser(uid) {
      // New uid (or first sign-in this session) — the profile hasn't loaded
      // for it yet, so block the autosave effect until loadUserProfile below
      // actually finishes.
      profileLoadedForUid.current = null;
      setPlanLoadError(false);

      // 1. Migrate guest plan BEFORE loadPlans/createDefaultPlan
      const migratedId = await migrateGuestPlanIfNeeded(uid);
      if (cancelled) return;

      // 1b. Load the student-level profile (current semester + completed
      // courses) once per sign-in — not per plan, and not re-run by
      // handleSelectPlan/handleNewPlan, which is what makes it carry across
      // every plan instead of resetting with each one.
      try {
        await loadUserProfile(uid);
      } catch (err) {
        console.error('Error loading profile:', err);
        // profileLoadedForUid.current is already null (reset above) and
        // loadUserProfile never got far enough to set it — the profile
        // autosave effect's guard keeps blocking writes for this uid, so
        // nothing gets clobbered, but locks/current-semester picks this
        // session won't reach Firestore until a reload retries the load.
        console.warn('⚠️  Profile writes disabled this session — profile failed to load');
      }
      if (cancelled) return;

      // 2. Load existing plans (migrated doc is additive — never overwrites)
      let list = [];
      try {
        list = await loadPlans(uid);
      } catch (err) {
        console.error('Error loading plans:', err);
        if (!cancelled) setPlanLoadError(true);
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
      // loadPlan/createDefaultPlan don't catch their own errors — without
      // this the board would sit on "Loading your plans…" forever.
      initForUser(user.uid).catch((err) => {
        console.error('Error loading plan:', err);
        if (!cancelled) setPlanLoadError(true);
      });
    } else {
      // Signed out — allow a future sign-in to migrate a new guest plan
      guestMigrationPromise = null;
      profileLoadedForUid.current = null;
      // Signing out doesn't unmount the page, so the account's plan is still
      // in state. Reset every plan field to its default first, so a guest
      // with no saved session sees an empty default plan, and so the guest
      // autosave below can't write the account's plan into guest storage.
      setPlans([]);
      setActivePlanId(null);
      setPlanLoadError(false);
      setPlanName('My Plan');
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
      setStash([]);
      setIsDirty(false);
      // The guest autosave effect below runs in this same commit with the
      // previous render's (account) state; skip that one pass.
      skipGuestSaveRef.current = true;
      loadLocalPlan();
      const localProfile = loadLocalProfile();
      setCurrentSemesterTarget(localProfile.currentSemesterTarget);
      setCompletedCourseKeys(localProfile.completedCourseKeys);
      setExternalCredits(normalizeExternalCredits(localProfile.externalCredits));
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

  // ── Start the course catalog download once a plan is showing ─────────────
  // Same "plan ready" signal as plansPending/the `?view=` effect below.
  // Guests have no plans to wait for, so for them this fires as soon as auth
  // resolves (i.e. at mount, as before). CourseSearch can also open the gate
  // earlier if the student starts searching — see requestCatalogLoad.
  useEffect(() => {
    if (authLoading || (user && !activePlanId)) return;
    requestCatalogLoad();
  }, [authLoading, user, activePlanId]);

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

  function openHubFullView() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('view', 'hub');
      return next;
    });
  }

  function closeHubFullView() {
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
  // Guests are excluded — their changes are already autosaved to
  // localStorage and migrated on sign-in, so the browser warning would be
  // misleading for them.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!user || !hasUnsavedChanges.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user]);

  // ── In-app leave confirmation ─────────────────────────────────────────────
  function requestLeave(action) {
    if (!hasUnsavedChanges.current || !user) {
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

  async function handleLeaveAnyway() {
    const action = pendingLeaveAction.current;
    pendingLeaveAction.current = null;
    setShowLeaveModal(false);
    // Flush guest plan so sign-in migration has the latest board state
    if (!user) saveLocalPlan();
    // Signed in: save the pending edit first. If that fails, stay on the page
    // (the error badge shows, and the edit is kept for the next flush)
    // rather than drop it.
    else if (!(await flushPendingPlanWrite())) return;
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
      if (import.meta.env.DEV && !user) console.log('⏭️  [autosave] Skipped: not logged in');
      if (import.meta.env.DEV && !isDirty) console.log('⏭️  [autosave] Skipped: no dirty changes');
      if (import.meta.env.DEV && isInitialLoad.current) console.log('⏭️  [autosave] Skipped: initial load');
      return;
    }

    if (import.meta.env.DEV) console.log('⏲️  [autosave] Debounce scheduled for 1500ms');
    editVersionRef.current += 1;
    pendingPlanWriteRef.current = activePlanId
      ? {
          uid: user.uid,
          planId: activePlanId,
          version: editVersionRef.current,
          name: planName,
          semesters,
          isTransfer,
          extras: {
            extraTerms,
            gridSummerTerms,
            cumulativeGpa,
            earnedCredits,
            gradePoints,
            majorBulletinUrl,
            requirementOverrides,
            stash,
          },
        }
      : null;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (import.meta.env.DEV) console.log('⏱️  [autosave] Debounce fired, calling persistPlan');
      if (activePlanId) {
        flushPendingPlanWrite();
      } else {
        console.warn('⚠️  [autosave] activePlanId is null, skipping save');
      }
    }, 1500);

    // Clears only the timer — pendingPlanWriteRef stays so an unmount,
    // pagehide or plan switch can still flush it.
    return () => {
      clearTimeout(saveTimeoutRef.current);
      if (import.meta.env.DEV) console.log('🧹 [autosave] Cleaning up timeout');
    };
    // externalCredits deliberately not a dep here — it's student-level now
    // (see the profile autosave effect below), not plan data, so changing
    // it shouldn't reschedule/cancel this plan-save debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesters, gridSummerTerms, planName, isTransfer, isDirty, extraTerms, cumulativeGpa, earnedCredits, gradePoints, majorBulletinUrl, requirementOverrides, stash]);

  // Flush a still-debounced plan write when the planner unmounts (e.g. the
  // browser Back button, which no leave prompt sees) or the page is hidden
  // (tab close / refresh, including after "Leave" on the browser's own
  // prompt). Through a ref so these mount-only effects always call the
  // current render's flush.
  useEffect(() => {
    flushPlanRef.current = flushPendingPlanWrite;
  });

  useEffect(() => {
    function handlePageHide() {
      flushPlanRef.current?.();
    }
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      flushPlanRef.current?.();
    };
  }, []);

  // ── Guest: persist to localStorage after React commits the new state ──────
  // Handlers used to call saveLocalPlan() immediately after setSemesters(),
  // which wrote the *previous* board (stale closure) — so the last course
  // change was never stored, and a single-course plan looked "lost" on sign-in.
  useEffect(() => {
    if (user || authLoading) return;
    if (skipGuestSaveRef.current) {
      skipGuestSaveRef.current = false;
      return;
    }
    if (isInitialLoad.current || !isDirty) return;
    saveLocalPlan();
    // externalCredits deliberately not a dep — see the plan autosave effect
    // above; it's saved via saveLocalProfile in the profile effect instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesters, gridSummerTerms, planName, isTransfer, isDirty, extraTerms, cumulativeGpa, earnedCredits, gradePoints, majorBulletinUrl, requirementOverrides, stash, user, authLoading]);

  // ── Profile autosave (current semester + locked courses + external credits) ─
  // Deliberately its own effect/timer, not folded into the plan autosave
  // above. It used to share that effect's timeout, keyed off `semesters`
  // among other plan fields — so switching plans (which changes `semesters`)
  // ran that effect's cleanup and cancelled the *profile* save too, before
  // it ever reached Firestore/localStorage. A lock toggled right before
  // switching plans could silently vanish. This timer only depends on the
  // profile fields themselves, so a plan switch can never cancel it.
  //
  // Guests write straight to localStorage on every change — it's cheap, so
  // there's no debounce and nothing to lose on unmount. Signed-in writes
  // still debounce (Firestore isn't free), but that reopens the same
  // "cancelled on unmount" problem one level up: navigating away (sign-in
  // redirect, /scheduler, etc.) within the debounce window would clear the
  // pending setTimeout via this effect's own per-dependency cleanup before
  // it ever fires. pendingProfileWriteRef tracks the latest not-yet-sent
  // write — as one { uid, profile } object, profile being the full
  // { currentSemesterTarget, completedCourseKeys, externalCredits } shape —
  // so the unmount-only effect and pagehide listener below can flush it
  // even though the timer itself got cleared.
  const profileSaveTimeoutRef = useRef(null);
  const pendingProfileWriteRef = useRef(null);
  useEffect(() => {
    if (isInitialLoad.current) return;

    if (!user) {
      if (!authLoading) saveLocalProfile({ currentSemesterTarget, completedCourseKeys, externalCredits });
      return;
    }

    // Profile hasn't finished loading for this uid yet — writing now would
    // setDoc(merge) this render's (possibly still-default) state over the
    // account's real data. See loadUserProfile / profileLoadedForUid.
    if (profileLoadedForUid.current !== user.uid) return;

    const uid = user.uid;
    const profile = { currentSemesterTarget, completedCourseKeys, externalCredits };
    pendingProfileWriteRef.current = { uid, profile };
    setProfileUnsaved(true);

    clearTimeout(profileSaveTimeoutRef.current);
    profileSaveTimeoutRef.current = setTimeout(() => {
      persistProfile(uid, profile).then((saved) => {
        // A failed write stays pending, so the unmount/pagehide/sign-out
        // flushes, the next change and the "online" retry all resend it.
        if (!saved) return;
        // Only clear if nothing newer has queued up behind this write.
        if (pendingProfileWriteRef.current === null) return;
        const pending = pendingProfileWriteRef.current;
        if (pending.uid === uid && pending.profile === profile) {
          pendingProfileWriteRef.current = null;
          setProfileUnsaved(false);
        }
      });
    }, 800);

    // Only clears the pending *timer* — pendingProfileWriteRef is
    // deliberately left alone so a later unmount/pagehide can still catch
    // and flush this write. Clearing it here would defeat the debounce.
    return () => clearTimeout(profileSaveTimeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSemesterTarget, completedCourseKeys, externalCredits, user, authLoading]);

  // Flushes a still-pending signed-in profile write (see
  // pendingProfileWriteRef above) when the component unmounts within the
  // debounce window — e.g. a guest clicks "Sign in" or a signed-in user
  // navigates to /scheduler less than 800ms after locking a course.
  // Deliberately its own effect with an empty dep array: folding this into
  // the debounced effect's own cleanup would fire on every dependency
  // change too, defeating the debounce rather than just catching unmount.
  useEffect(() => {
    return () => {
      const pending = pendingProfileWriteRef.current;
      if (pending) persistProfile(pending.uid, pending.profile);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best-effort backstop: pagehide fires on tab close / backgrounding in
  // cases (mobile Safari, etc.) where React's unmount cleanup above may not
  // run in time. Same flush, triggered by the browser instead of React.
  useEffect(() => {
    function handlePageHide() {
      const pending = pendingProfileWriteRef.current;
      if (pending) persistProfile(pending.uid, pending.profile);
    }
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  // Offline badge + retry: track connectivity, and when the browser comes back
  // online resend whatever is still pending — the plan edit (via the same
  // flush the other leave paths use) and a profile write that failed or hung.
  useEffect(() => {
    function handleOnline() {
      setOnline(true);
      flushPlanRef.current?.();
      const pending = pendingProfileWriteRef.current;
      if (pending && auth.currentUser?.uid === pending.uid) {
        persistProfile(pending.uid, pending.profile).then((saved) => {
          if (saved && pendingProfileWriteRef.current === pending) {
            pendingProfileWriteRef.current = null;
            setProfileUnsaved(false);
          }
        });
      }
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Local plan management (for auth-optional browsing) ─────────────────────
  // externalCredits is deliberately absent here — it's student-level now,
  // not plan-level, and lives in PROFILE_STORAGE_KEY (see saveLocalProfile)
  // instead of this per-plan blob.
  function saveLocalPlan(overrides = {}) {
    const plan = {
      name: overrides.name ?? planName,
      major: overrides.major ?? '',
      majorBulletinUrl: overrides.majorBulletinUrl ?? majorBulletinUrl,
      semesters: overrides.semesters ?? semesters,
      gridSummerTerms: overrides.gridSummerTerms ?? gridSummerTerms,
      isTransfer: overrides.isTransfer ?? isTransfer,
      extraTerms: overrides.extraTerms ?? extraTerms,
      cumulativeGpa: overrides.cumulativeGpa ?? cumulativeGpa,
      earnedCredits: overrides.earnedCredits ?? earnedCredits,
      gradePoints: overrides.gradePoints ?? gradePoints,
      requirementOverrides: overrides.requirementOverrides ?? requirementOverrides,
      stash: overrides.stash ?? stash,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(plan));
    debugPlanner('saveLocalPlan-written', plan);
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
        // externalCredits deliberately not read here — it's student-level
        // now, loaded from PROFILE_STORAGE_KEY instead (see the caller).
        debugPlanner('loadLocalPlan-read', plan);
        setCumulativeGpa(plan.cumulativeGpa ?? null);
        setEarnedCredits(plan.earnedCredits ?? null);
        setGradePoints(plan.gradePoints ?? null);
        setRequirementOverrides(plan.requirementOverrides ?? {});
        const localStash = plan.stash || [];
        setStash(localStash);
        setIsDirty(false);
        const extraKeys = (plan.extraTerms || []).flatMap((t) => t.courseKeys || []);
        const summerKeys = Object.values(plan.gridSummerTerms || {}).flatMap(
          (entries) => entriesCourseKeys(entries),
        );
        const allKeys = [
          ...localSemesters.flatMap((sem) => entriesCourseKeys(sem)),
          ...extraKeys,
          ...summerKeys,
          ...localStash,
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
    const ref = await addDoc(collection(db, 'users', uid, 'plans'), withoutUndefined({
      name,
      major: guestPlan.major || '',
      majorBulletinUrl: guestPlan.majorBulletinUrl ?? null,
      semesters: semestersToFirestore(normalizeSemesters(guestPlan.semesters)),
      gridSummerTerms: normalizeGridSummerTerms(guestPlan.gridSummerTerms),
      isTransfer: guestPlan.isTransfer || false,
      extraTerms: guestPlan.extraTerms || [],
      // Deliberately still written here even though plan docs otherwise stop
      // owning externalCredits (see persistPlan/createDefaultPlan): by the
      // time loadUserProfile runs, migrateGuestPlanIfNeeded has already
      // cleared LOCAL_STORAGE_KEY, so this migrated doc is the only place
      // the guest's AP/IB/transfer credits still exist for
      // loadUserProfile's plan-docs migration to pick up into the account
      // profile. It then becomes exactly the same kind of read-only legacy
      // backup as externalCredits on any other pre-existing plan doc.
      externalCredits: normalizeExternalCredits(guestPlan.externalCredits),
      cumulativeGpa: guestPlan.cumulativeGpa ?? null,
      earnedCredits: guestPlan.earnedCredits ?? null,
      gradePoints: guestPlan.gradePoints ?? null,
      requirementOverrides: guestPlan.requirementOverrides ?? {},
      stash: guestPlan.stash || [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, 'migrateGuestPlan'));
    if (import.meta.env.DEV) console.log('✅ Guest plan migrated to Firestore:', ref.id);
    return ref.id;
  }

  // One-time backfill for accounts that predate account-level
  // externalCredits: the old per-plan field is never cleared (see
  // persistPlan/createDefaultPlan/migrateGuestPlan), so this pulls whatever
  // still sits on each of the account's plan docs into one deduped list.
  // Called from loadUserProfile only when the account doc has no
  // externalCredits field of its own yet.
  // Content-equality key for cross-plan dedup, matching applyImport's own
  // dedup rules in transcriptMapping.js exactly (AP by type+courseKey,
  // transfer by sourceTitle+institution+courseKey) — extended to also
  // cover an AP/IB row with no courseKey (never produced by applyImport
  // itself, which skips those, but perfectly possible here since these
  // credits can come from years of independent per-plan manual entry).
  function keyPart(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function externalCreditContentKey(credit) {
    if (credit.type === 'ap' || credit.type === 'ib') {
      // testSubject included even alongside courseKey — two different exams
      // can resolve to the same BU course (e.g. two related AP sciences),
      // and those shouldn't merge into one credit.
      return credit.courseKey
        ? `${credit.type}:key:${credit.courseKey}:${keyPart(credit.testSubject)}`
        : `${credit.type}:fallback:${keyPart(credit.testSubject)}:${keyPart(credit.score)}:${keyPart(credit.sourceTitle)}`;
    }
    // transfer (normalizeType's own fallback for anything unrecognized, so
    // this covers every remaining case)
    return `transfer:${credit.sourceTitle ?? ''}:${credit.institution ?? ''}:${credit.courseKey ?? ''}`;
  }

  // A student-entered override on an AP/IB row (see normalizeExternalCredit
  // in externalCredits.js) — worth protecting from being silently dropped
  // by the content-dedupe pass below even when the copy that has it isn't
  // the most recently updated one.
  function hasManualOverride(credit) {
    return Boolean(
      (Array.isArray(credit.manualHubUnits) && credit.manualHubUnits.length > 0)
      || credit.manualCourseKey
      || (Array.isArray(credit.manualCourses) && credit.manualCourses.length > 0)
      || credit.advisorNote,
    );
  }

  // Intentionally does not catch — a failed plan query must not resolve to
  // "no external credits" (see loadUserProfile, which never calls
  // setExternalCredits/persistProfile/sets profileLoadedForUid if this
  // throws; initForUser's own catch logs it and the next load retries).
  async function migratePlanExternalCredits(uid) {
    const plansSnap = await getDocs(collection(db, 'users', uid, 'plans'));
    // Oldest-updated first, so iterating in order and overwriting on a
    // match — by id, then again by content — naturally leaves the copy
    // from the most recently updated plan for both passes.
    const planDocs = plansSnap.docs
      .map((d) => d.data())
      .sort((a, b) => (a.updatedAt?.toMillis?.() ?? 0) - (b.updatedAt?.toMillis?.() ?? 0));
    const byId = new Map();
    for (const planData of planDocs) {
      for (const credit of normalizeExternalCredits(planData.externalCredits)) {
        byId.set(credit.id, credit);
      }
    }
    // Different plans can independently hold the same real-world credit
    // under different generated ids (e.g. the same AP score entered by
    // hand in two plans before externalCredits became shared) — the id
    // union above can't catch that, so dedupe again by content, same rule
    // applyImport uses. Whichever copy wins keeps all of its own fields
    // (score, manualHubUnits, manualCourseKey, manualCourses, advisorNote)
    // as-is; nothing is cherry-picked from the losing copy. A copy with a
    // manual override beats a same-key copy without one regardless of plan
    // recency — a student's own correction shouldn't get silently
    // overwritten by an older, unedited duplicate just because it happens
    // to live in a more recently touched plan; recency only breaks the tie
    // when both or neither copy has one.
    const byContent = new Map();
    for (const credit of byId.values()) {
      const key = externalCreditContentKey(credit);
      const existing = byContent.get(key);
      const keepExisting = existing && hasManualOverride(existing) && !hasManualOverride(credit);
      if (!keepExisting) {
        byContent.set(key, credit);
      }
    }
    return Array.from(byContent.values());
  }

  // Loads the student-level profile (current semester, completed courses,
  // and AP/IB/transfer credits) from the top-level `users/{uid}` doc —
  // separate from any plan doc, and loaded once per sign-in rather than per
  // plan (see initForUser above). If the account has never saved a profile
  // yet, adopts whatever this browser had saved while browsing as a guest
  // (if anything) so that doesn't get silently dropped on sign-in, matching
  // how a guest plan itself is migrated. If BOTH an account profile and a
  // local guest profile exist (e.g. this browser was used as a guest again
  // after already having an account), they're merged rather than letting
  // one silently clobber the other — completedCourseKeys/externalCredits
  // are the union, and currentSemesterTarget prefers the account's value,
  // falling back to the local one only if the account never set one.
  //
  // externalCredits is migrated independently of currentSemesterTarget/
  // completedCourseKeys (see migratePlanExternalCredits above) — an account
  // can easily have already migrated the latter in an earlier session while
  // still missing externalCredits, since that field is newer.
  async function loadUserProfile(uid) {
    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.exists() ? snap.data() : null;
    const hasAccountProfile = data != null && Object.prototype.hasOwnProperty.call(data, 'completedCourseKeys');
    const hasAccountExternalCredits = data != null && Object.prototype.hasOwnProperty.call(data, 'externalCredits');
    const hasLocalProfile = localStorage.getItem(PROFILE_STORAGE_KEY) != null;
    const local = hasLocalProfile ? loadLocalProfile() : null;

    // --- currentSemesterTarget / completedCourseKeys ---
    let target;
    let keys;
    let needsPersist = false;
    if (hasAccountProfile && !hasLocalProfile) {
      target = data.currentSemesterTarget ?? null;
      keys = data.completedCourseKeys ?? [];
    } else if (!hasAccountProfile && !hasLocalProfile) {
      target = null;
      keys = [];
    } else {
      // A local guest profile exists — either merge it into the account's
      // existing profile, or adopt it outright for an account that's never
      // saved one.
      target = hasAccountProfile
        ? (data.currentSemesterTarget ?? local.currentSemesterTarget ?? null)
        : local.currentSemesterTarget;
      keys = hasAccountProfile
        ? Array.from(new Set([...(data.completedCourseKeys ?? []), ...local.completedCourseKeys]))
        : local.completedCourseKeys;
      needsPersist = true;
    }

    // --- externalCredits: independent one-time migration off old per-plan
    // data, plus the same local-guest-merge as above ---
    let externalCredits;
    if (hasAccountExternalCredits) {
      externalCredits = normalizeExternalCredits(data.externalCredits);
    } else {
      externalCredits = await migratePlanExternalCredits(uid);
      needsPersist = true;
    }
    if (hasLocalProfile) {
      const localExternalCredits = normalizeExternalCredits(local.externalCredits);
      if (localExternalCredits.length > 0) {
        const byId = new Map(externalCredits.map((c) => [c.id, c]));
        let addedAny = false;
        for (const credit of localExternalCredits) {
          if (!byId.has(credit.id)) {
            byId.set(credit.id, credit);
            addedAny = true;
          }
        }
        if (addedAny) {
          externalCredits = Array.from(byId.values());
          needsPersist = true;
        }
      }
    }

    setCurrentSemesterTarget(target);
    setCompletedCourseKeys(keys);
    setExternalCredits(externalCredits);

    if (needsPersist) {
      // Persist the merged/migrated result before dropping the local copy —
      // if the write fails, leave the guest data in place rather than lose it.
      const persisted = await persistProfile(uid, { currentSemesterTarget: target, completedCourseKeys: keys, externalCredits });
      if (persisted && hasLocalProfile) {
        localStorage.removeItem(PROFILE_STORAGE_KEY);
      }
    }
    profileLoadedForUid.current = uid;
  }

  // `profile` is { currentSemesterTarget, completedCourseKeys, externalCredits }.
  async function persistProfile(uid, profile) {
    try {
      await setDoc(
        doc(db, 'users', uid),
        withoutUndefined({
          currentSemesterTarget: profile.currentSemesterTarget,
          completedCourseKeys: profile.completedCourseKeys,
          externalCredits: profile.externalCredits,
        }, 'profile'),
        { merge: true },
      );
      return true;
    } catch (err) {
      console.error('Error saving profile:', err);
      // Same badge the plan save uses.
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
      return false;
    }
  }

  // Signing out doesn't unmount PlannerPage, so neither the unmount-flush
  // effect nor the pagehide listener (see pendingProfileWriteRef) would ever
  // catch a still-debounced profile write — it'd be stuck for a uid the app
  // no longer has permission to write as. Flush it here instead, while
  // still authenticated, before actually calling signOut(). persistProfile
  // already swallows its own errors (returns false rather than throwing),
  // so a failed flush still falls through to signOut() below.
  async function handleSignOut() {
    const pending = pendingProfileWriteRef.current;
    if (pending) {
      clearTimeout(profileSaveTimeoutRef.current);
      await persistProfile(pending.uid, pending.profile);
    }
    pendingProfileWriteRef.current = null;
    profileLoadedForUid.current = null;
    await signOut(auth);
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
    // A missing doc on the initial load would otherwise leave the board on
    // "Loading your plans…" forever; once a plan is showing, the flag has no
    // visible effect (the error only renders while activePlanId is null).
    if (!snap.exists()) {
      setPlanLoadError(true);
      return;
    }
    const data = snap.data();
    const semData = semestersFromFirestore(data.semesters);
    const summerData = normalizeGridSummerTerms(data.gridSummerTerms);
    const extra = data.extraTerms ?? [];
    debugPlanner('loadPlan-from-firestore', { planId, ...data });
    setActivePlanId(planId);
    setPlanName(data.name ?? 'My Plan');
    setSemesters(semData);
    setGridSummerTerms(summerData);
    setIsTransfer(data.isTransfer ?? false);
    setMajorBulletinUrl(data.majorBulletinUrl ?? null);
    setExtraTerms(extra);
    // externalCredits deliberately not read from the plan doc here — it's
    // student-level now (see loadUserProfile), and setting it per plan-load
    // would overwrite that global value every time a plan switches. Any
    // externalCredits still sitting on this doc (see persistPlan/
    // createDefaultPlan) is legacy, read-only data, not the live source.
    setCumulativeGpa(data.cumulativeGpa ?? null);
    setEarnedCredits(data.earnedCredits ?? null);
    setGradePoints(data.gradePoints ?? null);
    setRequirementOverrides(data.requirementOverrides ?? {});
    const loadedStash = data.stash ?? [];
    setStash(loadedStash);
    setIsDirty(false);
    if (list) setPlans(list);
    const allKeys = [
      ...semData.flatMap((sem) => entriesCourseKeys(sem)),
      ...extra.flatMap((t) => t.courseKeys || []),
      ...Object.values(summerData).flatMap((entries) => entriesCourseKeys(entries)),
      ...loadedStash,
    ];
    if (allKeys.length > 0) {
      await fetchCourseData(allKeys);
    }
    isInitialLoad.current = false;
  }

  // `seed`, when given, is { semesters, gridSummerTerms } to start the new
  // plan's grid from instead of a blank one — see handleNewPlan, which
  // builds it from the currently-open plan's already-locked courses. Every
  // other call site (first plan on a brand-new account, guest-plan
  // migration) omits it and gets the original blank-grid behavior.
  // handleImportPlan (plan PDF import) also passes the optional name,
  // majorBulletinUrl, isTransfer, extraTerms, stash and requirementOverrides
  // (each defaulting to the blank-plan value), plus expectedUid: the account
  // it was confirmed under, re-checked right before the write.
  async function createDefaultPlan(uid, seed = null) {
    isInitialLoad.current = true;
    const name = await uniquePlanName(uid, seed?.name ?? 'My Plan');
    const seedSemesters = seed?.semesters ?? EMPTY_SEMESTERS();
    const seedGridSummerTerms = seed?.gridSummerTerms ?? {};
    const seedMajorBulletinUrl = seed?.majorBulletinUrl ?? null;
    const seedIsTransfer = seed?.isTransfer ?? false;
    const seedExtraTerms = seed?.extraTerms ?? [];
    const seedStash = seed?.stash ?? [];
    const seedRequirementOverrides = seed?.requirementOverrides ?? {};
    if (seed?.expectedUid && auth.currentUser?.uid !== seed.expectedUid) {
      throw new Error('Your sign-in changed, so nothing was imported. Close this and try again.');
    }
    const ref = await addDoc(collection(db, 'users', uid, 'plans'), {
      name,
      major: '',
      majorBulletinUrl: seedMajorBulletinUrl,
      semesters: semestersToFirestore(seedSemesters),
      gridSummerTerms: seedGridSummerTerms,
      isTransfer: seedIsTransfer,
      extraTerms: seedExtraTerms,
      cumulativeGpa: null,
      earnedCredits: null,
      gradePoints: null,
      requirementOverrides: seedRequirementOverrides,
      stash: seedStash,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActivePlanId(ref.id);
    setPlanName(name);
    setSemesters(seedSemesters);
    setGridSummerTerms(seedGridSummerTerms);
    setIsTransfer(seedIsTransfer);
    setMajorBulletinUrl(seedMajorBulletinUrl);
    setExtraTerms(seedExtraTerms);
    setCumulativeGpa(null);
    setEarnedCredits(null);
    setGradePoints(null);
    setRequirementOverrides(seedRequirementOverrides);
    setStash(seedStash);
    // currentSemesterTarget/completedCourseKeys/externalCredits deliberately
    // untouched — see their declaration above; a new plan starts empty
    // (aside from any seeded locked courses) but still carries the
    // student's own current-semester marker, completed-course list, and
    // AP/IB/transfer credits.
    setPlans([{ id: ref.id, name }]);
    setIsDirty(false);
    isInitialLoad.current = false;
    return name;
  }

  // Sends the latest unsent plan edit (see pendingPlanWriteRef), with the
  // uid/planId/data captured when it was made. Resolves true when there was
  // nothing to send or it saved; false when it failed (the edit is kept for
  // the next flush) or the signed-in user changed (the edit is dropped —
  // never written as someone else).
  function flushPendingPlanWrite() {
    clearTimeout(saveTimeoutRef.current);
    const pending = pendingPlanWriteRef.current;
    if (!pending) return Promise.resolve(true);
    pendingPlanWriteRef.current = null;
    if (auth.currentUser?.uid !== pending.uid) return Promise.resolve(false);
    return persistPlan(
      pending.uid, pending.planId, pending.name, pending.semesters, pending.isTransfer, pending.extras, pending.version,
    ).then((saved) => {
      if (!saved && !pendingPlanWriteRef.current) pendingPlanWriteRef.current = pending;
      return saved;
    });
  }

  function discardPendingPlanWrite() {
    clearTimeout(saveTimeoutRef.current);
    pendingPlanWriteRef.current = null;
  }

  // `version` is the edit this write is a snapshot of (defaults to the latest
  // edit at call time). An edit made while it's in flight is newer: it stays
  // dirty and its own debounce timer, already scheduled, sends it.
  async function persistPlan(uid, planId, name, semData, transfer, extras = {}, version = editVersionRef.current) {
    planSavesInFlightRef.current += 1;
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
      if (import.meta.env.DEV) console.log('🔄 [persistPlan] Starting save:', debugLog);

      if (!uid) throw new Error('Missing uid');
      if (!planId) throw new Error('Missing planId');

      const planRef = doc(db, 'users', uid, 'plans', planId);
      if (import.meta.env.DEV) console.log('📍 [persistPlan] Plan ref path:', planRef.path);

      const payload = {
        name,
        semesters: semestersToFirestore(semData),
        gridSummerTerms: extras.gridSummerTerms ?? gridSummerTerms,
        isTransfer: transfer,
        majorBulletinUrl: extras.majorBulletinUrl ?? majorBulletinUrl,
        extraTerms: extras.extraTerms ?? extraTerms,
        // externalCredits deliberately omitted — it's student-level now
        // (see loadUserProfile/persistProfile), not written per plan.
        // `updateDoc` only touches the fields listed here, so this leaves
        // whatever legacy externalCredits already sits on the doc alone
        // rather than clearing it — see the "read-only backup" note on
        // migrateGuestPlan.
        cumulativeGpa: extras.cumulativeGpa ?? cumulativeGpa,
        earnedCredits: extras.earnedCredits ?? earnedCredits,
        gradePoints: extras.gradePoints ?? gradePoints,
        requirementOverrides: extras.requirementOverrides ?? requirementOverrides,
        stash: extras.stash ?? stash,
        updatedAt: serverTimestamp(),
      };

      if (import.meta.env.DEV) {
        console.log('💾 [persistPlan] Sending payload:', {
          ...payload,
          updatedAt: '(server-timestamp)',
        });
      }
      debugPlanner('persistPlan-payload', { planId, ...payload });

      await updateDoc(planRef, payload);

      const writtenSnap = await getDoc(planRef);
      const written = writtenSnap.exists() ? writtenSnap.data() : null;
      debugPlanner('persistPlan-firestore-readback', { planId, ...written });

      if (import.meta.env.DEV) console.log('✅ [persistPlan] Write succeeded');
      // Only clear dirty (and show "Saved") if no edit happened after this
      // snapshot — clearing it would cancel the newer edit's pending timer.
      if (version >= editVersionRef.current) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(''), 2500);
        setIsDirty(false);
      }
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
      // Writes can overlap (one in flight, a newer one sent) — stay
      // "Saving…" until the last one settles.
      planSavesInFlightRef.current -= 1;
      setSaving(planSavesInFlightRef.current > 0);
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
      fetchCredits(Object.keys(newCourses), newCourses);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseMap],
  );

  // Fetch credits from sections (batched)
  async function fetchCredits(courseKeys, courseDocs = {}) {
    const missing = courseKeys.filter((k) => !(k in creditsMap));
    if (missing.length === 0) return;
    const newCredits = {};
    for (let i = 0; i < missing.length; i += 30) {
      const batch = missing.slice(i, i + 30);
      const snap = await getDocs(
        query(collection(db, 'sections'), where('courseKey', 'in', batch)),
      );
      // Prefer a CURRENT_TERM section's credits; any other term only fills
      // in keys that have none.
      const fallbackCredits = {};
      snap.docs.forEach((d) => {
        const { courseKey, credits, term } = d.data();
        if (credits == null) return;
        if (term === CURRENT_TERM) {
          if (!(courseKey in newCredits)) newCredits[courseKey] = credits;
        } else if (!(courseKey in fallbackCredits)) {
          fallbackCredits[courseKey] = credits;
        }
      });
      for (const [k, v] of Object.entries(fallbackCredits)) {
        if (!(k in newCredits)) newCredits[k] = v;
      }
    }
    // Courses with no section credits in any term fall back to the course
    // doc's own `credits` (see scripts/import-credits.cjs). Sections win.
    for (const k of missing) {
      const own = courseDocs[k]?.credits;
      if (!(k in newCredits) && typeof own === 'number' && own > 0) newCredits[k] = own;
    }
    setCreditsMap((prev) => ({ ...prev, ...newCredits }));
  }

  // ── Plan CRUD callbacks ───────────────────────────────────────────────────

  async function handleSelectPlan(planId) {
    if (planId === activePlanId) return;
    // Save the open plan's last edits before its state is replaced; if that
    // fails, stay on it (the error badge shows) rather than drop them.
    if (!(await flushPendingPlanWrite())) return;
    loadPlan(user.uid, planId, null);
  }

  async function handleNewPlan() {
    // Same as handleSelectPlan: save the open plan's last edits first.
    if (!(await flushPendingPlanWrite())) return;
    // Carry the student's already-completed (locked) courses into the new
    // plan, at the same slot they occupy in the plan currently open —
    // locking is global (completedCourseKeySet), but a brand-new plan
    // otherwise starts with a blank grid, so without this the new plan
    // would show courses the student has already taken as if they still
    // needed to be planned. Non-locked entries are dropped; everything else
    // (stash, externalCredits, extraTerms, requirementOverrides, GPA
    // fields, major) still starts blank, same as before.
    const seedSemesters = semesters.map((entries) =>
      entries.filter((entry) => completedCourseKeySet.has(entryCourseKey(entry))),
    );
    const seedGridSummerTerms = Object.fromEntries(
      Object.entries(gridSummerTerms)
        .map(([year, entries]) => [
          year,
          entries.filter((entry) => completedCourseKeySet.has(entryCourseKey(entry))),
        ])
        // Drop years with nothing left to seed rather than toggle on an
        // empty Summer column in an otherwise-blank plan.
        .filter(([, entries]) => entries.length > 0),
    );
    const hasLockedCourses = seedSemesters.some((entries) => entries.length > 0)
      || Object.keys(seedGridSummerTerms).length > 0;
    // No locked courses to carry over — same blank-grid plan as before.
    const seed = hasLockedCourses ? { semesters: seedSemesters, gridSummerTerms: seedGridSummerTerms } : null;

    if (seed) {
      const seedKeys = [
        ...seedSemesters.flatMap((entries) => entriesCourseKeys(entries)),
        ...Object.values(seedGridSummerTerms).flatMap((entries) => entriesCourseKeys(entries)),
      ];
      // These courses came from the plan already open, so courseMap should
      // already have their data — this is a safety net, not expected to do
      // real work (fetchCourseData no-ops on keys it already has).
      fetchCourseData(seedKeys);
    }

    await createDefaultPlan(user.uid, seed);
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
    const deletingOpenPlan = planId === activePlanId;
    // The open plan's pending edit has nowhere to go once it's deleted —
    // stop its timer now; it's dropped below once the delete succeeds.
    if (deletingOpenPlan) clearTimeout(saveTimeoutRef.current);
    await deleteDoc(doc(db, 'users', user.uid, 'plans', planId));
    const remaining = plans.filter((p) => p.id !== planId);
    // Deleting some other plan leaves the open one (and its edits) alone.
    if (!deletingOpenPlan) {
      setPlans(remaining);
      return;
    }
    discardPendingPlanWrite();
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

  // Free-text planning placeholders (see isNoteEntry in courseEntry.js) —
  // matched by their own id, never courseKey, so they can't collide with
  // the course handlers above (entryCourseKey is null for a note).
  // Returns the new note's id so the column can open it in edit mode.
  function handleAddNote(target) {
    const note = createNoteEntry();
    setEntriesAtTarget(target, (entries) => [...entries, note]);
    setIsDirty(true);
    return note.id;
  }

  function handleUpdateNote(noteId, target, patch) {
    setEntriesAtTarget(target, (entries) => entries.map((e) => (
      isNoteEntry(e) && e.id === noteId ? { ...e, ...patch } : e
    )));
    setIsDirty(true);
  }

  function handleRemoveNote(noteId, target) {
    setEntriesAtTarget(target, (entries) => entries.filter((e) => !(isNoteEntry(e) && e.id === noteId)));
    setIsDirty(true);
  }

  // Student discretion, not enforcement — any course can be locked/unlocked
  // regardless of source. Locked cards disable their own drag/remove in
  // CourseCard, so this handler doesn't need to guard against those.
  //
  // "Locked" is a fact about the courseKey itself (completedCourseKeys),
  // not about where the card happens to sit in *this* plan — so toggling it
  // here carries straight over to every other plan of this student's that
  // also has this course, instead of being reset per-plan.
  function handleToggleLock(courseKey) {
    setCompletedCourseKeys((prev) => (
      prev.includes(courseKey) ? prev.filter((k) => k !== courseKey) : [...prev, courseKey]
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

  // Bulk lock/unlock every course in one semester slot at once — the
  // student-facing "lock/unlock this whole semester" control, built on the
  // same global completedCourseKeys set CourseCard's own lock button uses
  // (see handleToggleLock), so a semester is never more than a set of
  // individually-lockable cards. Locks all when any course is unlocked,
  // unlocks all when every course is already locked, so one click always
  // does the obvious thing.
  function handleToggleSemesterLock(target) {
    const keys = entriesCourseKeys(entriesAtTarget(target));
    if (keys.length === 0) return;
    const allLocked = keys.every((key) => completedCourseKeySet.has(key));
    setCompletedCourseKeys((prev) => {
      const set = new Set(prev);
      keys.forEach((key) => (allLocked ? set.delete(key) : set.add(key)));
      return Array.from(set);
    });
    setIsDirty(true);
  }

  // Marks `target` (a grid index or `summer:{year}` string — see
  // isSummerTarget) as the semester the student is currently in, and
  // auto-locks every course in this plan's slots that just became
  // chronologically past (see getSemesterStatus) — into the same global
  // completedCourseKeys set the manual lock button above uses, never a
  // separate "semester is locked" state, so the student can freely unlock
  // any one of them again (or re-lock/unlock the whole semester via
  // handleToggleSemesterLock). Only the slots that just became past are
  // touched, so advancing further never re-locks something the student
  // already chose to unlock. Picking the already-current slot again clears
  // the marker without touching any locks.
  function handleSetCurrentSemester(target) {
    const prevTarget = currentSemesterTarget;
    const nextTarget = prevTarget === target ? null : target;
    setCurrentSemesterTarget(nextTarget);
    setIsDirty(true);
    if (nextTarget == null) return;

    const becameNewlyPast = (slotTarget) =>
      getSemesterStatus(slotTarget, nextTarget) === 'past'
      && (prevTarget == null || getSemesterStatus(slotTarget, prevTarget) !== 'past');

    const newlyPastKeys = [
      ...semesters.flatMap((entries, i) => (becameNewlyPast(i) ? entriesCourseKeys(entries) : [])),
      ...Object.entries(gridSummerTerms).flatMap(([year, entries]) => (
        becameNewlyPast(`summer:${year}`) ? entriesCourseKeys(entries) : []
      )),
    ];
    if (newlyPastKeys.length === 0) return;
    setCompletedCourseKeys((prev) => {
      const set = new Set(prev);
      let changed = false;
      for (const key of newlyPastKeys) {
        if (!set.has(key)) { set.add(key); changed = true; }
      }
      return changed ? Array.from(set) : prev;
    });
  }

  // Adds one more Fall/Spring pair below the grid — see "VARIABLE YEAR COUNT".
  // Capped at MAX_PLAN_YEARS; plans already past the cap are left as-is.
  function handleAddYear() {
    if (semesters.length / 2 >= MAX_PLAN_YEARS) return;
    setSemesters((prev) => (prev.length / 2 >= MAX_PLAN_YEARS ? prev : [...prev, [], []]));
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

    // Search results and stashed courses aren't on the grid yet — either
    // source just adds straight to the drop target, same as clicking would.
    if (from === 'search' || from === 'stash') {
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

  // pdf-lib (and the PDF drawing code) load only when this is clicked.
  async function handleDownloadPlanPdf() {
    if (planPdfStatus === 'busy') return;
    setPlanPdfStatus('busy');
    try {
      const { downloadPlanPdf } = await import('../utils/planPdf');
      await downloadPlanPdf({
        planName,
        majorBulletinUrl,
        isTransfer,
        semesters,
        serializedSemesters: semestersToFirestore(semesters),
        gridSummerTerms,
        extraTerms,
        stash,
        requirementOverrides,
        completedCourseKeys,
        externalCredits,
        courseMap,
        creditsMap,
        totalCredits,
      });
      setPlanPdfStatus('idle');
    } catch (err) {
      console.error('Plan PDF failed:', err);
      setPlanPdfStatus('error');
    }
  }

  // Plan PDF import (ImportTranscriptModal's plan branch). `plan` is the
  // already-sanitized result of sanitizePlanBlob; `reviewUid` is who was
  // signed in (null = guest) when its Review step opened. Signed in: always a
  // NEW plan via createDefaultPlan, never an overwrite. Guest: only into a
  // blank plan. Throws a user-facing Error on any refusal, having changed
  // nothing. Resolves { name }.
  async function handleImportPlan(plan, reviewUid) {
    const importedKeys = [
      ...plan.semesters.flatMap((entries) => entriesCourseKeys(entries)),
      ...Object.values(plan.gridSummerTerms).flatMap((entries) => entriesCourseKeys(entries)),
      ...plan.extraTerms.flatMap((term) => term.courseKeys || []),
      ...plan.stash,
    ];

    if (!user) {
      if (reviewUid) throw new Error('Your sign-in changed, so nothing was imported. Close this and try again.');
      if (!guestPlanIsBlank) throw new Error('Sign in to import as a new plan.');
      const next = {
        name: plan.name,
        majorBulletinUrl: plan.majorBulletinUrl,
        semesters: plan.semesters,
        gridSummerTerms: plan.gridSummerTerms,
        isTransfer: plan.isTransfer,
        extraTerms: plan.extraTerms,
        requirementOverrides: plan.requirementOverrides,
        stash: plan.stash,
      };
      // localStorage first: if it fails, nothing on screen has changed.
      saveLocalPlan(next);
      setPlanName(next.name);
      setSemesters(next.semesters);
      setGridSummerTerms(next.gridSummerTerms);
      setIsTransfer(next.isTransfer);
      setMajorBulletinUrl(next.majorBulletinUrl);
      setExtraTerms(next.extraTerms);
      setRequirementOverrides(next.requirementOverrides);
      setStash(next.stash);
      setIsDirty(true);
      if (importedKeys.length > 0) {
        fetchCourseData(importedKeys).catch((err) => console.error('Could not load imported course data:', err));
      }
      return { name: next.name };
    }

    if (auth.currentUser?.uid !== user.uid || reviewUid !== user.uid) {
      throw new Error('Your sign-in changed, so nothing was imported. Close this and try again.');
    }
    // Same as handleNewPlan: save the open plan's last edits first, and
    // stay put if that fails.
    if (!(await flushPendingPlanWrite())) {
      throw new Error("Couldn't save your open plan first, so nothing was imported. Try again.");
    }
    let createdName;
    try {
      createdName = await createDefaultPlan(reviewUid, {
        semesters: plan.semesters,
        gridSummerTerms: plan.gridSummerTerms,
        name: plan.name,
        majorBulletinUrl: plan.majorBulletinUrl,
        isTransfer: plan.isTransfer,
        extraTerms: plan.extraTerms,
        stash: plan.stash,
        requirementOverrides: plan.requirementOverrides,
        expectedUid: reviewUid,
      });
    } catch (err) {
      // createDefaultPlan holds autosave off while it runs; a refusal or
      // failed write means the open plan was never replaced, so release it.
      isInitialLoad.current = false;
      console.error('Plan import failed:', err);
      throw err instanceof Error && err.message.startsWith('Your sign-in changed')
        ? err
        : new Error("Couldn't create the plan. Check your connection and try again.");
    }
    if (importedKeys.length > 0) {
      fetchCourseData(importedKeys).catch((err) => console.error('Could not load imported course data:', err));
    }
    loadPlans(reviewUid);
    return { name: createdName };
  }

  async function handleTranscriptImport(result) {
    const normalizedExternalCredits = normalizeExternalCredits(result.externalCredits);
    debugPlanner('handleTranscriptImport-result', {
      transferCredits: normalizedExternalCredits.filter((c) => c?.type === 'transfer'),
      externalCredits: normalizedExternalCredits,
      summary: result.summary,
    });
    const importedCourseKeys = [
      ...result.semesters.flatMap((sem) => entriesCourseKeys(sem)),
      ...result.extraTerms.flatMap((term) => term.courseKeys || []),
    ];
    // Courses the transcript matched into an actual grid slot come back
    // pre-locked (see transcriptMapping.js) — that no longer lives on the
    // entry itself (see completedCourseKeys), so fold it into the global
    // completed list here or the import would silently show them as planned.
    const importedLockedKeys = result.semesters.flatMap(
      (sem) => entriesCourseKeys(sem.filter((e) => e?.locked)),
    );

    setSemesters(result.semesters);
    setExtraTerms(result.extraTerms);
    setExternalCredits(normalizedExternalCredits);
    setCumulativeGpa(result.cumulativeGpa);
    setEarnedCredits(result.earnedCredits);
    setGradePoints(result.gradePoints);
    if (importedLockedKeys.length > 0) {
      setCompletedCourseKeys((prev) => Array.from(new Set([...prev, ...importedLockedKeys])));
    }
    setIsDirty(true);

    if (importedCourseKeys.length > 0) {
      fetchCourseData(importedCourseKeys).catch((err) => {
        console.error('Error loading imported course details:', err);
      });
    }

    // externalCredits is deliberately not part of either payload below — it's
    // student-level now (see setExternalCredits above / loadUserProfile),
    // persisted through the profile autosave effect, not the plan doc.
    if (user && activePlanId) {
      const saved = await persistPlan(user.uid, activePlanId, planName, result.semesters, isTransfer, {
        extraTerms: result.extraTerms,
        cumulativeGpa: result.cumulativeGpa,
        earnedCredits: result.earnedCredits,
        gradePoints: result.gradePoints,
      });
      if (!saved) {
        // The import is already on the board (and dirty, so autosave retries
        // it); tell the modal so it doesn't say the import failed.
        throw Object.assign(new Error('Could not save imported transcript'), { importApplied: true });
      }
    } else {
      // Avoid stale React state when saving a guest import.
      saveLocalPlan({
        semesters: result.semesters,
        extraTerms: result.extraTerms,
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

  function handleAddExternalCredit(newCredits) {
    const normalized = normalizeExternalCredits(Array.isArray(newCredits) ? newCredits : [newCredits]);
    if (!normalized.length) return;
    setExternalCredits((prev) => [...prev, ...normalized]);
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

  // Saved-for-later courses (see SearchPanelTabs' "Paw-tential Courses" tab)
  // — deliberately independent of the planner grid, so stashing/unstashing
  // never touches semesters/gridSummerTerms or the add/remove-course paths.
  function handleAddToStash(courseKey) {
    setStash((prev) => (prev.includes(courseKey) ? prev : [...prev, courseKey]));
    setIsDirty(true);
    if (!courseMap[courseKey]) fetchCourseData([courseKey]);
  }

  function handleRemoveFromStash(courseKey) {
    setStash((prev) => prev.filter((key) => key !== courseKey));
    setIsDirty(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const gridCourseKeys = semesters.flatMap((sem) => entriesCourseKeys(sem));
  const gridSummerCourseKeys = Object.values(gridSummerTerms).flatMap(
    (entries) => entriesCourseKeys(entries),
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
  // The same HUB count the sidebar's HUB tab shows (same hook, same inputs),
  // for the toolbar's "HUB tracker" pill — see SemesterBoard.
  const { fulfilled: hubFulfilled, totalRequired: hubTotal } = useHubProgress({
    semesters,
    extraCourseKeys,
    externalCredits,
    courseMap,
    isTransfer,
  });

  // courseKey -> { locked, semesterStatus } — display-only lookup for the
  // Requirements/HUB tracker's completed/current/planned chip distinction
  // (never fed into evaluateRequirementTree, which only ever sees flat
  // courseKeys). `locked` comes from completedCourseKeySet — the student's
  // own global "I've completed this" list, shared across every plan — and
  // `semesterStatus` ('past'|'current'|'upcoming'|null, see
  // getSemesterStatus) is what actually decides completed vs. current vs.
  // planned: a course in a past semester counts as completed whether or not
  // it's in that list, since currentSemesterTarget is the source of truth
  // for "already happened"; `locked` is only a fallback for a course that
  // isn't chronologically past (e.g. a manually self-marked AP-style
  // course). extraTerms entries carry no semester of their own (they're
  // plain courseKey strings — see courseEntry.js), but they only ever come
  // from a parsed transcript, so every course in there is functionally
  // already-completed.
  const lockStatusMap = useMemo(() => {
    const map = {};
    semesters.forEach((sem, i) => {
      entriesCourseKeys(sem).forEach((key) => {
        map[key] = {
          locked: completedCourseKeySet.has(key),
          semesterStatus: getSemesterStatus(i, currentSemesterTarget),
        };
      });
    });
    Object.entries(gridSummerTerms).forEach(([year, entries]) => {
      entriesCourseKeys(entries).forEach((key) => {
        map[key] = {
          locked: completedCourseKeySet.has(key),
          semesterStatus: getSemesterStatus(`summer:${year}`, currentSemesterTarget),
        };
      });
    });
    extraTerms.forEach((term) => {
      (term.courseKeys || []).forEach((key) => {
        map[key] = { locked: true, semesterStatus: 'past' };
      });
    });
    return map;
  }, [semesters, gridSummerTerms, extraTerms, currentSemesterTarget, completedCourseKeySet]);

  // Unlike HUB (which excludes externalCredits entirely), the requirements
  // engine should see transfer/AP-equivalent courses too — they can satisfy
  // a major requirement even though they never count toward HUB. Falls back
  // to a student's manual course-mapping override (manualCourses/
  // manualCourseKey — see ExternalCreditsPanel.jsx) when auto-resolution
  // came back courseNote-only with no courseKey, e.g. AP Biology — without
  // this fallback, a confirmed override was invisible to every requirement
  // node even though it displayed correctly in the External Credit panel.
  const requirementsCourseKeys = [
    ...gridCourseKeys,
    ...extraCourseKeys,
    ...externalCredits.flatMap((c) =>
      c?.courseKey ? [c.courseKey]
        : Array.isArray(c?.manualCourses) ? c.manualCourses
        : c?.manualCourseKey ? [c.manualCourseKey]
        : []
    ),
  ];

  // Note placeholders have no courseKey, so they're absent from the key
  // lists above (and so from HUB/requirements) — only their own credits
  // are added here, to the plan credit total.
  const planNoteCredits = semesters.reduce((sum, sem) => sum + entriesNoteCredits(sem), 0)
    + Object.values(gridSummerTerms).reduce((sum, entries) => sum + entriesNoteCredits(entries), 0);
  const planCourseCredits = [...gridCourseKeys, ...extraCourseKeys]
    .reduce((sum, key) => sum + (creditsMap[key] ?? 0), 0) + planNoteCredits;

  // Options for "add to" targets — grid semesters plus any toggled-on Summer
  // slots — shared by CourseSearch's dropdown, the SemesterPickerModal
  // fallback picker, and the "I am currently in" selector.
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

    // Transfer counts once mapped to a BU course, or once the student has
    // confirmed it has no BU equivalent (general credit); needs-mapping
    // rows still count 0.
    if (credit.type === 'transfer') {
      const mapped = Boolean(String(credit.courseKey || '').trim());
      return mapped || credit.status === 'no_equivalent' ? sum + creditValue : sum;
    }

    return sum;
  }, 0);

  const totalCredits = planCourseCredits + externalCreditTotal;

  // Mirrors isBlankGuestPlan, from live state: nothing in the guest plan
  // worth protecting, so a plan PDF may be imported into it.
  const guestPlanIsBlank = semesters.every((sem) => sem.length === 0)
    && Object.values(gridSummerTerms).every((entries) => entries.length === 0)
    && extraTerms.length === 0
    && stash.length === 0
    && Object.keys(requirementOverrides).length === 0
    && !majorBulletinUrl
    && cumulativeGpa == null
    && earnedCredits == null
    && gradePoints == null
    && !isTransfer
    && planName === 'My Plan';

  const planIsEmpty = semesters.every((sem) => sem.length === 0)
    && Object.values(gridSummerTerms).every((entries) => entries.length === 0);

  // Signed in but no plan loaded yet (same signal as the `?view=` effect
  // above) — either still loading or planLoadError. Guests never hit this.
  const plansPending = Boolean(user) && !activePlanId;

  const planImportBlockedReason = plansPending
    ? 'Your plans are still loading. Close this and try again in a moment.'
    : !user && !guestPlanIsBlank
      ? 'Sign in to import as a new plan.'
      : null;

  // Toolbar menu items (see HeaderMenu): shared by the wide "Import" menu
  // and the narrow "PDF" menu.
  const openImportModal = (variant) => { setImportVariant(variant); setShowImportModal(true); };
  const downloadPdfDisabled = plansPending || planIsEmpty || planPdfStatus === 'busy';
  const importMenuItems = [
    { key: 'plan', label: 'Import plan PDF', onSelect: () => openImportModal('plan') },
    { key: 'transcript', label: 'Import transcript', onSelect: () => openImportModal('transcript') },
  ];
  const pdfMenuItems = [
    ...importMenuItems,
    {
      key: 'download',
      label: 'Download plan PDF',
      dividerBefore: true,
      disabled: downloadPdfDisabled,
      hint: planPdfStatus === 'busy' ? 'Making PDF…'
        : planPdfStatus === 'error' ? "Couldn't make PDF, try again"
          : planIsEmpty ? 'Add a course first'
            : null,
      onSelect: handleDownloadPlanPdf,
    },
  ];

  // Offline with something still unsent: show that instead of a "Saving…"
  // that can't finish until the connection is back.
  const offlineUnsaved = Boolean(user) && !online && (isDirty || saving || profileUnsaved);

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
      <AppHeader
        active="planner"
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpenHelp={() => setShowHelpModal(true)}
        onSignOut={() => requestLeave(handleSignOut)}
        onSignIn={() =>
          requestLeave(() => {
            // Only a guest who actually edited has anything to migrate; a
            // blank default plan would otherwise become an account plan.
            if (isDirty) saveLocalPlan();
            window.location.href = '/login';
          })
        }
      >
        {/* Plan switcher / new / delete hidden until a plan has loaded, so
            nothing runs against the half-loaded default state. */}
        {plansPending ? null : user ? (
          <>
            <PlanSelector
              plans={plans}
              activePlanId={activePlanId}
              planName={planName}
              saving={saving && !offlineUnsaved}
              saveStatus={offlineUnsaved ? 'offline' : saveStatus}
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
          <>
            <div
              className="planner-guest-label guest-notice-text"
              title="Browsing as guest — your plan is saved only in this browser. Sign in to keep it."
            >
              <strong>Browsing as guest</strong> — your plan is saved only in this browser. Sign in to keep it.
            </div>
            <GuestSignInButton className="guest-signin-btn" onBeforeSignIn={() => { if (isDirty) saveLocalPlan(); }}>
              <span className="btn-import-transcript-icon" aria-hidden="true">Sign in</span>
              <span className="btn-import-transcript-label">Sign in with Google</span>
            </GuestSignInButton>
          </>
        )}
        {/* Wide: "Import" menu + a separate Download button. Narrow: one "PDF"
            menu holding all three. CSS (planner.css) picks which shows; both
            use the same items and handlers. */}
        <HeaderMenu className="pdf-menu-wide" label="Import" items={importMenuItems} />
        <button
          type="button"
          className="pdf-menu-btn pdf-download-btn"
          onClick={handleDownloadPlanPdf}
          disabled={downloadPdfDisabled}
          title={planIsEmpty ? 'Add a course first' : 'Download plan PDF'}
        >
          {planPdfStatus === 'busy' ? 'Making PDF…' : planPdfStatus === 'error' ? "Couldn't make PDF, try again" : 'Download plan PDF'}
        </button>
        <HeaderMenu className="pdf-menu-narrow" label="PDF" items={pdfMenuItems} />
      </AppHeader>

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
          <aside className={`planner-left${leftCollapsed ? ' is-collapsed' : ''}`}>
            {isDesktopLayout && !leftCollapsed && (
              <div className="planner-panel-header">
                <PanelCollapseButton side="left" name="search" onClick={() => setLeftCollapsed(true)} />
              </div>
            )}
            {leftCollapsed && (
              <PanelRail side="left" name="search" text="Search" onExpand={() => setLeftCollapsed(false)} />
            )}
            <SearchPanelTabs
              theme={theme}
              activeSemIndex={activeSemIndex}
              onActiveSemChange={setActiveSemIndex}
              semesterOptions={semesterOptions}
              coursesInPlan={coursesInPlan}
              onAddCourse={handleAddCourse}
              rangeFilter={rangeFilter}
              onClearRangeFilter={() => setRangeFilter(null)}
              stash={stash}
              courseMap={courseMap}
              onAddToStash={handleAddToStash}
              onRemoveFromStash={handleRemoveFromStash}
              onShowCourseInfo={setInfoCourseKey}
              onOpenHubFullView={openHubFullView}
            />
          </aside>

          {/* Center: semester board */}
          <main className="planner-center">
            {plansPending ? (
              planLoadError ? (
                <div className="planner-plans-status" role="alert">
                  <p>Couldn&apos;t load your plans. Reload to try again.</p>
                </div>
              ) : (
                <div className="planner-plans-status" role="status" aria-live="polite">
                  <img
                    className="auth-loading-paw"
                    src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
                    alt=""
                    width={32}
                    height={32}
                  />
                  <p>Loading your plans…</p>
                </div>
              )
            ) : (
              <>
                <SemesterBoard
                  semesters={semesters}
                  gridSummerTerms={gridSummerTerms}
                  courseMap={courseMap}
                  creditsMap={creditsMap}
                  activeTarget={activeSemIndex}
                  onSemesterClick={setActiveSemIndex}
                  onRemoveCourse={handleRemoveCourse}
                  onToggleLock={handleToggleLock}
                  onToggleSemesterLock={handleToggleSemesterLock}
                  onToggleSummerYear={handleToggleSummerYear}
                  onAddYear={handleAddYear}
                  maxYears={MAX_PLAN_YEARS}
                  onAddNote={handleAddNote}
                  onUpdateNote={handleUpdateNote}
                  onRemoveNote={handleRemoveNote}
                  draggingId={draggingId}
                  semesterOptions={semesterOptions}
                  currentSemesterTarget={currentSemesterTarget}
                  onSetCurrentSemester={handleSetCurrentSemester}
                  completedCourseKeys={completedCourseKeySet}
                  onShowCourseInfo={setInfoCourseKey}
                  hubSummary={{ fulfilled: hubFulfilled, total: hubTotal }}
                  onOpenHubFullView={openHubFullView}
                  overview={overviewActive}
                  boardView={boardView}
                  onBoardViewChange={isWideLayout ? handleBoardViewChange : undefined}
                />
                <ExtraTermsPanel
                  compact={overviewActive}
                  extraTerms={extraTerms}
                  courseMap={courseMap}
                  creditsMap={creditsMap}
                  onRemoveCourse={handleRemoveExtraTermCourse}
                  onShowCourseInfo={setInfoCourseKey}
                />
                <ExternalCreditsPanel
                  externalCredits={externalCredits}
                  coursesInPlan={coursesInPlan}
                  onRemove={handleRemoveExternalCredit}
                  onUpdate={handleUpdateExternalCredit}
                  onAdd={handleAddExternalCredit}
                />
              </>
            )}
          </main>

          {/* Right: HUB / Requirements / Credits status tabs */}
          <aside className="planner-right">
            <SidePanelTabs
              semesters={semesters}
              extraCourseKeys={extraCourseKeys}
              externalCredits={externalCredits}
              courseMap={courseMap}
              creditsMap={creditsMap}
              lockStatusMap={lockStatusMap}
              noteCredits={planNoteCredits}
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
              onOpenHubFullView={openHubFullView}
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

      {/* ── Full-screen HUB Tracker view (overlay/mode, not a route — see
           hubFullView above) ── */}
      {hubFullView && (
        <HubFullView
          semesters={semesters}
          extraCourseKeys={extraCourseKeys}
          externalCredits={externalCredits}
          courseMap={courseMap}
          isTransfer={isTransfer}
          onToggleTransfer={handleToggleTransfer}
          lockStatusMap={lockStatusMap}
          stash={stash}
          onAddToStash={handleAddToStash}
          onRemoveFromStash={handleRemoveFromStash}
          onClose={closeHubFullView}
        />
      )}

      <ImportTranscriptModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        semesters={semesters}
        extraTerms={extraTerms}
        externalCredits={externalCredits}
        onImport={handleTranscriptImport}
        onImportPlan={handleImportPlan}
        currentUid={user?.uid ?? null}
        planImportBlockedReason={planImportBlockedReason}
        variant={importVariant}
      />

      <HelpSupportModal open={showHelpModal} onClose={() => setShowHelpModal(false)} />

      {/* ── Course info panel — the one instance for search, stash and placed
           cards. Deliberately a direct child of .planner-layout (not inside
           .planner-left/-center/-right, which are display:none on the
           inactive mobile tabs) so it shows on every tab; still inside the
           layout because its drawer position reads --app-header-h from it. ── */}
      <CourseInfoPanel courseKey={infoCourseKey} onClose={closeCourseInfo} />

      {/* ── Mobile tab bar (hidden on wide screens via CSS; stays bottom-most) ── */}
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
                ? 'You have unsaved changes. They\'ll be saved when you leave.'
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
