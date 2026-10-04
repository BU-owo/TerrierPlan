import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react';
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  documentId,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import AppHeader from '../components/AppHeader';
import GuestSignInButton from '../components/GuestSignInButton';
import HelpSupportModal from '../components/HelpSupportModal';
import SchedulerSearch from '../components/scheduler/SchedulerSearch';
import DraftCourseCard from '../components/scheduler/DraftCourseCard';
import GlobalTimeFilter from '../components/scheduler/GlobalTimeFilter';
import ScheduleStepper from '../components/scheduler/ScheduleStepper';
import WeeklyGrid from '../components/scheduler/WeeklyGrid';
import SectionSwapSheet from '../components/scheduler/SectionSwapSheet';
import { nextAutoColors } from '../utils/scheduleColors';
import { readStoredDraft, writeStoredDraft } from '../utils/draftStorage';
import BookmarkedSchedulesPanel from '../components/scheduler/BookmarkedSchedulesPanel';
import SavedSchedulesPanel from '../components/scheduler/SavedSchedulesPanel';
import { CURRENT_TERM, CURRENT_TERM_LABEL, scheduleTerm, termLabel } from '../utils/term';
import { sectionsConflict, describeSectionTime } from '../utils/sectionTime';
import { classifyComponent, groupSectionsByComponent } from '../utils/sectionComponents';
import {
  generateSchedules,
  buildGenerationSlots,
  diagnoseNoSchedule,
  scheduleKey,
  isCourseReady,
  missingGroupsForCourse,
  totalCredits,
} from '../utils/scheduleCombos';
import { EMPTY_GLOBAL_FILTERS, filterBlockDetail } from '../utils/sectionFilters';
import './planner.css';
import './scheduler.css';
import '../App.css';

const SCHEDULES_LOCAL_KEY = 'terrierplan_scheduler_schedules';
const PREVIEW_WIDTH_LOCAL_KEY = 'terrierplan_scheduler_preview_width';
// Per-course color overrides — { [courseKey]: paletteIndex } — a purely
// cosmetic viewing preference, so (like preview width) it's local-only and
// not tied to sign-in state or any one saved schedule: recoloring CS 111
// once means it's that color everywhere you see it in this browser, draft
// or saved. Courses without one get an automatic slot (scheduleColors.js's
// nextAutoColors).
const COURSE_COLORS_LOCAL_KEY = 'terrierplan_scheduler_course_colors';
// The guest "you're not signed in" banner stays dismissed for the rest of the
// browser session (sessionStorage), and comes back on the next visit.
const GUEST_BANNER_DISMISSED_KEY = 'terrierplan_scheduler_guest_banner_dismissed';
// Mirrors scheduler.css's .scheduler-right min-width — the drag can widen
// the preview past its CSS default, never shrink it past this floor.
const PREVIEW_MIN_WIDTH = 460;
// Matching fixed/floor widths for the other two panes (scheduler-left's
// fixed 220px, scheduler-center's min-width 280px) plus the handle itself,
// so a drag can't squeeze search or the draft builder out of existence.
const LEFT_WIDTH = 220;
const CENTER_MIN_WIDTH = 280;
const HANDLE_WIDTH = 7;

// Shared across Strict Mode double-invokes, same trick as PlannerPage's
// guestMigrationPromise — only migrate (and clear localStorage) once per
// guest session -> sign-in.
let guestScheduleMigrationPromise = null;
// Sign-in reaches every open tab, and the guest list now stays in
// localStorage until it's fully written, so a tab claims the migration here
// first; another tab seeing a recent claim skips it. A claim left by a tab
// that closed mid-migration expires, and the next sign-in retries.
const SCHEDULES_MIGRATION_CLAIM_KEY = 'terrierplan_scheduler_schedules_migrating';
const MIGRATION_CLAIM_TTL_MS = 60_000;

async function migrateGuestSchedulesIfNeeded(uid) {
  if (!guestScheduleMigrationPromise) {
    const raw = localStorage.getItem(SCHEDULES_LOCAL_KEY);
    let localSchedules = [];
    try {
      localSchedules = raw ? JSON.parse(raw) : [];
    } catch {
      localSchedules = [];
    }
    const claimedAt = Number(localStorage.getItem(SCHEDULES_MIGRATION_CLAIM_KEY)) || 0;
    if (localSchedules.length === 0 || Date.now() - claimedAt < MIGRATION_CLAIM_TTL_MS) {
      guestScheduleMigrationPromise = Promise.resolve();
    } else {
      localStorage.setItem(SCHEDULES_MIGRATION_CLAIM_KEY, String(Date.now()));
      // The local copy is only shrunk as each schedule is written, so a
      // failure or a closed tab mid-loop leaves exactly the unwritten ones
      // for the next sign-in — never re-adding one that already made it.
      guestScheduleMigrationPromise = (async () => {
        let written = 0;
        try {
          for (const schedule of localSchedules) {
            // eslint-disable-next-line no-await-in-loop
            await addDoc(collection(db, 'users', uid, 'schedules'), {
              name: schedule.name || 'My Schedule',
              term: scheduleTerm(schedule),
              selectedSectionIds: schedule.selectedSectionIds || [],
              favorited: Boolean(schedule.favorited),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            written += 1;
            localStorage.setItem(SCHEDULES_LOCAL_KEY, JSON.stringify(localSchedules.slice(written)));
          }
          localStorage.removeItem(SCHEDULES_LOCAL_KEY);
        } catch (err) {
          console.error('Error migrating guest schedules:', err);
          localStorage.setItem(SCHEDULES_LOCAL_KEY, JSON.stringify(localSchedules.slice(written)));
          guestScheduleMigrationPromise = null; // allow retry on next sign-in attempt
        } finally {
          localStorage.removeItem(SCHEDULES_MIGRATION_CLAIM_KEY);
        }
      })();
    }
  }
  return guestScheduleMigrationPromise;
}

// Pure draftCourses transforms, shared between the draft picker's own lock
// button and the Preview grid's lock/eliminate controls (see
// handlePreviewToggleLock/handlePreviewEliminate) so both go through
// identical logic rather than two hand-maintained copies of it.
function toggleLockInCourses(courses, courseKey, groupKey, sectionId) {
  return courses.map((c) => {
    if (c.courseKey !== courseKey) return c;
    const isLocked = c.locked.includes(sectionId);
    if (isLocked) {
      const current = c.considering[groupKey] || [];
      return {
        ...c,
        locked: c.locked.filter((id) => id !== sectionId),
        considering: {
          ...c.considering,
          [groupKey]: current.includes(sectionId) ? current : [...current, sectionId],
        },
      };
    }
    return {
      ...c,
      locked: [...c.locked, sectionId],
      considering: { ...c.considering, [groupKey]: [] },
    };
  });
}

// Removes a section from consideration entirely — un-checks it and
// releases any lock on it — distinct from a plain uncheck (which only
// applies while it isn't locked); this is the Preview grid's "eliminate"
// control, which can drop a section even if it's currently locked.
function eliminateFromCourses(courses, courseKey, groupKey, sectionId) {
  return courses.map((c) => {
    if (c.courseKey !== courseKey) return c;
    return {
      ...c,
      locked: c.locked.filter((id) => id !== sectionId),
      considering: {
        ...c.considering,
        [groupKey]: (c.considering[groupKey] || []).filter((id) => id !== sectionId),
      },
    };
  });
}

// Pin for a section that was swapped into the preview (it's in neither the
// group's considered nor locked lists — swap placement never touches the
// draft). Replaces the group's old lock instead of adding a second: a lock
// that's no longer on screen can only be one the swap displaced (every
// locked section is forced into every generated schedule, so it would
// otherwise still be showing), so those are dropped; locks still displayed
// — e.g. the other pieces of a multi-lock "Other" group — are kept. Used
// only for swapped-in sections; ordinary pins still go through
// toggleLockInCourses, which adds to the group's locks.
function lockSwappedInSection(courses, courseKey, groupKey, sectionId, displayedIds, sectionsById) {
  return courses.map((c) => {
    if (c.courseKey !== courseKey) return c;
    const keptLocks = c.locked.filter((id) => {
      const s = sectionsById[id];
      return !s || classifyComponent(s) !== groupKey || displayedIds.includes(id);
    });
    return {
      ...c,
      locked: [...keptLocks, sectionId],
      considering: { ...c.considering, [groupKey]: [] },
    };
  });
}

// Section-swap's "unassign this slot" — clears every considered AND
// locked section in one (course, component) group, leaving it required-
// but-unfilled (the same state as a course that's never had anything
// picked for that group — see missingGroupsForCourse/generateBlockers,
// which already renders the "pick a ___" blocker for exactly this case).
// Distinct from eliminateFromCourses, which only drops ONE section from
// ever being reconsidered but leaves the rest of the group's picks alone.
function clearSlotInCourses(courses, courseKey, groupKey, sectionsById) {
  return courses.map((c) => {
    if (c.courseKey !== courseKey) return c;
    return {
      ...c,
      locked: c.locked.filter((id) => classifyComponent(sectionsById[id]) !== groupKey),
      considering: { ...c.considering, [groupKey]: [] },
    };
  });
}

export default function SchedulerPage({ theme = 'light', onToggleTheme }) {
  const { user, loading: authLoading } = useAuth();

  // ── Draft (in-progress, unsaved schedule-building) state ──────────────────
  // [{ courseKey, considering: { [componentKey]: sectionId[] }, locked:
  // sectionId[] }] — componentKey is BU's raw `component` code (LEC/DIS/
  // LAB/..., see sectionComponents.js), so however many distinct
  // components a course has, it gets that many considering pools.
  // Persisted to one localStorage key (utils/draftStorage.js), guest or
  // signed-in alike — a per-browser convenience, separate from *saved*
  // schedules (the only thing SCHEMA.md has a slot for), and restored after
  // a reload by the restore effect below.
  // Order = the order courses were added. `locked` has no size cap — see
  // scheduleCombos.js's buildGenerationSlots.
  const [draftCourses, setDraftCourses] = useState([]);
  // Bumped every time a course is added — DraftCourseCard watches this to
  // auto-collapse itself (unless it's the card that just mounted), so
  // adding another course doesn't leave the student scrolling past every
  // card they already finished setting up. See DraftCourseCard's
  // collapseSignal effect.
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [courseMap, setCourseMap] = useState({}); // courseKey -> course doc
  const [sectionsByCourse, setSectionsByCourse] = useState({}); // courseKey -> sectionDoc[]
  const [loadingSectionsFor, setLoadingSectionsFor] = useState(new Set());
  // 'time' (default, chronological) | 'section' (classSection letter order)
  // — one control for every course card, not per-card, since it's a display
  // preference rather than something that varies course to course.
  const [sectionSortMode, setSectionSortMode] = useState('time');
  // { mode, global, perDay } — applies to every course's section list at
  // once, e.g. "hide everything before 10am" across the whole draft, with
  // an optional per-weekday override (see sectionFilters.js and
  // GlobalTimeFilter.jsx). Time is intentionally global-only — there's no
  // per-course time filter — since a student picks one time preference for
  // their whole schedule, not one per class; a section outside it is
  // dimmed rather than removed (see DraftCourseCard) so overriding for one
  // specific section doesn't need its own control.
  const [globalTimeFilter, setGlobalTimeFilter] = useState(EMPTY_GLOBAL_FILTERS);

  // ── Generated combinations + preview ───────────────────────────────────────
  const [generated, setGenerated] = useState(null); // { schedules: sectionId[][], truncated } | null
  const [previewIndex, setPreviewIndex] = useState(null); // index into generated.schedules, or null
  const [previewSectionIds, setPreviewSectionIds] = useState([]); // what the grid is currently showing

  // Unsaved shortlist while browsing generated combinations — "maybe this
  // one," flippable back to without committing to Save yet. Map of
  // scheduleKey -> sectionIds (not just a Set of keys, and not array
  // indices) so a bookmark: (a) still means the same combination if it
  // reappears at a different position after a regenerate, (b) can still be
  // previewed/promoted to a real save even once the course search has
  // moved on and that combination no longer appears in `generated` at all.
  // Deliberately NOT cleared by "Clear all" / any draft edit — only the
  // panel's own "Clear all" wipes it, so a shortlist survives exploring a
  // completely different set of courses. Persisted with the draft (see
  // draftStorage.js), so it also survives a reload on this browser.
  const [bookmarks, setBookmarks] = useState(() => new Map());

  // ── Saved/favorited schedules ───────────────────────────────────────────────
  const [savedSchedules, setSavedSchedules] = useState([]);
  const [activeSavedId, setActiveSavedId] = useState(null); // which saved schedule (if any) the grid mirrors exactly
  // Last failed save/rename/star/delete, shown in the saved panel until the
  // next such action or a dismiss.
  const [scheduleActionError, setScheduleActionError] = useState(null);
  // Blocks a second bookmark promote while one is still saving.
  const promotingBookmarkRef = useRef(false);

  const [mobileView, setMobileView] = useState('search'); // 'search' | 'build' | 'preview'
  const [showHelpModal, setShowHelpModal] = useState(false);

  // ── Section-swap ("preview all sections for one slot") ─────────────────────
  // { courseKey, component, currentSectionId } | null. Purely a client-side
  // view state, same spirit as previewIndex above but a DIFFERENT kind of
  // "preview" (browsing alternatives for one grid slot, not stepping
  // through whole generated combinations) — named distinctly from
  // previewSlot/previewX so it's never confused with the existing
  // generated-schedule preview machinery already using that word.
  const [sectionSwapSlot, setSectionSwapSlot] = useState(null);
  // Reset to false every time a NEW slot is opened (see
  // handleOpenSectionSwap) — "respect filters by default" per slot.

  // ── Preview panel width (desktop drag-resize) ───────────────────────────────
  // null = use scheduler.css's default (46%, floor 460px); once the student
  // drags the handle this becomes an explicit px value that overrides it.
  const [previewWidth, setPreviewWidth] = useState(() => {
    const raw = Number(localStorage.getItem(PREVIEW_WIDTH_LOCAL_KEY));
    return Number.isFinite(raw) && raw >= PREVIEW_MIN_WIDTH ? raw : null;
  });
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const rightPanelRef = useRef(null);

  function handleResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelRef.current?.getBoundingClientRect().width ?? previewWidth ?? PREVIEW_MIN_WIDTH;
    setIsResizingPreview(true);

    function onMove(ev) {
      // Handle sits to the left of the preview pane, so dragging left
      // (cursor moves toward startX's origin) widens it.
      const maxWidth = Math.max(
        PREVIEW_MIN_WIDTH,
        window.innerWidth - LEFT_WIDTH - CENTER_MIN_WIDTH - HANDLE_WIDTH,
      );
      const next = Math.min(Math.max(startWidth + (startX - ev.clientX), PREVIEW_MIN_WIDTH), maxWidth);
      setPreviewWidth(next);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setIsResizingPreview(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  useEffect(() => {
    if (previewWidth != null) localStorage.setItem(PREVIEW_WIDTH_LOCAL_KEY, String(Math.round(previewWidth)));
  }, [previewWidth]);

  const [guestBannerDismissed, setGuestBannerDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(GUEST_BANNER_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  function dismissGuestBanner() {
    setGuestBannerDismissed(true);
    try {
      sessionStorage.setItem(GUEST_BANNER_DISMISSED_KEY, '1');
    } catch {
      // storage unavailable — it just stays dismissed until the page reloads
    }
  }

  // ── Per-course color overrides ──────────────────────────────────────────────
  const [courseColorOverrides, setCourseColorOverrides] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(COURSE_COLORS_LOCAL_KEY)) || {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(COURSE_COLORS_LOCAL_KEY, JSON.stringify(courseColorOverrides));
  }, [courseColorOverrides]);

  // Automatic slots for the draft's courses (see nextAutoColors): derived
  // during render, so a newly added course never paints one frame in a
  // fallback color. Kept in state — not recomputed from scratch — so a
  // course keeps its slot while it stays in the draft.
  const [autoColors, setAutoColors] = useState({});
  const nextAuto = nextAutoColors(autoColors, draftCourses.map((c) => c.courseKey), courseColorOverrides);
  if (nextAuto !== autoColors) setAutoColors(nextAuto);
  // The resolved slot for each draft course: a manual override wins.
  const courseColors = useMemo(() => {
    const colors = {};
    for (const { courseKey } of draftCourses) colors[courseKey] = courseColorOverrides[courseKey] ?? nextAuto[courseKey];
    return colors;
  }, [draftCourses, courseColorOverrides, nextAuto]);

  // index === null clears the override, returning the course to automatic
  // assignment (see WeeklyGrid's "Reset to auto").
  function handleSetCourseColor(courseKey, index) {
    setCourseColorOverrides((prev) => {
      if (index == null) {
        return Object.fromEntries(Object.entries(prev).filter(([key]) => key !== courseKey));
      }
      return { ...prev, [courseKey]: index };
    });
  }

  const hasLoadedSchedulesRef = useRef(false);

  // ── Load saved schedules on mount / sign-in (migrating any guest ones first) ─
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    async function loadSchedules(uid) {
      const q = query(collection(db, 'users', uid, 'schedules'), orderBy('updatedAt', 'desc'));
      const snap = await getDocs(q);
      if (cancelled) return;
      setSavedSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }

    function loadLocalSchedules() {
      try {
        const raw = localStorage.getItem(SCHEDULES_LOCAL_KEY);
        setSavedSchedules(raw ? JSON.parse(raw) : []);
      } catch (err) {
        console.error('Error loading local schedules:', err);
        setSavedSchedules([]);
      }
    }

    if (user) {
      hasLoadedSchedulesRef.current = false;
      migrateGuestSchedulesIfNeeded(user.uid)
        .then(() => loadSchedules(user.uid))
        .then(() => {
          if (!cancelled) hasLoadedSchedulesRef.current = true;
        })
        .catch((err) => console.error('Error loading schedules:', err));
    } else {
      guestScheduleMigrationPromise = null; // allow a future sign-in to migrate again
      loadLocalSchedules();
      hasLoadedSchedulesRef.current = true;
    }

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // ── Guest: persist saved-schedule changes to localStorage ──────────────────
  useEffect(() => {
    if (user || authLoading || !hasLoadedSchedulesRef.current) return;
    localStorage.setItem(SCHEDULES_LOCAL_KEY, JSON.stringify(savedSchedules));
  }, [savedSchedules, user, authLoading]);

  // ── Course/section data fetching ────────────────────────────────────────────
  const fetchCourseDocs = useCallback(
    async (courseKeys) => {
      const missing = courseKeys.filter((k) => !courseMap[k]);
      if (missing.length === 0) return;
      const newCourses = {};
      for (let i = 0; i < missing.length; i += 30) {
        const batch = missing.slice(i, i + 30);
        // eslint-disable-next-line no-await-in-loop
        const snap = await getDocs(query(collection(db, 'courses'), where(documentId(), 'in', batch)));
        snap.docs.forEach((d) => {
          newCourses[d.id] = d.data();
        });
      }
      setCourseMap((prev) => ({ ...prev, ...newCourses }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseMap],
  );

  async function fetchSectionsForCourse(courseKey) {
    setLoadingSectionsFor((prev) => new Set(prev).add(courseKey));
    try {
      const snap = await getDocs(query(collection(db, 'sections'), where('courseKey', '==', courseKey)));
      const sections = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.term === CURRENT_TERM && s.classStat !== 'Cancelled')
        .sort((a, b) => (a.classSection || '').localeCompare(b.classSection || ''));
      setSectionsByCourse((prev) => ({ ...prev, [courseKey]: sections }));

      // Auto-check any component group that has exactly one option — with
      // nothing to actually decide between, it shouldn't sit there blocking
      // Generate. Only touches a group that's still untouched (no picks, no
      // lock) at the moment this resolves, so it never overrides a
      // student's deliberate uncheck or a saved-schedule restore that
      // already seeded this group (handleLoadSchedule sets `considering`
      // before calling this).
      const singleOptionGroups = groupSectionsByComponent(sections).filter((g) => g.sections.length === 1);
      if (singleOptionGroups.length > 0) {
        setDraftCourses((prev) => prev.map((c) => {
          if (c.courseKey !== courseKey) return c;
          let considering = c.considering;
          let changed = false;
          for (const group of singleOptionGroups) {
            const sectionId = group.sections[0].id;
            const already = considering[group.key] || [];
            if (already.length === 0 && !c.locked.includes(sectionId)) {
              if (!changed) considering = { ...considering };
              considering[group.key] = [sectionId];
              changed = true;
            }
          }
          return changed ? { ...c, considering } : c;
        }));
      }
      return sections;
    } catch (err) {
      console.error('Failed to load sections for', courseKey, err);
      return null;
    } finally {
      setLoadingSectionsFor((prev) => {
        const next = new Set(prev);
        next.delete(courseKey);
        return next;
      });
    }
  }

  // Sections that aren't part of any draft course's list — another term's
  // saved schedule, or a restored bookmark of a course no longer in the
  // draft — kept out of sectionsByCourse on purpose: that map feeds the draft
  // picker and swap, which must only ever see the current term's draft.
  // Added to sectionsById so the preview, credits and the saved/bookmark
  // lists can still describe them.
  const [standaloneSections, setStandaloneSections] = useState({});
  const sectionsById = useMemo(() => {
    const map = { ...standaloneSections };
    Object.values(sectionsByCourse).forEach((list) => {
      list.forEach((section) => {
        map[section.id] = section;
      });
    });
    return map;
  }, [sectionsByCourse, standaloneSections]);

  // Label of the other term the grid is showing, or null for a current-term
  // preview. Derived from the sections themselves (not from which saved row
  // was clicked) so it holds if that schedule is deleted while on screen.
  const previewForeignTermLabel = useMemo(() => {
    const term = previewSectionIds.map((id) => sectionsById[id]?.term).find((t) => t && t !== CURRENT_TERM);
    return term ? termLabel(term) : null;
  }, [previewSectionIds, sectionsById]);

  // Colors for what the grid is showing. Normally the draft's; a schedule
  // from another term isn't in the draft, so its courses get slots assigned
  // from the order they appear in it (same rule as loading a saved schedule).
  const previewCourseColors = useMemo(() => {
    if (!previewForeignTermLabel) return courseColors;
    const keys = [...new Set(previewSectionIds.map((id) => sectionsById[id]?.courseKey).filter(Boolean))];
    const auto = nextAutoColors({}, keys, courseColorOverrides);
    return Object.fromEntries(keys.map((key) => [key, courseColorOverrides[key] ?? auto[key]]));
  }, [previewForeignTermLabel, courseColors, previewSectionIds, sectionsById, courseColorOverrides]);

  const draftCourseKeys = useMemo(() => new Set(draftCourses.map((c) => c.courseKey)), [draftCourses]);

  // Flattened across every course — the Preview grid's lock icon on a
  // block only needs to know "is this specific section locked," not which
  // course/component it belongs to.
  const allLockedSectionIds = useMemo(
    () => new Set(draftCourses.flatMap((c) => c.locked)),
    [draftCourses],
  );

  // Every section sharing sectionSwapSlot's (courseKey, component) — the
  // full candidate pool for the ghost overlay / mobile sheet, not just
  // whichever subset happens to be checked/locked. `sectionsByCourse`
  // already holds every section for a course once it's been fetched (see
  // fetchSectionsForCourse), so this is just a component-key filter, no
  // extra fetch needed.
  const sectionSwapCandidates = useMemo(() => {
    if (!sectionSwapSlot) return [];
    const sections = sectionsByCourse[sectionSwapSlot.courseKey] || [];
    // Everything except cancelled sections — checked or not, eliminated or
    // not, inside the time filter or not (those are only labeled, never
    // hidden; see WeeklyGrid/SectionSwapSheet). The placed section is kept
    // even if cancelled so the sheet can still show it.
    return sections.filter(
      (s) => classifyComponent(s) === sectionSwapSlot.component
        && (s.id === sectionSwapSlot.currentSectionId || s.classStat !== 'Cancelled'),
    );
  }, [sectionSwapSlot, sectionsByCourse]);

  // Which of those candidates are in the draft's pool for this slot (checked
  // or locked). Eliminate just removes a section from the pool — there is no
  // separate "eliminated" state — so "not in this set" covers both unchecked
  // and eliminated.
  const sectionSwapPoolIds = useMemo(() => {
    const ids = new Set();
    if (!sectionSwapSlot) return ids;
    const course = draftCourses.find((c) => c.courseKey === sectionSwapSlot.courseKey);
    if (!course) return ids;
    (course.considering[sectionSwapSlot.component] || []).forEach((id) => ids.add(id));
    course.locked.forEach((id) => {
      if (sectionsById[id] && classifyComponent(sectionsById[id]) === sectionSwapSlot.component) ids.add(id);
    });
    return ids;
  }, [sectionSwapSlot, draftCourses, sectionsById]);

  // Esc exits section-swap without changing the current selection — same
  // "cancel" as the banner/sheet's own Cancel button, just keyboard-
  // reachable. Only listens while a slot is actually open.
  useEffect(() => {
    if (!sectionSwapSlot) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') setSectionSwapSlot(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sectionSwapSlot]);

  // sectionId -> [{ sectionId, label }] — pairwise time conflicts among
  // every currently locked-or-considering section. Two sections are only
  // exempt from being flagged against each other when they're alternatives
  // within the exact same (course, component) pool — a course's own
  // Lecture pick and its own Lab pick are DIFFERENT components, so they're
  // checked against each other too (BU schedules them not to conflict, but
  // this shouldn't just assume that). This is the "before generation"
  // heads-up; actual generation re-derives conflicts itself.
  const conflictMap = useMemo(() => {
    const flat = draftCourses.flatMap((course) => {
      const consideringEntries = Object.entries(course.considering).flatMap(([groupKey, ids]) =>
        ids.map((id) => ({ id, courseKey: course.courseKey, groupKey })),
      );
      const lockedIds = new Set(course.locked);
      const lockedEntries = course.locked.map((id) => ({
        id,
        courseKey: course.courseKey,
        groupKey: classifyComponent(sectionsById[id]),
      }));
      return [...lockedEntries, ...consideringEntries.filter((e) => !lockedIds.has(e.id))];
    });
    const map = {};
    for (let i = 0; i < flat.length; i++) {
      for (let j = i + 1; j < flat.length; j++) {
        const a = flat[i];
        const b = flat[j];
        if (a.courseKey === b.courseKey && a.groupKey === b.groupKey) continue;
        const secA = sectionsById[a.id];
        const secB = sectionsById[b.id];
        if (!secA || !secB || !sectionsConflict(secA, secB)) continue;
        const labelA = `${courseMap[a.courseKey]?.courseNumber ?? a.courseKey} ${secA.classSection} (${describeSectionTime(secA)})`;
        const labelB = `${courseMap[b.courseKey]?.courseNumber ?? b.courseKey} ${secB.classSection} (${describeSectionTime(secB)})`;
        (map[a.id] ??= []).push({ sectionId: b.id, label: labelB });
        (map[b.id] ??= []).push({ sectionId: a.id, label: labelA });
      }
    }
    return map;
  }, [draftCourses, sectionsById, courseMap]);

  // [{ courseKey, label, reason }] — every course still blocking Generate,
  // in draftCourses order. Reused both to disable the Generate button
  // (canGenerate = blockers.length === 0) and to explain exactly what's
  // missing underneath it, instead of the button just going dark with no
  // explanation.
  const generateBlockers = useMemo(() => {
    function articleFor(word) {
      return /^[aeiou]/i.test(word) ? 'an' : 'a';
    }
    return draftCourses.flatMap((course) => {
      const label = courseMap[course.courseKey]?.courseNumber ?? course.courseKey;
      const sections = sectionsByCourse[course.courseKey];
      if (sections === undefined || loadingSectionsFor.has(course.courseKey)) {
        return [{ courseKey: course.courseKey, label, reason: 'sections still loading' }];
      }
      if (sections.length === 0) {
        return [{ courseKey: course.courseKey, label, reason: 'no sections found for this term' }];
      }
      const missing = missingGroupsForCourse(course, sections, sectionsById);
      if (!missing || missing.length === 0) return [];
      const parts = missing.map((g) => {
        const groupLabel = g.label === 'Other' ? 'one of the ungrouped sections' : `${articleFor(g.label)} ${g.label}`;
        // A missing pick can mean "nothing's been checked yet" OR "the
        // global time filter is hiding every option in this group" — those
        // call for different next steps from the student, so say which one
        // it is instead of a blanket "pick a Discussion Section" that'd be
        // misleading if there's nothing visible to pick from at all.
        const detail = filterBlockDetail(g.sections, globalTimeFilter);
        if (detail === 'global') return `${groupLabel} (all hidden by your global time filter)`;
        return groupLabel;
      });
      return [{ courseKey: course.courseKey, label, reason: `pick ${parts.join(' and ')}` }];
    });
  }, [draftCourses, sectionsByCourse, sectionsById, courseMap, loadingSectionsFor, globalTimeFilter]);

  const canGenerate = draftCourses.length > 0 && generateBlockers.length === 0;

  // Only computed once generation has actually come back empty — points at
  // which course(s) to blame instead of leaving the student to guess
  // between a time restriction, a pinned section, and a genuine clash.
  const noScheduleCulprits = useMemo(() => {
    if (!generated || generated.schedules.length > 0) return [];
    return diagnoseNoSchedule(draftCourses, sectionsByCourse, sectionsById);
  }, [generated, draftCourses, sectionsByCourse, sectionsById]);

  // [{ key, sectionIds }], in bookmarking order — the full shortlist,
  // independent of whatever's currently generated. Feeds
  // BookmarkedSchedulesPanel directly.
  const bookmarkList = useMemo(
    () => Array.from(bookmarks.entries()).map(([key, sectionIds]) => ({ key, sectionIds })),
    [bookmarks],
  );

  // Indices (into the CURRENT generated.schedules) where a bookmark
  // happens to overlap this batch — recomputed from the content-keyed map
  // so a bookmark automatically "follows" its schedule if regeneration
  // reorders it, and just as automatically stops applying to the stepper
  // once that exact combination isn't reachable in THIS batch (it's still
  // in the bookmark list either way).
  const bookmarkedIndices = useMemo(() => {
    if (!generated) return [];
    const indices = [];
    generated.schedules.forEach((ids, i) => {
      if (bookmarks.has(scheduleKey(ids))) indices.push(i);
    });
    return indices;
  }, [generated, bookmarks]);

  function handleToggleBookmark(index) {
    if (!generated) return;
    const ids = generated.schedules[index];
    const key = scheduleKey(ids);
    setBookmarks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, ids);
      return next;
    });
  }

  function handleRemoveBookmark(key) {
    setBookmarks((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }

  function handleClearBookmarks() {
    setBookmarks(new Map());
  }

  // Loads a bookmarked combination into the grid directly — it may or may
  // not still be part of the CURRENT `generated` batch, so the stepper
  // only re-syncs to it (previewIndex) when it happens to still be there;
  // otherwise the grid still shows it fine via previewSectionIds alone,
  // the stepper just hides until Prev/Next/Generate moves on.
  function handlePreviewBookmark(sectionIds) {
    setPreviewSectionIds(sectionIds);
    setActiveSavedId(null);
    if (generated) {
      const key = scheduleKey(sectionIds);
      const idx = generated.schedules.findIndex((ids) => scheduleKey(ids) === key);
      setPreviewIndex(idx >= 0 ? idx : null);
    } else {
      setPreviewIndex(null);
    }
  }

  // "Turning a flag into a saved" in one click — reuses the same save path
  // as the form below, just with explicit sectionIds instead of whatever's
  // currently previewed, and an auto-generated name (the student can
  // rename it afterward via the saved row's rename button) since asking
  // for a name here would defeat the "one click" point. Consumes the
  // bookmark on success: once it's a real saved schedule, the bookmark's
  // job — "don't lose this candidate" — is done. A combination that's
  // already saved isn't saved again; its bookmark is just consumed.
  async function handlePromoteBookmark(key, sectionIds) {
    if (promotingBookmarkRef.current) return;
    const comboKey = scheduleKey(sectionIds);
    if (savedSchedules.some((s) => scheduleKey(s.selectedSectionIds || []) === comboKey)) {
      handleRemoveBookmark(key);
      return;
    }
    promotingBookmarkRef.current = true;
    try {
      const saved = await handleSaveSchedule(`Schedule ${savedSchedules.filter((s) => scheduleTerm(s) === CURRENT_TERM).length + 1}`, sectionIds);
      if (saved) handleRemoveBookmark(key);
    } finally {
      promotingBookmarkRef.current = false;
    }
  }

  function invalidateGenerated() {
    setGenerated(null);
    setPreviewIndex(null);
    setPreviewSectionIds([]);
    setActiveSavedId(null);
  }

  // ── Draft handlers ──────────────────────────────────────────────────────────
  function handleAddCourse(courseKey) {
    if (draftCourseKeys.has(courseKey)) return;
    setDraftCourses((prev) => [...prev, { courseKey, considering: {}, locked: [] }]);
    setCollapseSignal((n) => n + 1);
    invalidateGenerated();
    if (!courseMap[courseKey]) fetchCourseDocs([courseKey]);
    if (!sectionsByCourse[courseKey]) fetchSectionsForCourse(courseKey);
  }

  function handleRemoveCourse(courseKey) {
    setDraftCourses((prev) => prev.filter((c) => c.courseKey !== courseKey));
    invalidateGenerated();
  }

  function handleToggleSection(courseKey, groupKey, sectionId) {
    setDraftCourses((prev) =>
      prev.map((c) => {
        if (c.courseKey !== courseKey || c.locked.includes(sectionId)) return c;
        const current = c.considering[groupKey] || [];
        const already = current.includes(sectionId);
        return {
          ...c,
          considering: {
            ...c.considering,
            [groupKey]: already ? current.filter((id) => id !== sectionId) : [...current, sectionId],
          },
        };
      }),
    );
    invalidateGenerated();
  }

  // Locking is a stronger constraint than checking (see scheduleCombos.js's
  // buildGenerationSlots) — and, unlike a plain checkbox, more than one
  // section can be locked for the same course at once, since a course's
  // distinct components (LEC/DIS/LAB/...) each need their own lock
  // independent of the others. Locking one section clears OTHER currently-
  // checked (non-locked) alternatives within that SAME component — they're
  // moot once one from that group is mandatory — but leaves every other
  // component and any other existing locks untouched. Unlocking releases
  // it back into that component's checked pool rather than just dropping
  // it.
  function handleToggleLock(courseKey, groupKey, sectionId) {
    setDraftCourses((prev) => toggleLockInCourses(prev, courseKey, groupKey, sectionId));
    invalidateGenerated();
  }

  // sectionIds is the explicit list to select, not "every section in the
  // group" — DraftCourseCard passes only the currently-visible (post-
  // filter) ones, so "Select all" while a time/professor filter is active
  // selects what's shown, not sections hidden by the filter.
  function handleSelectAllSections(courseKey, groupKey, sectionIds) {
    setDraftCourses((prev) =>
      prev.map((c) =>
        c.courseKey === courseKey
          ? { ...c, considering: { ...c.considering, [groupKey]: sectionIds } }
          : c,
      ),
    );
    invalidateGenerated();
  }

  // Scoped to the checkbox pool only — a lock is released via its own pin
  // button, not swept up by "select/deselect all", so the two controls each
  // stay predictable on their own.
  function handleDeselectAllSections(courseKey, groupKey) {
    setDraftCourses((prev) =>
      prev.map((c) => (c.courseKey === courseKey ? { ...c, considering: { ...c.considering, [groupKey]: [] } } : c)),
    );
    invalidateGenerated();
  }

  function handleClearAll() {
    setDraftCourses([]);
    invalidateGenerated();
  }

  // ── Draft + bookmark persistence (utils/draftStorage.js) ───────────────────
  // Restore: runs once on mount. Everything stored is re-checked against the
  // catalog first — a course that's gone from `courses` is dropped, and so is
  // any section id that's no longer a current-term, non-cancelled section — so
  // a stale draft restores as much as is still valid instead of failing. A
  // bookmark with ANY section gone is dropped whole (a combination missing a
  // piece is no longer that schedule). The preview is then regenerated from
  // the restored draft (see pendingRegen below).
  //
  // Writes are held back until restore finishes, so the empty initial state
  // can never overwrite what's stored. If restore fails (e.g. offline) writes
  // stay off for this page view and the stored draft is left as it was.
  const draftRestoreStartedRef = useRef(false);
  const draftRestoredRef = useRef(false);
  const draftCoursesRef = useRef(draftCourses);
  const [pendingRegen, setPendingRegen] = useState(false);
  // The stored preview to put back once the batch is regenerated, if all its
  // sections still exist: { ids, index } | null.
  const restoredPreviewRef = useRef(null);

  useEffect(() => {
    draftCoursesRef.current = draftCourses;
  }, [draftCourses]);

  useEffect(() => {
    if (draftRestoreStartedRef.current) return;
    draftRestoreStartedRef.current = true;

    async function restore() {
      const stored = readStoredDraft();
      if (!stored) {
        draftRestoredRef.current = true;
        return;
      }
      try {
        const courseKeys = stored.courses.map((c) => c.courseKey);
        const foundCourses = {};
        for (let i = 0; i < courseKeys.length; i += 30) {
          const snap = await getDocs(query(collection(db, 'courses'), where(documentId(), 'in', courseKeys.slice(i, i + 30))));
          snap.docs.forEach((d) => {
            foundCourses[d.id] = d.data();
          });
        }
        const keptKeys = courseKeys.filter((k) => foundCourses[k]);
        const lists = await Promise.all(keptKeys.map((k) => fetchSectionsForCourse(k)));
        if (lists.some((l) => l == null)) throw new Error('could not load sections');
        const validIds = Object.fromEntries(keptKeys.map((k, i) => [k, new Set(lists[i].map((sec) => sec.id))]));
        const courses = stored.courses
          .filter((c) => validIds[c.courseKey])
          .map((c) => ({
            courseKey: c.courseKey,
            considering: Object.fromEntries(
              Object.entries(c.considering).map(([group, ids]) => [group, ids.filter((id) => validIds[c.courseKey].has(id))]),
            ),
            locked: c.locked.filter((id) => validIds[c.courseKey].has(id)),
          }));

        const bookmarkIds = [...new Set([...stored.bookmarks.flat(), ...(stored.preview?.sectionIds || [])])];
        const liveSections = {};
        for (let i = 0; i < bookmarkIds.length; i += 30) {
          const snap = await getDocs(query(collection(db, 'sections'), where(documentId(), 'in', bookmarkIds.slice(i, i + 30))));
          snap.docs.forEach((d) => {
            const sec = { id: d.id, ...d.data() };
            if (sec.term === CURRENT_TERM && sec.classStat !== 'Cancelled') liveSections[d.id] = sec;
          });
        }
        const bookmarkEntries = stored.bookmarks
          .filter((ids) => ids.every((id) => liveSections[id]))
          .map((ids) => [scheduleKey(ids), ids]);

        // The stored preview is shown only if every section in it still exists;
        // otherwise the preview is simply regenerated from the draft.
        const storedPreview = stored.preview;
        const previewIds = storedPreview ? storedPreview.sectionIds : [];
        const previewIsLive = previewIds.length > 0 && previewIds.every((id) => liveSections[id]);

        setCourseMap((prev) => ({ ...foundCourses, ...prev }));
        setStandaloneSections((prev) => ({ ...liveSections, ...prev }));
        fetchCourseDocs([...new Set(Object.values(liveSections).map((sec) => sec.courseKey))]);
        // Whatever the student did while this was loading wins over the stored draft.
        if (draftCoursesRef.current.length === 0 && courses.length > 0) {
          setDraftCourses(courses);
          setGlobalTimeFilter(stored.globalTimeFilter);
          setSectionSortMode(stored.sortMode);
          if (previewIsLive) restoredPreviewRef.current = { ids: previewIds, index: storedPreview.index };
          setPendingRegen(true);
        } else if (previewIsLive && draftCoursesRef.current.length === 0) {
          // No draft to regenerate from (e.g. a previewed bookmark), but the
          // combination itself is still good.
          setPreviewSectionIds(previewIds);
          setPreviewIndex(null);
        }
        setBookmarks((prev) => new Map([...bookmarkEntries, ...prev]));
        draftRestoredRef.current = true;
      } catch (err) {
        console.warn('Could not restore the saved scheduler draft:', err);
      }
    }
    restore();
    // Mount-only: fetchSectionsForCourse etc. are re-created each render but
    // only read state through setters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerate the preview from the restored draft. A separate effect so it
  // runs after the restored state has rendered (regenerateFrom reads the
  // section lists from the current render); skipped if a preview is already up.
  useEffect(() => {
    if (!pendingRegen) return;
    setPendingRegen(false);
    const target = restoredPreviewRef.current;
    restoredPreviewRef.current = null;
    if (previewSectionIds.length > 0) return;
    const result = regenerateFrom(draftCourses);
    if (!target) return;
    // Put the stored combination back over the batch's first one. The stepper
    // position is the stored index when that slot still holds this exact
    // combination, else wherever it now sits in the batch, else none (e.g. a
    // swapped-in section that's not in any generated schedule).
    const key = scheduleKey(target.ids);
    const batch = result?.schedules ?? [];
    const idx = target.index != null && batch[target.index] && scheduleKey(batch[target.index]) === key
      ? target.index
      : batch.findIndex((ids) => scheduleKey(ids) === key);
    setPreviewSectionIds(target.ids);
    setPreviewIndex(idx >= 0 ? idx : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRegen]);

  // Save: ~500ms after the last change, plus immediately when the page is
  // hidden or unloaded (and on leaving the Scheduler), so a refresh right
  // after an edit can't lose it. Not cleared by Save (saving a schedule
  // doesn't touch the draft) or by anything but the student emptying the draft
  // and bookmarks themselves — "Clear all" just saves an empty draft.
  const latestDraftRef = useRef(null);
  const draftDirtyRef = useRef(false);
  const draftTimerRef = useRef(null);

  const flushDraft = useCallback(() => {
    clearTimeout(draftTimerRef.current);
    if (!draftDirtyRef.current || !latestDraftRef.current) return;
    draftDirtyRef.current = false;
    writeStoredDraft(latestDraftRef.current);
  }, []);

  useEffect(() => {
    if (!draftRestoredRef.current) return;
    latestDraftRef.current = { draftCourses, globalTimeFilter, sectionSortMode, bookmarks, previewSectionIds, previewIndex };
    draftDirtyRef.current = true;
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(flushDraft, 500);
  }, [draftCourses, globalTimeFilter, sectionSortMode, bookmarks, previewSectionIds, previewIndex, flushDraft]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flushDraft();
    }
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flushDraft();
    };
  }, [flushDraft]);

  function handleGenerate() {
    const slots = buildGenerationSlots(draftCourses, sectionsByCourse, sectionsById);
    const result = generateSchedules(slots, sectionsById);
    setGenerated(result);
    setActiveSavedId(null);
    if (result.schedules.length > 0) {
      setPreviewIndex(0);
      setPreviewSectionIds(result.schedules[0]);
    } else {
      setPreviewIndex(null);
      setPreviewSectionIds([]);
    }
    setMobileView('preview');
  }

  function handlePreview(index) {
    if (!generated) return;
    setPreviewIndex(index);
    setPreviewSectionIds(generated.schedules[index]);
    setActiveSavedId(null);
  }

  // Re-runs generation from an already-computed draftCourses state (used by
  // the Preview grid's lock/eliminate controls, which need the stepper's
  // combination count to update immediately rather than waiting on a
  // separate "Generate schedules" click). Bails out to the normal "not
  // ready" empty state instead of generating anything if the edit left some
  // course's component group with zero options — eliminating a section can
  // do that, and silently producing a schedule missing that piece would be
  // exactly the incomplete-schedule bug this app exists to avoid.
  function regenerateFrom(nextDraftCourses) {
    const allReady = nextDraftCourses.length > 0 && nextDraftCourses.every((course) =>
      isCourseReady(course, sectionsByCourse[course.courseKey] || [], sectionsById),
    );
    if (!allReady) {
      setGenerated(null);
      setPreviewIndex(null);
      setPreviewSectionIds([]);
      setActiveSavedId(null);
      return null;
    }
    const slots = buildGenerationSlots(nextDraftCourses, sectionsByCourse, sectionsById);
    const result = generateSchedules(slots, sectionsById);
    setGenerated(result);
    setActiveSavedId(null);
    if (result.schedules.length > 0) {
      setPreviewIndex(0);
      setPreviewSectionIds(result.schedules[0]);
    } else {
      setPreviewIndex(null);
      setPreviewSectionIds([]);
    }
    return result;
  }

  // Lock/eliminate controls on the Preview grid's blocks themselves — same
  // underlying state changes as the draft picker's controls, just triggered
  // from the other side of the screen and immediately followed by a
  // regenerate so the stepper reflects the new combination count right
  // away instead of showing a stale count until the next manual Generate.
  function handlePreviewToggleLock(sectionId) {
    const section = sectionsById[sectionId];
    if (!section) return;
    const groupKey = classifyComponent(section);
    const course = draftCourses.find((c) => c.courseKey === section.courseKey);
    const isSwappedIn = Boolean(course)
      && !course.locked.includes(sectionId)
      && !(course.considering[groupKey] || []).includes(sectionId);
    const next = isSwappedIn
      ? lockSwappedInSection(draftCourses, section.courseKey, groupKey, sectionId, previewSectionIds, sectionsById)
      : toggleLockInCourses(draftCourses, section.courseKey, groupKey, sectionId);
    setDraftCourses(next);
    regenerateFrom(next);
  }

  function handlePreviewEliminate(sectionId) {
    const section = sectionsById[sectionId];
    if (!section) return;
    const groupKey = classifyComponent(section);
    const next = eliminateFromCourses(draftCourses, section.courseKey, groupKey, sectionId);
    setDraftCourses(next);
    regenerateFrom(next);
  }

  // ── Section-swap handlers ───────────────────────────────────────────────────
  function handleOpenSectionSwap(courseKey, component, currentSectionId) {
    setSectionSwapSlot({ courseKey, component, currentSectionId });
  }

  function handleCloseSectionSwap() {
    setSectionSwapSlot(null);
  }

  // Places a ghost into the combination on screen — and ONLY there. The
  // draft (checked/locked sections) is untouched and nothing is regenerated,
  // so a section that's unchecked, eliminated or outside the time filter can
  // be previewed without being added to the pool. The preview no longer
  // matches any generated schedule or saved one, so the stepper position and
  // the active-saved highlight are dropped; the next Generate / Prev / Next /
  // lock / eliminate re-derives the preview from the draft and the placement
  // is gone (Save keeps it, since it saves what's on screen).
  function handleSelectSwapSection(sectionId) {
    if (!sectionSwapSlot) return;
    setSectionSwapSlot(null);
    if (previewSectionIds.includes(sectionId)) return;
    const inSlot = (id) => {
      const s = sectionsById[id];
      return s && s.courseKey === sectionSwapSlot.courseKey && classifyComponent(s) === sectionSwapSlot.component;
    };
    // The section the slot was opened on; if the preview has since changed
    // under it, fall back to whichever section now fills the slot.
    const replaceId = previewSectionIds.includes(sectionSwapSlot.currentSectionId)
      ? sectionSwapSlot.currentSectionId
      : previewSectionIds.find(inSlot);
    if (!replaceId) return;
    setPreviewSectionIds(previewSectionIds.map((id) => (id === replaceId ? sectionId : id)));
    setPreviewIndex(null);
    setActiveSavedId(null);
  }

  function handleClearSwapSlot() {
    if (!sectionSwapSlot) return;
    const next = clearSlotInCourses(draftCourses, sectionSwapSlot.courseKey, sectionSwapSlot.component, sectionsById);
    setDraftCourses(next);
    regenerateFrom(next);
    setSectionSwapSlot(null);
  }

  // ── Saved schedule handlers ──────────────────────────────────────────────────
  // sectionIds defaults to whatever's previewed (the normal Save-form path)
  // but can be passed explicitly — handlePromoteBookmark uses this to save
  // a bookmarked combination directly without first loading it into preview.
  // Only marks the new save "active" (highlighted, in the right-panel
  // title) when it's the thing actually on screen right now — promoting a
  // DIFFERENT bookmark than whatever's currently previewed shouldn't hijack
  // the header to name something the grid isn't showing.
  //
  // Resolves to true once the schedule is saved, false if it wasn't (the
  // error is shown in the saved panel). The term comes from the section ids
  // themselves, so a previewed other-term schedule keeps its own term.
  async function handleSaveSchedule(name, sectionIds = previewSectionIds) {
    if (sectionIds.length === 0) return false;
    const isPreviewed = scheduleKey(sectionIds) === scheduleKey(previewSectionIds);
    const term = scheduleTerm({ selectedSectionIds: sectionIds });
    setScheduleActionError(null);
    if (user) {
      let ref;
      try {
        ref = await addDoc(collection(db, 'users', user.uid, 'schedules'), {
          name,
          term,
          selectedSectionIds: sectionIds,
          favorited: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('Error saving schedule:', err);
        setScheduleActionError("Couldn't save this schedule. Check your connection and try again.");
        return false;
      }
      try {
        const q = query(collection(db, 'users', user.uid, 'schedules'), orderBy('updatedAt', 'desc'));
        const snap = await getDocs(q);
        setSavedSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        // The doc was written — list it anyway so it isn't missing (and
        // can't be saved a second time) until the next reload.
        console.error('Saved schedule, but could not refresh the list:', err);
        setSavedSchedules((prev) => [{ id: ref.id, name, term, selectedSectionIds: sectionIds, favorited: false }, ...prev]);
      }
      if (isPreviewed) setActiveSavedId(ref.id);
    } else {
      const schedule = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        term,
        selectedSectionIds: sectionIds,
        favorited: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setSavedSchedules((prev) => [schedule, ...prev]);
      if (isPreviewed) setActiveSavedId(schedule.id);
    }
    return true;
  }

  async function handleRenameSchedule(schedule, name) {
    setScheduleActionError(null);
    if (user) {
      try {
        await updateDoc(doc(db, 'users', user.uid, 'schedules', schedule.id), {
          name,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('Error renaming schedule:', err);
        setScheduleActionError(`Couldn't rename "${schedule.name}". Check your connection and try again.`);
        return;
      }
    }
    setSavedSchedules((prev) => prev.map((s) => (s.id === schedule.id ? { ...s, name } : s)));
  }

  async function handleToggleFavorite(schedule) {
    const favorited = !schedule.favorited;
    setScheduleActionError(null);
    if (user) {
      try {
        await updateDoc(doc(db, 'users', user.uid, 'schedules', schedule.id), {
          favorited,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('Error updating favorite:', err);
        setScheduleActionError(`Couldn't ${favorited ? 'favorite' : 'unfavorite'} "${schedule.name}". Check your connection and try again.`);
        return;
      }
    }
    setSavedSchedules((prev) => prev.map((s) => (s.id === schedule.id ? { ...s, favorited } : s)));
  }

  async function handleDeleteSchedule(schedule) {
    setScheduleActionError(null);
    if (user) {
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'schedules', schedule.id));
      } catch (err) {
        console.error('Error deleting schedule:', err);
        setScheduleActionError(`Couldn't delete "${schedule.name}". Check your connection and try again.`);
        return;
      }
    }
    setSavedSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
    if (activeSavedId === schedule.id) setActiveSavedId(null);
  }

  // Restores a saved schedule into the grid AND back into the editable
  // draft (grouped by course and component, each seeded with the section(s)
  // that were actually committed — a course with a lecture, discussion,
  // and lab restores all three) — not just the raw ID list, so the student
  // can keep tweaking from where they left off. Nothing is restored as
  // locked (SCHEMA.md's saved schedule doc has no slot for lock state), so
  // the student may want to re-pin anything they'd locked before saving.
  async function handleLoadSchedule(schedule) {
    const ids = schedule.selectedSectionIds || [];
    if (ids.length === 0) return;

    // A schedule from another term is shown, not edited: its sections are
    // fetched by id and previewed on their own. The draft, the generated
    // batch and every course's section list stay exactly as they were, so
    // none of this term's alternatives can mix in.
    if (scheduleTerm(schedule) !== CURRENT_TERM) {
      const missingForeign = ids.filter((id) => !sectionsById[id]);
      const fetched = {};
      for (let i = 0; i < missingForeign.length; i += 30) {
        const batch = missingForeign.slice(i, i + 30);
        const snap = await getDocs(query(collection(db, 'sections'), where(documentId(), 'in', batch)));
        snap.docs.forEach((d) => {
          fetched[d.id] = { id: d.id, ...d.data() };
        });
      }
      setStandaloneSections((prev) => ({ ...prev, ...fetched }));
      const shown = ids.filter((id) => sectionsById[id] || fetched[id]);
      fetchCourseDocs([...new Set(shown.map((id) => (sectionsById[id] || fetched[id]).courseKey))]);
      setSectionSwapSlot(null);
      setPreviewIndex(null);
      setPreviewSectionIds(ids);
      setActiveSavedId(schedule.id);
      setMobileView('preview');
      return;
    }

    // Loading replaces the whole draft (picks and pins), so ask first unless
    // the draft is empty or is exactly a saved schedule with nothing pinned —
    // then nothing would be lost.
    if (draftCourses.length > 0) {
      const hasLocks = draftCourses.some((c) => c.locked.length > 0);
      const draftKey = scheduleKey(draftCourses.flatMap((c) => Object.values(c.considering).flat()));
      const draftIsSaved = !hasLocks
        && savedSchedules.some((s) => scheduleKey(s.selectedSectionIds || []) === draftKey);
      if (!draftIsSaved && !window.confirm(`Load "${schedule.name}"? This replaces your current draft, including any pinned sections.`)) {
        return;
      }
    }

    const missing = ids.filter((id) => !sectionsById[id]);
    const fetchedById = {};
    for (let i = 0; i < missing.length; i += 30) {
      const batch = missing.slice(i, i + 30);
      // eslint-disable-next-line no-await-in-loop
      const snap = await getDocs(query(collection(db, 'sections'), where(documentId(), 'in', batch)));
      snap.docs.forEach((d) => {
        fetchedById[d.id] = { id: d.id, ...d.data() };
      });
    }
    const allById = { ...sectionsById, ...fetchedById };

    const byCourse = {};
    for (const id of ids) {
      const section = allById[id];
      if (!section) continue;
      (byCourse[section.courseKey] ??= []).push(section);
    }

    setSectionsByCourse((prev) => {
      const next = { ...prev };
      for (const [courseKey, secs] of Object.entries(byCourse)) {
        const existingIds = new Set((next[courseKey] || []).map((s) => s.id));
        next[courseKey] = [...(next[courseKey] || []), ...secs.filter((s) => !existingIds.has(s.id))];
      }
      return next;
    });

    // Colors aren't saved with a schedule: assign them afresh from the order
    // the courses appear in it, so the same schedule always loads the same.
    setAutoColors(nextAutoColors({}, Object.keys(byCourse), courseColorOverrides));

    setDraftCourses(
      Object.entries(byCourse).map(([courseKey, secs]) => {
        const considering = {};
        secs.forEach((s) => {
          const key = classifyComponent(s);
          (considering[key] ??= []).push(s.id);
        });
        return { courseKey, considering, locked: [] };
      }),
    );

    fetchCourseDocs(Object.keys(byCourse));
    // Progressively fetch each course's full section list so the picker
    // shows every alternative, not just the one this saved schedule
    // committed to.
    Object.keys(byCourse).forEach((courseKey) => fetchSectionsForCourse(courseKey));

    setGenerated(null);
    setPreviewIndex(null);
    setPreviewSectionIds(ids);
    setActiveSavedId(schedule.id);
    setMobileView('preview');
  }

  const previewCreditsLabel = previewSectionIds.length > 0 ? `${totalCredits(previewSectionIds, sectionsById)} cr` : '';

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
    <div className="planner-layout">
      <AppHeader
        active="scheduler"
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpenHelp={() => setShowHelpModal(true)}
      />

      <div className="scheduler-body" data-mobile-view={mobileView}>
        <aside className="scheduler-left">
          <SchedulerSearch draftCourseKeys={draftCourseKeys} onAddCourse={handleAddCourse} />
        </aside>

        <main className="scheduler-center">
          {!user && !guestBannerDismissed && (
            <div className="sched-guest-banner" role="note">
              <span className="sched-guest-banner-text guest-notice-text">
                <strong>Browsing as guest.</strong> Your saved schedules live only in this browser and are lost if
                its data is cleared. Sign in to keep them.
              </span>
              <GuestSignInButton className="guest-signin-btn" />
              <button
                type="button"
                className="sched-guest-banner-dismiss"
                onClick={dismissGuestBanner}
                aria-label="Dismiss for this session"
                title="Dismiss for this session"
              >
                ×
              </button>
            </div>
          )}
          <div className="sched-draft-toolbar">
            <h2>Your Schedule Draft — {CURRENT_TERM_LABEL}</h2>
            <div className="sched-draft-toolbar-actions">
              <div className="hub-year-toggle-group sched-sort-toggle">
                <button
                  type="button"
                  className={`hub-year-toggle-btn${sectionSortMode === 'time' ? ' active' : ''}`}
                  onClick={() => setSectionSortMode('time')}
                >
                  Time
                </button>
                <button
                  type="button"
                  className={`hub-year-toggle-btn${sectionSortMode === 'section' ? ' active' : ''}`}
                  onClick={() => setSectionSortMode('section')}
                >
                  Section
                </button>
              </div>
              <button
                type="button"
                className="sched-clear-all-btn"
                onClick={handleClearAll}
                disabled={draftCourses.length === 0}
              >
                Clear all
              </button>
            </div>
          </div>

          {draftCourses.length === 0 && (
            <div className="search-empty sched-draft-empty">
              Search for a course on the left to start building your {CURRENT_TERM_LABEL} schedule.
            </div>
          )}

          {draftCourses.length > 0 && (
            <GlobalTimeFilter
              value={globalTimeFilter}
              onChange={setGlobalTimeFilter}
              onClear={() => setGlobalTimeFilter(EMPTY_GLOBAL_FILTERS)}
            />
          )}

          {draftCourses.map(({ courseKey, considering, locked }) => (
            <DraftCourseCard
              key={courseKey}
              courseKey={courseKey}
              courseData={courseMap[courseKey]}
              sections={sectionsByCourse[courseKey] || []}
              loading={loadingSectionsFor.has(courseKey)}
              considering={considering}
              lockedIds={new Set(locked)}
              conflictMap={conflictMap}
              sortMode={sectionSortMode}
              globalTimeFilter={globalTimeFilter}
              collapseSignal={collapseSignal}
              onToggleSection={(groupKey, sectionId) => handleToggleSection(courseKey, groupKey, sectionId)}
              onToggleLock={(groupKey, sectionId) => handleToggleLock(courseKey, groupKey, sectionId)}
              onSelectAll={(groupKey, sectionIds) => handleSelectAllSections(courseKey, groupKey, sectionIds)}
              onDeselectAll={(groupKey) => handleDeselectAllSections(courseKey, groupKey)}
              onRemoveCourse={() => handleRemoveCourse(courseKey)}
            />
          ))}

          {draftCourses.length > 0 && (
            <div className="sched-generate-row">
              <button type="button" className="sched-generate-btn" onClick={handleGenerate} disabled={!canGenerate}>
                Generate schedules
              </button>
              {generateBlockers.length > 0 && (
                <ul className="sched-generate-blockers">
                  {generateBlockers.map((b) => (
                    <li key={b.courseKey}>
                      <strong>{b.label}</strong>: {b.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </main>

        <div
          className={`sched-resize-handle${isResizingPreview ? ' is-dragging' : ''}`}
          onMouseDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview panel"
        />

        <aside
          className="scheduler-right"
          ref={rightPanelRef}
          style={previewWidth != null ? { width: `${previewWidth}px` } : undefined}
        >
          <div className="sched-right-header">
            <h2>{activeSavedId && savedSchedules.find((s) => s.id === activeSavedId)?.name || 'Preview'}</h2>
            {previewCreditsLabel && <span className="sched-right-credits">{previewCreditsLabel}</span>}
          </div>

          {generated && generated.schedules.length === 0 ? (
            <div className="sched-generated-empty">
              <p>
                No conflict-free combination exists for the sections currently in consideration — try
                checking an additional section for one of your courses.
              </p>
              {draftCourses.length === 1 && noScheduleCulprits.length === 1 && (
                <p className="sched-generated-empty-culprit">
                  The problem is within{' '}
                  <strong>{courseMap[noScheduleCulprits[0]]?.courseNumber ?? noScheduleCulprits[0]}</strong> itself —
                  none of its checked/pinned sections across components (Lecture, Discussion, Lab, …) leave a
                  conflict-free pairing. Try considering a different section for one of its parts.
                </p>
              )}
              {draftCourses.length > 1 && noScheduleCulprits.length > 0 && (
                <p className="sched-generated-empty-culprit">
                  Likely culprit{noScheduleCulprits.length > 1 ? 's' : ''}:{' '}
                  {noScheduleCulprits.map((key, idx) => (
                    <Fragment key={key}>
                      {idx > 0 && (idx === noScheduleCulprits.length - 1 ? ' or ' : ', ')}
                      <strong>{courseMap[key]?.courseNumber ?? key}</strong>
                    </Fragment>
                  ))}
                  . Removing {noScheduleCulprits.length === 1 ? 'it' : noScheduleCulprits.length === 2 ? 'either one' : 'any one'}{' '}
                  — or considering more sections for {noScheduleCulprits.length === 1 ? 'it' : 'one of them'} — would
                  unblock a schedule. If it's pinned, check whether that's the section forcing the clash.
                </p>
              )}
              {draftCourses.length > 1 && noScheduleCulprits.length === 0 && (
                <p className="sched-generated-empty-culprit">
                  No single course explains it — at least two of your courses are each unsatisfiable on their own
                  (or the clash only shows up across three or more together). Try temporarily removing courses one
                  at a time to isolate it.
                </p>
              )}
            </div>
          ) : (
            <div className="sched-preview-scroll">
              <ScheduleStepper
                generated={generated}
                previewIndex={previewIndex}
                onJump={handlePreview}
                bookmarkedIndices={bookmarkedIndices}
                onToggleBookmark={handleToggleBookmark}
              />
              <WeeklyGrid
                sectionIds={previewSectionIds}
                sectionsById={sectionsById}
                courseMap={courseMap}
                lockedSectionIds={allLockedSectionIds}
                onToggleLock={handlePreviewToggleLock}
                onEliminate={handlePreviewEliminate}
                courseColors={previewCourseColors}
                frozenTermLabel={previewForeignTermLabel}
                onSetColor={handleSetCourseColor}
                swapSlot={sectionSwapSlot}
                swapCandidates={sectionSwapCandidates}
                swapPoolIds={sectionSwapPoolIds}
                globalTimeFilter={globalTimeFilter}
                onOpenSwap={handleOpenSectionSwap}
                onSelectSwapSection={handleSelectSwapSection}
                onCloseSwap={handleCloseSectionSwap}
                onClearSwapSlot={handleClearSwapSlot}
              />
            </div>
          )}

          <BookmarkedSchedulesPanel
            bookmarks={bookmarkList}
            sectionsById={sectionsById}
            courseMap={courseMap}
            activeKey={previewSectionIds.length > 0 ? scheduleKey(previewSectionIds) : null}
            onPreview={handlePreviewBookmark}
            onPromote={handlePromoteBookmark}
            onRemove={handleRemoveBookmark}
            onClearAll={handleClearBookmarks}
          />

          <SavedSchedulesPanel
            previewSectionIds={previewSectionIds}
            creditsLabel={previewCreditsLabel}
            savedSchedules={savedSchedules}
            activeSavedId={activeSavedId}
            sectionsById={sectionsById}
            courseMap={courseMap}
            onSave={handleSaveSchedule}
            onRename={handleRenameSchedule}
            onToggleFavorite={handleToggleFavorite}
            onDelete={handleDeleteSchedule}
            onLoad={handleLoadSchedule}
            actionError={scheduleActionError}
            onDismissError={() => setScheduleActionError(null)}
            isGuest={!user}
          />
        </aside>
      </div>

      <nav className="mobile-tab-bar" aria-label="Scheduler sections">
        <button
          className={`mobile-tab-btn${mobileView === 'search' ? ' active' : ''}`}
          onClick={() => setMobileView('search')}
        >
          Search
        </button>
        <button
          className={`mobile-tab-btn${mobileView === 'build' ? ' active' : ''}`}
          onClick={() => setMobileView('build')}
        >
          Build
        </button>
        <button
          className={`mobile-tab-btn${mobileView === 'preview' ? ' active' : ''}`}
          onClick={() => setMobileView('preview')}
        >
          Preview
        </button>
      </nav>

      <HelpSupportModal open={showHelpModal} onClose={() => setShowHelpModal(false)} />

      {/* Rendered outside .scheduler-right/aside deliberately — that
          element is display:none on mobile whenever a different bottom
          tab is active (see scheduler.css), which would otherwise yank
          this fixed-position sheet off-screen the instant the student
          tapped away, even though it's meant to behave like an
          independent modal. */}
      {sectionSwapSlot && (
        <SectionSwapSheet
          slot={sectionSwapSlot}
          candidates={sectionSwapCandidates}
          sectionsById={sectionsById}
          courseMap={courseMap}
          committedSectionIds={previewSectionIds}
          lockedSectionIds={allLockedSectionIds}
          courseColors={courseColors}
          poolSectionIds={sectionSwapPoolIds}
          globalTimeFilter={globalTimeFilter}
          onSelect={handleSelectSwapSection}
          onToggleLock={handlePreviewToggleLock}
          onClearSlot={handleClearSwapSlot}
          onClose={handleCloseSectionSwap}
        />
      )}
    </div>
  );
}
