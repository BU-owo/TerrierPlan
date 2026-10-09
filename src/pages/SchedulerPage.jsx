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
import ScheduleStepper, { ManualScheduleHeader } from '../components/scheduler/ScheduleStepper';
import WeeklyGrid from '../components/scheduler/WeeklyGrid';
import SectionSwapSheet from '../components/scheduler/SectionSwapSheet';
import { nextAutoColors } from '../utils/scheduleColors';
import { readStoredDraft, writeStoredDraft, clearStoredDraft } from '../utils/draftStorage';
import { loadAllCourses } from '../utils/courseQuery';
import BookmarkedSchedulesPanel from '../components/scheduler/BookmarkedSchedulesPanel';
import SavedSchedulesPanel from '../components/scheduler/SavedSchedulesPanel';
import IncompleteBanner from '../components/scheduler/IncompleteBanner';
import { CURRENT_TERM, CURRENT_TERM_LABEL, scheduleTerm, termLabel } from '../utils/term';
import { sectionsConflict, describeSectionTime } from '../utils/sectionTime';
import { withMockMeetings } from '../utils/mockMeetings';
import { describeSectionName } from '../utils/sectionType';
import { classifyComponent, groupSectionsByComponent } from '../utils/sectionComponents';
import {
  generateSchedulesAsync,
  buildGenerationSlots,
  scheduleKey,
  missingGroupsForCourse,
  totalCredits,
} from '../utils/scheduleCombos';
import { EMPTY_GLOBAL_FILTERS, filterBlockDetail, matchesFilters, isGlobalFilterActive } from '../utils/sectionFilters';
import { combinationProduct, SLOW_GENERATION_PRODUCT } from '../utils/selectionEstimate';
import { applyFilterToPicks } from '../utils/filterAutoUncheck';
import LargeSelectionBanner from '../components/scheduler/LargeSelectionBanner';
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
const EMPTY_OBJ = {};
// Shared empty Set for props, so a card's prop doesn't change every render.
const EMPTY_SET = new Set();
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

// Course docs ({ [courseKey]: course }) for the scheduler's labels, from the
// static catalog (courseQuery.js's loadAllCourses — the same cached copy
// SchedulerSearch loads) instead of the `courses` collection. The scheduler
// only reads courseNumber and name, which every catalog entry has. A key the
// catalog lacks (e.g. it lags a newly imported course) is read from Firestore
// instead, so a stale catalog never drops a restored draft course.
let catalogById = null;
let catalogByIdSource = null;

async function lookupCourses(courseKeys) {
  const found = {};
  if (courseKeys.length === 0) return found;
  try {
    const catalog = await loadAllCourses();
    if (catalogByIdSource !== catalog) {
      catalogById = new Map(catalog.map((c) => [c.id, c]));
      catalogByIdSource = catalog;
    }
    courseKeys.forEach((key) => {
      if (catalogById.has(key)) found[key] = catalogById.get(key);
    });
  } catch (err) {
    console.warn('Course catalog unavailable, reading courses from Firestore:', err);
  }
  const missing = courseKeys.filter((key) => !found[key]);
  for (let i = 0; i < missing.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'courses'), where(documentId(), 'in', missing.slice(i, i + 30))));
    snap.docs.forEach((d) => {
      found[d.id] = d.data();
    });
  }
  return found;
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

// Auto-check any component group that has exactly one option — with nothing
// to actually decide between, it shouldn't sit there blocking Generate. Only
// touches a group that's still untouched (no picks, no lock), so it never
// overrides a student's deliberate uncheck or a saved-schedule restore that
// already seeded the group. Shared by a fresh section fetch and by re-adding
// a course whose sections are already cached.
function autoCheckSingleOptionGroups(courses, courseKey, sections) {
  const singleOptionGroups = groupSectionsByComponent(sections).filter((g) => g.sections.length === 1);
  if (singleOptionGroups.length === 0) return courses;
  return courses.map((c) => {
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
  // 'auto' | 'manual'. Auto: conflict-free schedules are generated from the
  // checked/pinned sections automatically (never with overlaps). Manual: the
  // student places one section per component per course by hand, overlaps
  // allowed, kept in manualSectionIds — separate from Auto's checkboxes, so
  // switching modes loses nothing. Both are saved with the draft.
  const [scheduleMode, setScheduleMode] = useState('auto');
  const [manualSectionIds, setManualSectionIds] = useState([]);
  // "Show all" ghosts: Set of `${courseKey}|${groupKey}` whose every section
  // is drawn as a ghost on the grid. View-only state; cleared on mode change.
  const [ghostGroups, setGhostGroups] = useState(() => new Set());
  // Something the student is looking at on purpose that automatic
  // regeneration must not replace: 'saved' (a loaded saved schedule),
  // 'bookmark' (a previewed bookmark not in the current batch), 'foreign'
  // (another term's schedule) or 'swap' (a swap placement). null = the grid
  // follows the generated batch. See the auto-regenerate effect.
  const [previewHold, setPreviewHold] = useState(null);
  const [generating, setGenerating] = useState(false);

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
  // Manual: set when a swap was started from an overlap ("Find another time"), so
  // the grid can say what's being resolved. { text } | null; cleared with the slot.
  const [swapOrigin, setSwapOrigin] = useState(null);
  useEffect(() => {
    if (!sectionSwapSlot) setSwapOrigin(null);
  }, [sectionSwapSlot]);
  // Manual "N overlaps" stepper: the pair last shown, and the pair to pulse.
  const [overlapCursor, setOverlapCursor] = useState(-1);
  const [overlapPulse, setOverlapPulse] = useState(null);
  // Displace flow: clicking a ghost that clashes with placed sections swaps it
  // in and removes those ("displaced") sections, then walks through them one
  // at a time so each can get a replacement (or be left out). null when not in
  // that flow. { snapshot: the preview as it was before the first click (what
  // Cancel restores), queue: displaced sections still to resolve (queue[0] is
  // the one on screen; each item remembers the swap that displaced it —
  // causedBy — and the whole set that swap displaced — groupIds — so the banner
  // can say "Replacing 1 of 2" about THAT swap), key: scheduleKey of the
  // preview it expects }.
  const [displaceFlow, setDisplaceFlow] = useState(null);
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
      const newCourses = await lookupCourses(missing);
      setCourseMap((prev) => ({ ...prev, ...newCourses }));
    },
    [courseMap],
  );

  async function fetchSectionsForCourse(courseKey) {
    setLoadingSectionsFor((prev) => new Set(prev).add(courseKey));
    try {
      // Current term only — sectionsByCourse never holds another term's
      // sections (those come in by id; see standaloneSections).
      const snap = await getDocs(query(
        collection(db, 'sections'),
        where('courseKey', '==', courseKey),
        where('term', '==', CURRENT_TERM),
      ));
      const sections = snap.docs
        .map((d) => withMockMeetings({ id: d.id, ...d.data() }))
        .filter((s) => s.term === CURRENT_TERM && s.classStat !== 'Cancelled')
        .sort((a, b) => (a.classSection || '').localeCompare(b.classSection || ''));
      setSectionsByCourse((prev) => ({ ...prev, [courseKey]: sections }));

      // Auto-check single-option groups (see autoCheckSingleOptionGroups).
      // Applied at the moment this resolves, so a saved-schedule restore
      // that already seeded a group (handleLoadSchedule sets `considering`
      // before calling this) is left alone.
      setDraftCourses((prev) => autoCheckSingleOptionGroups(prev, courseKey, sections));
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

  // What the displace banner / sheet needs: "2 of 3", the slot's name, and
  // whether the displaced section has no replacement that fits.
  const componentLabelFor = (courseKey, component) => (
    (sectionsByCourse[courseKey] || []).find((s) => classifyComponent(s) === component)?.componentLabel || component
  );
  // "Laboratory" -> "Lab", "Discussion Section" -> "Discussion" in the swap copy.
  const shortComponent = (label) => String(label).replace('Laboratory', 'Lab').replace('Discussion Section', 'Discussion');
  const slotName = (courseKey, component) => (
    `${courseMap[courseKey]?.courseNumber ?? courseKey} ${shortComponent(componentLabelFor(courseKey, component))}`
  );
  // "CAS CS 111 Lab B4": course, component and section code.
  const sectionName = (section) => (
    `${slotName(section.courseKey, classifyComponent(section))} ${section.classSection}`
  );
  const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');
  // What the displace banner / sheet say (two lines, shared word for word by
  // both), plus what the grid needs to outline the removed spots.
  const displaceInfo = (() => {
    if (!displaceFlow || !sectionSwapSlot) return null;
    const head = displaceFlow.queue[0];
    const placed = previewSectionIds.map((id) => sectionsById[id]).filter(Boolean);
    const alternatives = sectionSwapCandidates.filter((s) => s.id !== sectionSwapSlot.currentSectionId);
    const fits = alternatives.filter((s) => !placed.some((o) => sectionsConflict(o, s)));
    const label = slotName(sectionSwapSlot.courseKey, sectionSwapSlot.component);
    const removedNames = head.groupIds.map((id) => sectionsById[id]).filter(Boolean).map(sectionName);
    const swappedIn = previewSectionIds.includes(head.causedBy) ? sectionsById[head.causedBy] : null;
    const line1 = swappedIn
      ? `Swapped in ${sectionName(swappedIn)}. Removed ${joinNames(removedNames)} because they overlap.`
      : `Removed ${joinNames(removedNames)} because they overlapped a class you swapped in.`;
    const noOptions = fits.length === 0;
    const onlyOption = alternatives.length === 0;
    // Step two, in the words the grid ("dashed options") and the mobile sheet
    // ("options") each need.
    const step2 = (where) => {
      if (noOptions) {
        return onlyOption
          ? `No other options for ${label}. It will be left out of this schedule.`
          : `Every other ${label} option overlaps another class. It will be left out of this schedule unless you pick one.`;
      }
      const pick = `now pick a new ${label} from the ${where} below.`;
      return head.groupSize > 1
        ? `Replacing removed class ${head.groupIndex} of ${head.groupSize}: ${pick}`
        : `${pick[0].toUpperCase()}${pick.slice(1)}`;
    };
    return {
      lines: [line1, step2('dashed options')],
      sheetLines: [line1, step2('options')],
      noOptions,
      swappedInId: swappedIn ? swappedIn.id : null,
      removedSections: displaceFlow.queue.map((q) => sectionsById[q.sectionId]).filter(Boolean),
    };
  })();
  // Components a drafted course has no section for in the preview — what's left
  // after "It will be left out". Derived from the preview itself (a generated
  // schedule always has every component), so it also holds after a reload or
  // when a saved incomplete schedule is loaded. Hidden mid-flow, where the
  // banner already says it.
  const incompleteLabels = [];
  if (!displaceFlow) {
    const previewed = previewSectionIds.map((id) => sectionsById[id]).filter(Boolean);
    draftCourses.forEach((course) => {
      const mine = previewed.filter((s) => s.courseKey === course.courseKey);
      if (mine.length === 0) return;
      const groups = groupSectionsByComponent((sectionsByCourse[course.courseKey] || []).filter((s) => s.classStat !== 'Cancelled'));
      groups.forEach((group) => {
        if (mine.some((s) => classifyComponent(s) === group.key)) return;
        incompleteLabels.push(`${courseMap[course.courseKey]?.courseNumber ?? course.courseKey} ${shortComponent(group.sections[0]?.componentLabel || group.key)}`);
      });
    });
  }

  // Esc exits section-swap without changing the current selection — same
  // "cancel" as the banner/sheet's own Cancel button, just keyboard-
  // reachable. Listens while a swap slot or any "Show all" ghosts are up, and
  // clears whichever ghost layer there is.
  useEffect(() => {
    if (!sectionSwapSlot && ghostGroups.size === 0) return undefined;
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (sectionSwapSlot) handleCloseSectionSwap();
      if (ghostGroups.size > 0) setGhostGroups(new Set());
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionSwapSlot, displaceFlow, ghostGroups]);

  // The displace flow only makes sense while the combination on screen is the
  // one it produced: if something else replaced it (Generate, Prev/Next, a
  // lock...), or the slot closed some other way, the flow just ends.
  useEffect(() => {
    if (displaceFlow && (!sectionSwapSlot || scheduleKey(previewSectionIds) !== displaceFlow.key)) {
      setDisplaceFlow(null);
      if (sectionSwapSlot) setSectionSwapSlot(null);
    }
  }, [displaceFlow, sectionSwapSlot, previewSectionIds]);

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
        const labelA = `${describeSectionName(secA, courseMap[a.courseKey]?.courseNumber ?? a.courseKey)} (${describeSectionTime(secA)})`;
        const labelB = `${describeSectionName(secB, courseMap[b.courseKey]?.courseNumber ?? b.courseKey)} (${describeSectionTime(secB)})`;
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

  // courseKey -> reason, for the short hint on each incomplete course's card
  // (Auto). Same wording as the old list under the Generate button.
  const blockerByCourse = useMemo(
    () => Object.fromEntries(generateBlockers.map((b) => [b.courseKey, b.reason])),
    [generateBlockers],
  );
  // Auto generates piece by piece: only the courses with every component
  // picked go into generation; the rest show as "not finished" on the grid.
  const completeCourses = useMemo(
    () => draftCourses.filter((c) => !blockerByCourse[c.courseKey]),
    [draftCourses, blockerByCourse],
  );
  const incompleteCourses = useMemo(
    () => draftCourses.filter((c) => blockerByCourse[c.courseKey]),
    [draftCourses, blockerByCourse],
  );
  // Checked/pinned sections of incomplete courses — the faint grid blocks.
  const pendingSectionIds = useMemo(
    () => [...new Set(incompleteCourses.flatMap((c) => [...c.locked, ...Object.values(c.considering).flat()]))],
    [incompleteCourses],
  );

  // Auto: each drafted course still missing a component, for the card status
  // line's sibling banner above the grid, the placeholders' "needs ..." label and
  // the legend ring. Same source as the blockers above (missingGroupsForCourse).
  const incompleteInfo = useMemo(() => {
    if (scheduleMode !== 'auto') return [];
    return draftCourses.flatMap((course) => {
      const sections = sectionsByCourse[course.courseKey];
      if (!sections || sections.length === 0 || loadingSectionsFor.has(course.courseKey)) return [];
      const missing = missingGroupsForCourse(course, sections, sectionsById);
      if (!missing || missing.length === 0) return [];
      return [{
        courseKey: course.courseKey,
        label: courseMap[course.courseKey]?.courseNumber ?? course.courseKey,
        missing: missing.map((g) => ({
          key: g.key,
          label: g.label === 'Other' ? 'Other sections' : g.label.replace('Discussion Section', 'Discussion'),
        })),
      }];
    });
  }, [scheduleMode, draftCourses, sectionsByCourse, sectionsById, courseMap, loadingSectionsFor]);
  const missingByCourse = useMemo(
    () => Object.fromEntries(incompleteInfo.map((i) => [i.courseKey, i.missing.map((m) => m.label)])),
    [incompleteInfo],
  );
  // Every checked or pinned section, for marking show-all ghosts as selected.
  const selectedGhostIds = useMemo(() => {
    const ids = new Set();
    draftCourses.forEach((c) => {
      c.locked.forEach((id) => ids.add(id));
      Object.values(c.considering).flat().forEach((id) => ids.add(id));
    });
    return ids;
  }, [draftCourses]);
  // The Global Time Filter: unchecks the checked sections that fail it and puts
  // exactly those back when it loosens (see filterAutoUncheck.js).
  // `autoUnchecked` = ids a filter unchecked; `handTouched` = ids the student
  // toggled by hand while a filter was on, which are never changed automatically
  // (cleared with the filter).
  const [autoUnchecked, setAutoUnchecked] = useState(() => new Set());
  const [handTouched, setHandTouched] = useState(() => new Set());
  function markHandTouched(ids) {
    setAutoUnchecked((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (isGlobalFilterActive(globalTimeFilter)) {
      setHandTouched((prev) => new Set([...prev, ...ids]));
    }
  }
  function handleChangeTimeFilter(next) {
    setGlobalTimeFilter(next);
    // Only Auto's own picks, and not while another term's schedule is on screen.
    if (scheduleMode !== 'auto' || previewHold === 'foreign' || !draftRestoredRef.current) return;
    const active = isGlobalFilterActive(next);
    const result = applyFilterToPicks(
      draftCourses,
      autoUnchecked,
      (id) => sectionsById[id],
      (section) => matchesFilters(section, next),
      active ? handTouched : new Set(),
    );
    if (!active) setHandTouched(new Set());
    if (result.draftCourses !== draftCourses) {
      setDraftCourses(result.draftCourses);
      markDraftEdited();
    }
    if (result.remembered !== autoUnchecked) setAutoUnchecked(result.remembered);
  }

  // One banner when the draft is big enough that generation may be slow or stop
  // early: the estimated options product (only sections passing the time filter)
  // is over SLOW_GENERATION_PRODUCT, or generation said it stopped early.
  // Dismissing hides it until it has dropped below and crossed again.
  const selectionProduct = useMemo(
    () => combinationProduct(draftCourses, sectionsByCourse, null, (section) => matchesFilters(section, globalTimeFilter)),
    [draftCourses, sectionsByCourse, globalTimeFilter],
  );
  const generationHeavy = selectionProduct > SLOW_GENERATION_PRODUCT || Boolean(generated?.truncated);
  const [heavyDismissed, setHeavyDismissed] = useState(false);
  useEffect(() => {
    if (!generationHeavy) setHeavyDismissed(false);
  }, [generationHeavy]);
  const [filterOpenSignal, setFilterOpenSignal] = useState(0);
  // The banner (or a status line) asked to jump to a component group.
  const [focusGroupRequest, setFocusGroupRequest] = useState(null);
  function handleFocusGroup(courseKey, groupKey) {
    setMobileView('build');
    setFocusGroupRequest({ courseKey, groupKey, n: Date.now() });
  }
  // What Save leaves out of an incomplete draft (it saves the schedule shown,
  // which only has the complete courses).
  const saveNote = incompleteInfo.length > 0
    ? `Leaves out: ${incompleteInfo.map((i) => `${i.label} (needs ${i.missing.map((m) => m.label).join(', ')})`).join('; ')}`
    : null;

  // Only computed once generation has actually come back empty — points at
  // which course(s) to blame instead of leaving the student to guess
  // between a time restriction, a pinned section, and a genuine clash.
  // Diagnoses the courses that were actually generated (the complete ones).
  // Filled in by the automatic regenerate (chunked like the search itself,
  // since it re-runs the search once per course) — see diagnoseAsync there.
  const [noScheduleCulprits, setNoScheduleCulprits] = useState([]);

  // Manual mode: course -> "pick a Lecture" for components with nothing placed.
  const manualHintByCourse = useMemo(() => {
    const hints = {};
    const placed = manualSectionIds.map((id) => sectionsById[id]).filter(Boolean);
    for (const course of draftCourses) {
      const groups = groupSectionsByComponent(sectionsByCourse[course.courseKey] || []);
      const missing = groups.filter((g) => !placed.some((s) => s.courseKey === course.courseKey && classifyComponent(s) === g.key));
      if (groups.length > 0 && missing.length > 0) {
        const labels = missing.map((g) => (g.label === 'Other' ? 'one of the ungrouped sections' : `${/^[aeiou]/i.test(g.label) ? 'an' : 'a'} ${g.label}`));
        hints[course.courseKey] = `pick ${labels.join(' and ')}`;
      }
    }
    return hints;
  }, [manualSectionIds, draftCourses, sectionsByCourse, sectionsById]);

  // Manual: the same shape as incompleteInfo, for the banner above the grid —
  // every drafted course's components with no placed section. Courses still
  // loading or with no sections are skipped.
  const manualIncompleteInfo = useMemo(() => {
    if (scheduleMode !== 'manual') return [];
    const placed = manualSectionIds.map((id) => sectionsById[id]).filter(Boolean);
    return draftCourses.flatMap((course) => {
      const sections = sectionsByCourse[course.courseKey];
      if (!sections || sections.length === 0 || loadingSectionsFor.has(course.courseKey)) return [];
      const missing = groupSectionsByComponent(sections)
        .filter((g) => !placed.some((s) => s.courseKey === course.courseKey && classifyComponent(s) === g.key));
      if (missing.length === 0) return [];
      return [{
        courseKey: course.courseKey,
        label: courseMap[course.courseKey]?.courseNumber ?? course.courseKey,
        missing: missing.map((g) => ({
          key: g.key,
          label: g.label === 'Other' ? 'Other sections' : g.label.replace('Discussion Section', 'Discussion'),
        })),
      }];
    });
  }, [scheduleMode, manualSectionIds, draftCourses, sectionsByCourse, sectionsById, courseMap, loadingSectionsFor]);

  const manualPlacedSet = useMemo(() => new Set(manualSectionIds), [manualSectionIds]);
  // Manual: every pair of placed sections that overlap, [idA, idB] each.
  const manualOverlapPairs = useMemo(() => {
    const placed = manualSectionIds.map((id) => sectionsById[id]).filter(Boolean);
    const pairs = [];
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (sectionsConflict(placed[i], placed[j])) pairs.push([placed[i].id, placed[j].id]);
      }
    }
    return pairs;
  }, [manualSectionIds, sectionsById]);

  function handleStepOverlap() {
    if (manualOverlapPairs.length === 0) return;
    const next = (overlapCursor + 1) % manualOverlapPairs.length;
    setOverlapCursor(next);
    const [a, b] = manualOverlapPairs[next];
    setOverlapPulse({ a, b, n: Date.now() });
  }

  // Overlap popover -> "Find another time": swap mode for that section's
  // component group, with a "Resolving: …" bar over the grid.
  function handleFindAnotherTime(section, text) {
    setSwapOrigin({ text });
    handleOpenSectionSwap(section.courseKey, classifyComponent(section), section.id);
  }
  // courseKey -> Set of group keys with "Show all" on, for each card.
  const ghostKeysByCourse = useMemo(() => {
    const byCourse = {};
    for (const key of ghostGroups) {
      const [courseKey, groupKey] = key.split('|');
      (byCourse[courseKey] ??= new Set()).add(groupKey);
    }
    return byCourse;
  }, [ghostGroups]);

  // Every section of each "Show all" group, minus what's already drawn.
  const showAllGhostSections = useMemo(() => {
    if (ghostGroups.size === 0) return [];
    // Only what's in the schedule is hidden: a checked section of a course that
    // isn't complete yet is still shown (selected) as a ghost, over its faint
    // placeholder, so it can be clicked off again.
    const drawn = new Set(previewSectionIds);
    const out = [];
    for (const key of ghostGroups) {
      const [courseKey, groupKey] = key.split('|');
      for (const s of sectionsByCourse[courseKey] || []) {
        if (classifyComponent(s) === groupKey && s.classStat !== 'Cancelled' && !drawn.has(s.id)) out.push(s);
      }
    }
    return out;
  }, [ghostGroups, sectionsByCourse, previewSectionIds]);

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
  //
  // Manual mode: the bookmark becomes the manual schedule. Auto: if it isn't
  // in the current batch it's held on screen (see previewHold) so automatic
  // regeneration doesn't replace it.
  function handlePreviewBookmark(sectionIds) {
    setActiveSavedId(null);
    if (scheduleMode === 'manual') {
      setManualSectionIds(sectionIds);
      setPreviewHold(null);
      return;
    }
    setPreviewSectionIds(sectionIds);
    const key = scheduleKey(sectionIds);
    const idx = generated ? generated.schedules.findIndex((ids) => scheduleKey(ids) === key) : -1;
    setPreviewIndex(idx >= 0 ? idx : null);
    setPreviewHold(idx >= 0 ? null : 'bookmark');
  }

  // Manual header: bookmark / save the placed sections.
  function handleToggleManualBookmark() {
    if (manualSectionIds.length === 0) return;
    const key = scheduleKey(manualSectionIds);
    setBookmarks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, manualSectionIds);
      return next;
    });
  }

  function handleSaveManual() {
    if (manualSectionIds.length === 0) return;
    handleSaveSchedule(`Schedule ${savedSchedules.filter((s) => scheduleTerm(s) === CURRENT_TERM).length + 1}`, manualSectionIds);
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

  // A draft edit means the student is back to working on the draft: whatever
  // was held on screen (a loaded saved schedule, a bookmark, a swap placement)
  // gives way to the automatic results again. The preview itself is left up
  // so the next regenerate can keep it if it's still among the results.
  function markDraftEdited() {
    setPreviewHold(null);
    setActiveSavedId(null);
  }

  // ── Manual mode ─────────────────────────────────────────────────────────────
  // One placed section per (course, component): placing another replaces it,
  // clicking the placed one removes it. Overlaps are allowed; the time filter
  // doesn't block anything here.
  function handlePlaceManual(courseKey, groupKey, sectionId) {
    setManualSectionIds((prev) => {
      if (prev.includes(sectionId)) return prev.filter((id) => id !== sectionId);
      const sameSlot = (id) => sectionsById[id]?.courseKey === courseKey && classifyComponent(sectionsById[id]) === groupKey;
      return [...prev.filter((id) => !sameSlot(id)), sectionId];
    });
    setPreviewHold(null);
    setActiveSavedId(null);
  }

  function handlePlaceGhost(sectionId) {
    const section = sectionsById[sectionId];
    if (section) handlePlaceManual(section.courseKey, classifyComponent(section), sectionId);
  }

  function handleRemovePlaced(sectionId) {
    setManualSectionIds((prev) => prev.filter((id) => id !== sectionId));
    setActiveSavedId(null);
  }

  function handleClearManual() {
    setManualSectionIds([]);
    setActiveSavedId(null);
  }

  // Switching modes keeps both modes' state; only view state (ghosts, an
  // open swap slot, anything held on screen) is dropped. Going back to Auto
  // shows the current batch right away (the debounced regenerate follows).
  function handleSetMode(mode) {
    if (mode === scheduleMode) return;
    setScheduleMode(mode);
    setGhostGroups(new Set());
    setSectionSwapSlot(null);
    setDisplaceFlow(null);
    setPreviewHold(null);
    setActiveSavedId(null);
    if (mode === 'auto') {
      const first = generated?.schedules?.[0];
      setPreviewIndex(first ? 0 : null);
      setPreviewSectionIds(first || []);
    }
  }

  // Stepper "Edit manually": the schedule on screen becomes the manual one.
  function handleEditManually() {
    setManualSectionIds(previewSectionIds);
    handleSetMode('manual');
  }

  // One ghost layer at a time, last action wins: turning "Show all" on for a
  // group clears any swap mode (and its "Resolving" bar) and every other group's
  // "Show all"; clicking the lit group's button again clears the layer.
  function handleToggleGhostGroup(courseKey, groupKey) {
    const key = `${courseKey}|${groupKey}`;
    if (sectionSwapSlot) handleCloseSectionSwap();
    setGhostGroups((prev) => (prev.has(key) ? new Set() : new Set([key])));
  }

  // "Update from draft": let go of whatever was held and show the batch.
  function handleUpdateFromDraft() {
    setPreviewHold(null);
    setActiveSavedId(null);
    if (scheduleMode === 'manual') return; // the manual sync effect shows the placed sections
    const first = generated?.schedules?.[0];
    setPreviewIndex(first ? 0 : null);
    setPreviewSectionIds(first || []);
  }

  // ── Draft handlers ──────────────────────────────────────────────────────────
  function handleAddCourse(courseKey) {
    if (draftCourseKeys.has(courseKey)) return;
    // Cached sections mean no fetch below, so the fetch's auto-check won't
    // run — apply it here for a re-added course.
    const cachedSections = sectionsByCourse[courseKey];
    setDraftCourses((prev) => {
      const next = [...prev, { courseKey, considering: {}, locked: [] }];
      return cachedSections ? autoCheckSingleOptionGroups(next, courseKey, cachedSections) : next;
    });
    setCollapseSignal((n) => n + 1);
    markDraftEdited();
    if (!courseMap[courseKey]) fetchCourseDocs([courseKey]);
    if (!cachedSections) fetchSectionsForCourse(courseKey);
  }

  function handleRemoveCourse(courseKey) {
    const gone = new Set((sectionsByCourse[courseKey] || []).map((s) => s.id));
    setAutoUnchecked((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    setHandTouched((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    setDraftCourses((prev) => prev.filter((c) => c.courseKey !== courseKey));
    setManualSectionIds((prev) => prev.filter((id) => sectionsById[id]?.courseKey !== courseKey));
    setGhostGroups((prev) => new Set([...prev].filter((key) => !key.startsWith(`${courseKey}|`))));
    markDraftEdited();
  }

  const groupSectionIds = (courseKey, groupKey) => (sectionsByCourse[courseKey] || [])
    .filter((s) => classifyComponent(s) === groupKey)
    .map((s) => s.id);

  function handleToggleSection(courseKey, groupKey, sectionId) {
    markHandTouched([sectionId]);
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
    markDraftEdited();
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
    markHandTouched([sectionId]);
    setDraftCourses((prev) => toggleLockInCourses(prev, courseKey, groupKey, sectionId));
    markDraftEdited();
  }

  // sectionIds is the explicit list to select, not "every section in the
  // group" — DraftCourseCard passes only the currently-visible (post-
  // filter) ones, so "Select all" while a time/professor filter is active
  // selects what's shown, not sections hidden by the filter.
  function handleSelectAllSections(courseKey, groupKey, sectionIds) {
    markHandTouched(groupSectionIds(courseKey, groupKey));
    setDraftCourses((prev) =>
      prev.map((c) =>
        c.courseKey === courseKey
          ? { ...c, considering: { ...c.considering, [groupKey]: sectionIds } }
          : c,
      ),
    );
    markDraftEdited();
  }

  // Scoped to the checkbox pool only — a lock is released via its own pin
  // button, not swept up by "select/deselect all", so the two controls each
  // stay predictable on their own.
  // Course-level toggle in a card header: every section of every component.
  function handleSelectAllCourse(courseKey) {
    markHandTouched((sectionsByCourse[courseKey] || []).map((s) => s.id));
    // Only the sections that pass the Global Time Filter get checked.
    const considering = {};
    groupSectionsByComponent(sectionsByCourse[courseKey] || []).forEach((g) => {
      considering[g.key] = g.sections.filter((s) => matchesFilters(s, globalTimeFilter)).map((s) => s.id);
    });
    setDraftCourses((prev) => prev.map((c) => (c.courseKey === courseKey ? { ...c, considering } : c)));
    markDraftEdited();
  }

  function handleDeselectAllCourse(courseKey) {
    markHandTouched((sectionsByCourse[courseKey] || []).map((s) => s.id));
    setDraftCourses((prev) => prev.map((c) => (c.courseKey === courseKey ? { ...c, considering: {} } : c)));
    markDraftEdited();
  }

  // Auto: a click on a show-all ghost is the same as its checkbox in the picker.
  function handleToggleGhost(sectionId) {
    const section = sectionsById[sectionId];
    if (section) handleToggleSection(section.courseKey, classifyComponent(section), sectionId);
  }

  function handleDeselectAllSections(courseKey, groupKey) {
    markHandTouched(groupSectionIds(courseKey, groupKey));
    setDraftCourses((prev) =>
      prev.map((c) => (c.courseKey === courseKey ? { ...c, considering: { ...c.considering, [groupKey]: [] } } : c)),
    );
    markDraftEdited();
  }

  function handleClearAll() {
    if (!window.confirm('Clear your whole draft? This removes every course and pick, including any pinned sections.')) return;
    setAutoUnchecked(new Set());
    setHandTouched(new Set());
    setDraftCourses([]);
    setManualSectionIds([]);
    setGhostGroups(new Set());
    markDraftEdited();
  }

  // ── Draft + bookmark persistence (utils/draftStorage.js) ───────────────────
  // Restore: runs once auth settles, and again whenever the signed-in uid
  // changes (sign-in, sign-out, account switch) — each identity has its own
  // stored draft (see draftStorage.js). Everything stored is re-checked against the
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
  // draftOwnerRef is the uid (null = guest) the on-screen draft belongs to,
  // i.e. whose key flushDraft writes to; undefined until the first restore.
  const draftOwnerRef = useRef(undefined);
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
    if (authLoading) return;
    const uid = user?.uid ?? null;
    // A guest who just signed in on this page (not a sign-out or account switch).
    const fromGuest = draftOwnerRef.current === null && uid !== null;
    let cancelled = false;

    // The on-screen draft belongs to someone else (sign-in, sign-out, account
    // switch): save any pending edit under THEIR key first, then blank the
    // board, so their draft is neither shown to nor saved under the new
    // identity. Nothing is copied between guest and account storage.
    draftRestoredRef.current = false;
    if (draftOwnerRef.current !== undefined && draftOwnerRef.current !== uid) {
      flushDraft();
      draftCoursesRef.current = [];
      restoredPreviewRef.current = null;
      setPendingRegen(false);
      setDraftCourses([]);
      setBookmarks(new Map());
      setGlobalTimeFilter(EMPTY_GLOBAL_FILTERS);
      setSectionSortMode('time');
      setScheduleMode('auto');
      setManualSectionIds([]);
      setGhostGroups(new Set());
      setPreviewHold(null);
      setSectionSwapSlot(null);
      invalidateGenerated();
    }

    async function restore() {
      let stored = readStoredDraft(uid);
      // Guest just signed in and the account has no draft of its own: carry the
      // guest's draft over (see the adoption write below). An account that
      // already has one shows its own and leaves the guest key alone.
      let adoptedGuest = false;
      if (!stored && fromGuest) {
        const guestStored = readStoredDraft(null);
        if (guestStored && (guestStored.courses.length > 0 || guestStored.bookmarks.length > 0 || guestStored.preview)) {
          stored = guestStored;
          adoptedGuest = true;
        }
      }
      if (!stored) {
        draftOwnerRef.current = uid;
        draftRestoredRef.current = true;
        return;
      }
      try {
        const courseKeys = stored.courses.map((c) => c.courseKey);
        const foundCourses = await lookupCourses(courseKeys);
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

        const bookmarkIds = [...new Set([...stored.bookmarks.flat(), ...(stored.preview?.sectionIds || []), ...stored.manualSectionIds])];
        const liveSections = {};
        for (let i = 0; i < bookmarkIds.length; i += 30) {
          const snap = await getDocs(query(collection(db, 'sections'), where(documentId(), 'in', bookmarkIds.slice(i, i + 30))));
          snap.docs.forEach((d) => {
            const sec = withMockMeetings({ id: d.id, ...d.data() });
            if (sec.term === CURRENT_TERM && sec.classStat !== 'Cancelled') liveSections[d.id] = sec;
          });
        }
        if (cancelled) return;
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
          setScheduleMode(stored.scheduleMode);
          setManualSectionIds(stored.manualSectionIds.filter((id) => liveSections[id]));
          if (previewIsLive) restoredPreviewRef.current = { ids: previewIds, index: storedPreview.index };
          setPendingRegen(true);
        } else if (previewIsLive && draftCoursesRef.current.length === 0) {
          // No draft to regenerate from (e.g. a previewed bookmark), but the
          // combination itself is still good.
          setPreviewSectionIds(previewIds);
          setPreviewIndex(null);
        }
        setBookmarks((prev) => new Map([...bookmarkEntries, ...prev]));
        draftOwnerRef.current = uid;
        draftRestoredRef.current = true;
        // Adopting the guest draft: write what was just shown under the
        // account's key, and only once that has succeeded drop the guest key.
        // Nothing shown (everything stale) leaves the guest key as it was.
        if (adoptedGuest) {
          const appliedCourses = draftCoursesRef.current.length === 0 && courses.length > 0;
          if ((appliedCourses || bookmarkEntries.length > 0 || previewIsLive)
            && writeStoredDraft({
              draftCourses: appliedCourses ? courses : [],
              globalTimeFilter: appliedCourses ? stored.globalTimeFilter : EMPTY_GLOBAL_FILTERS,
              sectionSortMode: appliedCourses ? stored.sortMode : 'time',
              bookmarks: new Map(bookmarkEntries),
              previewSectionIds: previewIsLive ? previewIds : [],
              previewIndex: storedPreview?.index ?? null,
            }, uid)) {
            clearStoredDraft(null);
          }
        }
      } catch (err) {
        console.warn('Could not restore the saved scheduler draft:', err);
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
    // Keyed on identity only: fetchSectionsForCourse etc. are re-created each
    // render but only read state through setters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.uid]);

  // Put the restored draft's stored combination back on screen. The automatic
  // regenerate (below) then finds it in the new batch and sets the stepper
  // position; if it isn't in the batch (e.g. a swap placement), it's held
  // instead of replaced — see restoredKeyRef. Skipped if a preview is already up.
  const restoredKeyRef = useRef(null);
  useEffect(() => {
    if (!pendingRegen) return;
    setPendingRegen(false);
    const target = restoredPreviewRef.current;
    restoredPreviewRef.current = null;
    if (previewSectionIds.length > 0 || !target) return;
    restoredKeyRef.current = scheduleKey(target.ids);
    setPreviewSectionIds(target.ids);
    setPreviewIndex(null);
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
    writeStoredDraft(latestDraftRef.current, draftOwnerRef.current);
  }, []);

  useEffect(() => {
    if (!draftRestoredRef.current) return;
    latestDraftRef.current = { draftCourses, globalTimeFilter, sectionSortMode, scheduleMode, manualSectionIds, bookmarks, previewSectionIds, previewIndex };
    draftDirtyRef.current = true;
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(flushDraft, 500);
  }, [draftCourses, globalTimeFilter, sectionSortMode, scheduleMode, manualSectionIds, bookmarks, previewSectionIds, previewIndex, flushDraft]);

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

  function handlePreview(index) {
    if (!generated) return;
    setPreviewIndex(index);
    setPreviewSectionIds(generated.schedules[index]);
    setActiveSavedId(null);
    setPreviewHold(null);
  }

  // ── Automatic generation (Auto mode) ───────────────────────────────────────
  // Regenerates ~300ms after the last change that can affect results: the
  // checked/pinned sections (any draft edit — add/remove a course, check,
  // pin, eliminate) or a course's section list arriving. Only the complete
  // courses are generated (see completeCourses); the others are drawn as
  // "not finished". The time filter isn't a trigger: it only dims sections,
  // it doesn't change which are checked, so it can't change the results.
  //
  // Cost per change: one debounced run of the strict search over the
  // complete courses, with the same MAX_EXPLORED / MAX_RESULTS caps as
  // before, run in chunks that yield to the browser (generateSchedulesAsync)
  // so typing and checkboxes stay responsive. A newer change cancels an
  // older run at its next yield (genRunRef). Paused while a swap slot is
  // open (re-run when it closes) and in Manual mode.
  //
  // What's on screen is kept when it can be: the same combination if it's
  // still in the batch (stepper moves to it), else the first. Something the
  // student is looking at on purpose (previewHold) is never replaced — the
  // batch updates underneath and "Update from draft" shows instead.
  const genRunRef = useRef(0);
  const liveViewRef = useRef({});
  liveViewRef.current = { previewSectionIds, previewHold, sectionsById };
  useEffect(() => {
    const run = ++genRunRef.current;
    if (!draftRestoredRef.current || scheduleMode !== 'auto' || sectionSwapSlot) {
      setGenerating(false);
      return undefined;
    }
    const timer = setTimeout(async () => {
      if (completeCourses.length === 0) {
        setGenerated(null);
        setGenerating(false);
        if (!liveViewRef.current.previewHold) {
          setPreviewIndex(null);
          setPreviewSectionIds([]);
        }
        return;
      }
      setGenerating(true);
      const byId = liveViewRef.current.sectionsById;
      const slots = buildGenerationSlots(completeCourses, sectionsByCourse, byId);
      const cancelled = () => genRunRef.current !== run;
      const result = await generateSchedulesAsync(slots, byId, { isCancelled: cancelled });
      if (!result || cancelled()) return;
      if (result.schedules.length === 0 && !result.truncated) {
        // Same rule as diagnoseNoSchedule (one course: it's that course;
        // otherwise a course whose removal lets a schedule through), each
        // re-run stopping at the first schedule found. Skipped when the
        // search itself hit MAX_EXPLORED: then nothing can be concluded, and
        // N more capped searches would multiply the cost of one change.
        let culprits = [];
        if (completeCourses.length === 1) {
          culprits = [completeCourses[0].courseKey];
        } else {
          for (let i = 0; i < completeCourses.length; i++) {
            const without = completeCourses.filter((_, idx) => idx !== i);
            const r = await generateSchedulesAsync(buildGenerationSlots(without, sectionsByCourse, byId), byId, { limit: 1, isCancelled: cancelled });
            if (!r || cancelled()) return;
            if (r.schedules.length > 0) culprits.push(completeCourses[i].courseKey);
          }
        }
        setNoScheduleCulprits(culprits);
      } else {
        setNoScheduleCulprits([]);
      }
      setGenerated(result);
      setGenerating(false);
      const { previewSectionIds: shown, previewHold: hold } = liveViewRef.current;
      const shownKey = scheduleKey(shown);
      const idx = shown.length > 0 ? result.schedules.findIndex((ids) => scheduleKey(ids) === shownKey) : -1;
      if (hold) {
        // Keep the held schedule; if it happens to be in the batch the
        // stepper can still show where.
        setPreviewIndex(idx >= 0 ? idx : null);
        return;
      }
      if (idx < 0 && shown.length > 0 && restoredKeyRef.current === shownKey) {
        // A restored combination that isn't in the batch (an old swap): keep it.
        restoredKeyRef.current = null;
        setPreviewHold('swap');
        setPreviewIndex(null);
        return;
      }
      restoredKeyRef.current = null;
      const i = idx >= 0 ? idx : (result.schedules.length > 0 ? 0 : null);
      setPreviewIndex(i);
      setPreviewSectionIds(i == null ? [] : result.schedules[i]);
    }, 300);
    return () => clearTimeout(timer);
  }, [scheduleMode, completeCourses, sectionsByCourse, sectionSwapSlot]);

  // Manual mode: the grid shows exactly the placed sections (unless another
  // term's schedule is being looked at).
  useEffect(() => {
    if (scheduleMode !== 'manual' || previewHold === 'foreign') return;
    setPreviewSectionIds(manualSectionIds);
    setPreviewIndex(null);
  }, [scheduleMode, manualSectionIds, previewHold]);

  // Lock/eliminate controls on the Preview grid's blocks themselves — same
  // underlying state changes as the draft picker's controls, just triggered
  // from the other side of the screen and immediately followed by a
  // regenerate so the stepper reflects the new combination count right
  // away instead of showing a stale count until the next manual Generate.
  function handlePreviewToggleLock(sectionId) {
    const section = sectionsById[sectionId];
    if (!section) return;
    markHandTouched([sectionId]);
    const groupKey = classifyComponent(section);
    const course = draftCourses.find((c) => c.courseKey === section.courseKey);
    const isSwappedIn = Boolean(course)
      && !course.locked.includes(sectionId)
      && !(course.considering[groupKey] || []).includes(sectionId);
    const next = isSwappedIn
      ? lockSwappedInSection(draftCourses, section.courseKey, groupKey, sectionId, previewSectionIds, sectionsById)
      : toggleLockInCourses(draftCourses, section.courseKey, groupKey, sectionId);
    setDraftCourses(next);
    markDraftEdited();
  }

  function handlePreviewEliminate(sectionId) {
    const section = sectionsById[sectionId];
    if (!section) return;
    markHandTouched([sectionId]);
    const groupKey = classifyComponent(section);
    const next = eliminateFromCourses(draftCourses, section.courseKey, groupKey, sectionId);
    setDraftCourses(next);
    markDraftEdited();
  }

  // ── Section-swap handlers ───────────────────────────────────────────────────
  // Starting swap mode clears every "Show all" ghost first; asking for the slot
  // that's already open closes it (one ghost layer at a time).
  function handleOpenSectionSwap(courseKey, component, currentSectionId) {
    if (displaceFlow) return; // finish or cancel the displace flow first
    if (sectionSwapSlot && sectionSwapSlot.courseKey === courseKey
      && sectionSwapSlot.component === component && sectionSwapSlot.currentSectionId === currentSectionId) {
      setSectionSwapSlot(null);
      return;
    }
    setGhostGroups(new Set());
    setSectionSwapSlot({ courseKey, component, currentSectionId });
  }

  // Closing keeps the selection as it is — except mid displace flow, where
  // Cancel (and Esc) put the schedule back exactly as it was before the click
  // that started it.
  function handleCloseSectionSwap() {
    if (displaceFlow) {
      const { ids, index, activeSavedId: savedId, hold } = displaceFlow.snapshot;
      setPreviewSectionIds(ids);
      setPreviewIndex(index);
      setActiveSavedId(savedId);
      setPreviewHold(hold ?? null);
      setDisplaceFlow(null);
    }
    setSectionSwapSlot(null);
  }

  // Moves the displace flow on: open the next displaced section's slot, or
  // finish. (Anything left out shows up as "incomplete" on the grid — see
  // incompleteLabels.)
  function continueDisplaceFlow({ ids, queue, snapshot }) {
    if (queue.length === 0) {
      setDisplaceFlow(null);
      setSectionSwapSlot(null);
      return;
    }
    setDisplaceFlow({ snapshot, queue, key: scheduleKey(ids) });
    setSectionSwapSlot({ courseKey: queue[0].courseKey, component: queue[0].component, currentSectionId: queue[0].sectionId });
  }

  // "Continue" when the displaced section has nowhere to go: leave it out.
  function handleContinueDisplaceFlow() {
    if (!displaceFlow) return;
    continueDisplaceFlow({
      ids: previewSectionIds,
      queue: displaceFlow.queue.slice(1),
      snapshot: displaceFlow.snapshot,
    });
  }

  // Places a ghost into the combination on screen — and ONLY there. The
  // draft (checked/locked sections) is untouched and nothing is regenerated,
  // so a section that's unchecked, eliminated or outside the time filter can
  // be previewed without being added to the pool. The preview no longer
  // matches any generated schedule or saved one, so the stepper position and
  // the active-saved highlight are dropped; the next Generate / Prev / Next /
  // lock / eliminate re-derives the preview from the draft and the placement
  // is gone (Save keeps it, since it saves what's on screen).
  //
  // A ghost that clashes with placed sections is allowed too: it goes in and
  // those sections are displaced (removed), then the displace flow walks
  // through them one by one. A clash with a pinned (locked) section is never
  // allowed.
  //
  // The placement is held on screen (previewHold 'swap') so automatic
  // regeneration doesn't wipe it; the next draft edit or "Update from draft"
  // lets it go (it was never in the draft — Save or pin it to keep it).
  function handleSelectSwapSection(sectionId) {
    if (!sectionSwapSlot) return;
    if (scheduleMode === 'manual') {
      // Manual: replace the section in that slot with the ghost. Overlaps are
      // allowed, so nothing else is displaced and no flow starts.
      const { currentSectionId } = sectionSwapSlot;
      if (sectionId !== currentSectionId && manualSectionIds.includes(currentSectionId)) {
        setManualSectionIds((prev) => prev.map((id) => (id === currentSectionId ? sectionId : id)));
        setPreviewHold(null);
        setActiveSavedId(null);
      }
      setSectionSwapSlot(null);
      return;
    }
    if (previewSectionIds.includes(sectionId)) {
      if (!displaceFlow) setSectionSwapSlot(null);
      return;
    }
    const inSlot = (id) => {
      const s = sectionsById[id];
      return s && s.courseKey === sectionSwapSlot.courseKey && classifyComponent(s) === sectionSwapSlot.component;
    };
    // The section the slot was opened on; if the preview has since changed
    // under it, fall back to whichever section now fills the slot. (A slot
    // opened for a displaced section has none: the ghost is simply added.)
    const replaceId = previewSectionIds.includes(sectionSwapSlot.currentSectionId)
      ? sectionSwapSlot.currentSectionId
      : previewSectionIds.find(inSlot);
    if (!replaceId && !displaceFlow) {
      setSectionSwapSlot(null);
      return;
    }
    const ghost = sectionsById[sectionId];
    const displaced = ghost
      ? previewSectionIds.filter((id) => !inSlot(id) && sectionsById[id] && sectionsConflict(sectionsById[id], ghost))
      : [];
    if (displaced.some((id) => allLockedSectionIds.has(id))) return; // pinned: blocked
    const nextIds = (replaceId
      ? previewSectionIds.map((id) => (id === replaceId ? sectionId : id))
      : [...previewSectionIds, sectionId]
    ).filter((id) => !displaced.includes(id));
    setPreviewSectionIds(nextIds);
    setPreviewIndex(null);
    setActiveSavedId(null);
    setPreviewHold('swap');
    if (displaced.length === 0 && !displaceFlow) {
      setSectionSwapSlot(null);
      return;
    }
    // Each displaced section remembers which swap removed it and the full set
    // that swap removed. If replacing one displaces more (a chain), those go
    // to the front so each swap's classes are dealt with together.
    const newItems = displaced.map((id, i) => ({
      courseKey: sectionsById[id].courseKey,
      component: classifyComponent(sectionsById[id]),
      sectionId: id,
      causedBy: sectionId,
      groupIds: displaced,
      groupIndex: i + 1,
      groupSize: displaced.length,
    }));
    continueDisplaceFlow({
      ids: nextIds,
      queue: [...newItems, ...(displaceFlow ? displaceFlow.queue.slice(1) : [])],
      snapshot: displaceFlow ? displaceFlow.snapshot : { ids: previewSectionIds, index: previewIndex, activeSavedId, hold: previewHold },
    });
  }

  function handleClearSwapSlot() {
    if (!sectionSwapSlot || displaceFlow) return;
    if (scheduleMode === 'manual') {
      // Manual: "clear this slot" takes the placed section off the schedule.
      handleRemovePlaced(sectionSwapSlot.currentSectionId);
      setSectionSwapSlot(null);
      return;
    }
    const next = clearSlotInCourses(draftCourses, sectionSwapSlot.courseKey, sectionSwapSlot.component, sectionsById);
    setDraftCourses(next);
    markDraftEdited();
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
          fetched[d.id] = withMockMeetings({ id: d.id, ...d.data() });
        });
      }
      setStandaloneSections((prev) => ({ ...prev, ...fetched }));
      const shown = ids.filter((id) => sectionsById[id] || fetched[id]);
      fetchCourseDocs([...new Set(shown.map((id) => (sectionsById[id] || fetched[id]).courseKey))]);
      setSectionSwapSlot(null);
      setPreviewIndex(null);
      setPreviewSectionIds(ids);
      setActiveSavedId(schedule.id);
      setPreviewHold('foreign');
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

    // A whole new draft: nothing the filter unchecked or the student toggled by
    // hand before applies to it.
    setAutoUnchecked(new Set());
    setHandTouched(new Set());

    const missing = ids.filter((id) => !sectionsById[id]);
    const fetchedById = {};
    for (let i = 0; i < missing.length; i += 30) {
      const batch = missing.slice(i, i + 30);
      // eslint-disable-next-line no-await-in-loop
      const snap = await getDocs(query(collection(db, 'sections'), where(documentId(), 'in', batch)));
      snap.docs.forEach((d) => {
        fetchedById[d.id] = withMockMeetings({ id: d.id, ...d.data() });
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
    // Auto: hold it so the automatic regenerate from the replaced draft
    // doesn't swap it out. Manual: it becomes the manual schedule.
    if (scheduleMode === 'manual') {
      setManualSectionIds(ids);
      setPreviewHold(null);
    } else {
      setPreviewHold('saved');
    }
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
              <div className="hub-year-toggle-group sched-mode-toggle" role="group" aria-label="Schedule mode">
                <button
                  type="button"
                  className={`hub-year-toggle-btn${scheduleMode === 'auto' ? ' active' : ''}`}
                  aria-pressed={scheduleMode === 'auto'}
                  onClick={() => handleSetMode('auto')}
                  title="Generate conflict-free schedules from your checked sections"
                >
                  Auto
                </button>
                <button
                  type="button"
                  className={`hub-year-toggle-btn${scheduleMode === 'manual' ? ' active' : ''}`}
                  aria-pressed={scheduleMode === 'manual'}
                  onClick={() => handleSetMode('manual')}
                  title="Place sections on the grid yourself — overlaps allowed"
                >
                  Manual
                </button>
              </div>
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

          {scheduleMode === 'auto' && generationHeavy && !heavyDismissed && draftCourses.length > 0 && (
            <LargeSelectionBanner
              onOpenFilter={() => { setMobileView('build'); setFilterOpenSignal((n) => n + 1); }}
              onDismiss={() => setHeavyDismissed(true)}
            />
          )}

          {draftCourses.length > 0 && (
            <GlobalTimeFilter
              value={globalTimeFilter}
              onChange={handleChangeTimeFilter}
              onClear={() => handleChangeTimeFilter(EMPTY_GLOBAL_FILTERS)}
              openSignal={filterOpenSignal}
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
              mode={scheduleMode}
              placedIds={manualPlacedSet}
              onPlace={(groupKey, sectionId) => handlePlaceManual(courseKey, groupKey, sectionId)}
              ghostGroupKeys={ghostKeysByCourse[courseKey] || EMPTY_SET}
              onToggleGhosts={(groupKey) => handleToggleGhostGroup(courseKey, groupKey)}
              onSelectAllCourse={() => handleSelectAllCourse(courseKey)}
              onDeselectAllCourse={() => handleDeselectAllCourse(courseKey)}
              focusRequest={focusGroupRequest}
              hint={scheduleMode === 'manual'
                ? (loadingSectionsFor.has(courseKey) ? null : manualHintByCourse[courseKey] || null)
                : blockerByCourse[courseKey] || null}
            />
          ))}
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
            {generating && previewIndex == null && <span className="sched-stepper-updating" role="status">Updating…</span>}
            {previewHold && (scheduleMode === 'auto' || previewHold === 'foreign') && (
              <button
                type="button"
                className="sched-update-from-draft-btn"
                onClick={handleUpdateFromDraft}
                title={scheduleMode === 'manual' ? 'Back to your manual schedule' : 'Show the schedules generated from your draft'}
              >
                Update from draft
              </button>
            )}
            {previewCreditsLabel && <span className="sched-right-credits">{previewCreditsLabel}</span>}
          </div>

          {scheduleMode === 'auto' && !previewHold && generated && generated.schedules.length === 0 ? (
            <div className="sched-generated-empty">
              <p>
                No conflict-free combination exists for the sections currently in consideration — try
                checking an additional section for one of your courses.
              </p>
              {generated.truncated && (
                <p className="sched-generated-empty-culprit">(stopped early — narrow your sections to see more)</p>
              )}
              {!generated.truncated && completeCourses.length === 1 && noScheduleCulprits.length === 1 && (
                <p className="sched-generated-empty-culprit">
                  The problem is within{' '}
                  <strong>{courseMap[noScheduleCulprits[0]]?.courseNumber ?? noScheduleCulprits[0]}</strong> itself —
                  none of its checked/pinned sections across components (Lecture, Discussion, Lab, …) leave a
                  conflict-free pairing. Try considering a different section for one of its parts.
                </p>
              )}
              {!generated.truncated && completeCourses.length > 1 && noScheduleCulprits.length > 0 && (
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
              {!generated.truncated && completeCourses.length > 1 && noScheduleCulprits.length === 0 && (
                <p className="sched-generated-empty-culprit">
                  No single course explains it — at least two of your courses are each unsatisfiable on their own
                  (or the clash only shows up across three or more together). Try temporarily removing courses one
                  at a time to isolate it.
                </p>
              )}
              <button type="button" className="sched-build-manually-btn" onClick={() => handleSetMode('manual')}>
                Build manually
              </button>
            </div>
          ) : (
            <div className="sched-preview-scroll">
              {scheduleMode === 'manual' && previewHold !== 'foreign' ? (
                <ManualScheduleHeader
                  creditsLabel={previewCreditsLabel}
                  overlapCount={manualOverlapPairs.length}
                  onStepOverlap={handleStepOverlap}
                  isBookmarked={manualSectionIds.length > 0 && bookmarks.has(scheduleKey(manualSectionIds))}
                  canAct={manualSectionIds.length > 0}
                  onToggleBookmark={handleToggleManualBookmark}
                  onSave={handleSaveManual}
                  onClear={handleClearManual}
                />
              ) : (
                <ScheduleStepper
                  generated={generated}
                  previewIndex={previewIndex}
                  onJump={handlePreview}
                  bookmarkedIndices={bookmarkedIndices}
                  onToggleBookmark={handleToggleBookmark}
                  sectionIds={previewSectionIds}
                  sectionsById={sectionsById}
                  updating={generating}
                  onEditManually={scheduleMode === 'auto' && previewSectionIds.length > 0 ? handleEditManually : undefined}
                />
              )}
              {scheduleMode === 'auto' && previewHold !== 'foreign' && (
                <IncompleteBanner info={incompleteInfo} onFocusGroup={handleFocusGroup} />
              )}
              {scheduleMode === 'manual' && previewHold !== 'foreign' && (
                <IncompleteBanner info={manualIncompleteInfo} onFocusGroup={handleFocusGroup} />
              )}
              <WeeklyGrid
                sectionIds={previewSectionIds}
                sectionsById={sectionsById}
                courseMap={courseMap}
                lockedSectionIds={scheduleMode === 'manual' ? EMPTY_SET : allLockedSectionIds}
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
                displaceInfo={displaceInfo}
                onContinueDisplace={handleContinueDisplaceFlow}
                incompleteLabels={scheduleMode === 'manual' ? [] : incompleteLabels}
                mode={scheduleMode === 'manual' && previewHold !== 'foreign' ? 'manual' : 'auto'}
                onRemovePlaced={handleRemovePlaced}
                pendingSectionIds={scheduleMode === 'auto' && !previewHold ? pendingSectionIds : []}
                showAllGhosts={previewHold === 'foreign' ? [] : showAllGhostSections}
                onPlaceGhost={scheduleMode === 'manual' ? handlePlaceGhost : null}
                onToggleGhost={scheduleMode === 'auto' ? handleToggleGhost : null}
                resolving={scheduleMode === 'manual' ? swapOrigin : null}
                pulse={scheduleMode === 'manual' ? overlapPulse : null}
                onFindAnotherTime={handleFindAnotherTime}
                hasOtherSections={(section) => (sectionsByCourse[section.courseKey] || []).some((s) => s.id !== section.id && classifyComponent(s) === classifyComponent(section))}
                selectedGhostIds={selectedGhostIds}
                missingByCourse={previewHold ? EMPTY_OBJ : missingByCourse}
                onClearGhosts={() => setGhostGroups(new Set())}
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
            saveNote={previewHold === 'foreign' ? null : saveNote}
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
          lockedSectionIds={scheduleMode === 'manual' ? EMPTY_SET : allLockedSectionIds}
          manual={scheduleMode === 'manual'}
          courseColors={courseColors}
          poolSectionIds={sectionSwapPoolIds}
          globalTimeFilter={globalTimeFilter}
          onSelect={handleSelectSwapSection}
          onToggleLock={handlePreviewToggleLock}
          onClearSlot={handleClearSwapSlot}
          onClose={handleCloseSectionSwap}
          displaceInfo={displaceInfo}
          onContinueDisplace={handleContinueDisplaceFlow}
        />
      )}
    </div>
  );
}
