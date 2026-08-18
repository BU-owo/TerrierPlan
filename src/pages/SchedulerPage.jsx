import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
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
import { auth, db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import HeaderNav from '../components/HeaderNav';
import HelpSupportModal from '../components/HelpSupportModal';
import SchedulerSearch from '../components/scheduler/SchedulerSearch';
import DraftCourseCard from '../components/scheduler/DraftCourseCard';
import GlobalTimeFilter from '../components/scheduler/GlobalTimeFilter';
import ScheduleStepper from '../components/scheduler/ScheduleStepper';
import WeeklyGrid from '../components/scheduler/WeeklyGrid';
import BookmarkedSchedulesPanel from '../components/scheduler/BookmarkedSchedulesPanel';
import SavedSchedulesPanel from '../components/scheduler/SavedSchedulesPanel';
import { CURRENT_TERM, CURRENT_TERM_LABEL } from '../utils/term';
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
// or saved. See scheduleColors.js's resolvedCourseColorIndex.
const COURSE_COLORS_LOCAL_KEY = 'terrierplan_scheduler_course_colors';
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

async function migrateGuestSchedulesIfNeeded(uid) {
  if (!guestScheduleMigrationPromise) {
    const raw = localStorage.getItem(SCHEDULES_LOCAL_KEY);
    let localSchedules = [];
    try {
      localSchedules = raw ? JSON.parse(raw) : [];
    } catch {
      localSchedules = [];
    }
    if (localSchedules.length === 0) {
      guestScheduleMigrationPromise = Promise.resolve();
    } else {
      localStorage.removeItem(SCHEDULES_LOCAL_KEY);
      guestScheduleMigrationPromise = (async () => {
        try {
          for (const schedule of localSchedules) {
            // eslint-disable-next-line no-await-in-loop
            await addDoc(collection(db, 'users', uid, 'schedules'), {
              name: schedule.name || 'My Schedule',
              term: schedule.term || CURRENT_TERM,
              selectedSectionIds: schedule.selectedSectionIds || [],
              favorited: Boolean(schedule.favorited),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          console.error('Error migrating guest schedules:', err);
          localStorage.setItem(SCHEDULES_LOCAL_KEY, JSON.stringify(localSchedules));
          guestScheduleMigrationPromise = null; // allow retry on next sign-in attempt
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

export default function SchedulerPage({ theme = 'light', onToggleTheme }) {
  const { user, loading: authLoading } = useAuth();

  // ── Draft (in-progress, unsaved schedule-building) state ──────────────────
  // [{ courseKey, considering: { [componentKey]: sectionId[] }, locked:
  // sectionId[] }] — componentKey is BU's raw `component` code (LEC/DIS/
  // LAB/..., see sectionComponents.js), so however many distinct
  // components a course has, it gets that many considering pools.
  // Deliberately not persisted anywhere (guest or signed-in): SCHEMA.md
  // only has a slot for *saved* schedules, so a work-in-progress draft
  // resets on reload, the same way an unsubmitted search query would.
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
  // completely different set of courses.
  const [bookmarks, setBookmarks] = useState(() => new Map());

  // ── Saved/favorited schedules ───────────────────────────────────────────────
  const [savedSchedules, setSavedSchedules] = useState([]);
  const [activeSavedId, setActiveSavedId] = useState(null); // which saved schedule (if any) the grid mirrors exactly

  const [mobileView, setMobileView] = useState('search'); // 'search' | 'build' | 'preview'
  const [showHelpModal, setShowHelpModal] = useState(false);

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

  // index === null clears back to the automatic hash color (see
  // WeeklyGrid's "Reset to auto").
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
        .filter((s) => s.term === CURRENT_TERM)
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
    } catch (err) {
      console.error('Failed to load sections for', courseKey, err);
    } finally {
      setLoadingSectionsFor((prev) => {
        const next = new Set(prev);
        next.delete(courseKey);
        return next;
      });
    }
  }

  const sectionsById = useMemo(() => {
    const map = {};
    Object.values(sectionsByCourse).forEach((list) => {
      list.forEach((section) => {
        map[section.id] = section;
      });
    });
    return map;
  }, [sectionsByCourse]);

  const draftCourseKeys = useMemo(() => new Set(draftCourses.map((c) => c.courseKey)), [draftCourses]);

  // Flattened across every course — the Preview grid's lock icon on a
  // block only needs to know "is this specific section locked," not which
  // course/component it belongs to.
  const allLockedSectionIds = useMemo(
    () => new Set(draftCourses.flatMap((c) => c.locked)),
    [draftCourses],
  );

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
  // job — "don't lose this candidate" — is done.
  async function handlePromoteBookmark(key, sectionIds) {
    await handleSaveSchedule(`Schedule ${savedSchedules.length + 1}`, sectionIds);
    handleRemoveBookmark(key);
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
      return;
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
    const next = toggleLockInCourses(draftCourses, section.courseKey, groupKey, sectionId);
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

  // ── Saved schedule handlers ──────────────────────────────────────────────────
  // sectionIds defaults to whatever's previewed (the normal Save-form path)
  // but can be passed explicitly — handlePromoteBookmark uses this to save
  // a bookmarked combination directly without first loading it into preview.
  // Only marks the new save "active" (highlighted, in the right-panel
  // title) when it's the thing actually on screen right now — promoting a
  // DIFFERENT bookmark than whatever's currently previewed shouldn't hijack
  // the header to name something the grid isn't showing.
  async function handleSaveSchedule(name, sectionIds = previewSectionIds) {
    if (sectionIds.length === 0) return;
    const isPreviewed = scheduleKey(sectionIds) === scheduleKey(previewSectionIds);
    if (user) {
      const ref = await addDoc(collection(db, 'users', user.uid, 'schedules'), {
        name,
        term: CURRENT_TERM,
        selectedSectionIds: sectionIds,
        favorited: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const q = query(collection(db, 'users', user.uid, 'schedules'), orderBy('updatedAt', 'desc'));
      const snap = await getDocs(q);
      setSavedSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (isPreviewed) setActiveSavedId(ref.id);
    } else {
      const schedule = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        term: CURRENT_TERM,
        selectedSectionIds: sectionIds,
        favorited: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setSavedSchedules((prev) => [schedule, ...prev]);
      if (isPreviewed) setActiveSavedId(schedule.id);
    }
  }

  async function handleRenameSchedule(schedule, name) {
    if (user) {
      await updateDoc(doc(db, 'users', user.uid, 'schedules', schedule.id), {
        name,
        updatedAt: serverTimestamp(),
      });
    }
    setSavedSchedules((prev) => prev.map((s) => (s.id === schedule.id ? { ...s, name } : s)));
  }

  async function handleToggleFavorite(schedule) {
    const favorited = !schedule.favorited;
    if (user) {
      await updateDoc(doc(db, 'users', user.uid, 'schedules', schedule.id), {
        favorited,
        updatedAt: serverTimestamp(),
      });
    }
    setSavedSchedules((prev) => prev.map((s) => (s.id === schedule.id ? { ...s, favorited } : s)));
  }

  async function handleDeleteSchedule(schedule) {
    if (user) {
      await deleteDoc(doc(db, 'users', user.uid, 'schedules', schedule.id));
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
      <header className="planner-header">
        <div className="planner-header-logo">
          <img src="/faviconred.png" alt="" width={18} height={18} />
          TerrierPlan
        </div>

        <HeaderNav active="scheduler" />

        <div className="planner-header-center">
          {user ? (
            <span className="sched-term-badge">{CURRENT_TERM_LABEL}</span>
          ) : (
            <div className="planner-guest-label">
              Browsing as guest — sign in to save your schedules
            </div>
          )}
        </div>

        <div className="planner-header-user">
          <button
            type="button"
            className="header-help-btn"
            onClick={() => setShowHelpModal(true)}
            aria-label="Help & feedback"
            title="Help & feedback"
          >
            <span className="header-help-btn-icon" aria-hidden="true">?</span>
            <span className="header-help-btn-label">Help</span>
          </button>
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
            <img className="planner-header-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
          )}
          {user ? (
            <>
              <span className="planner-header-name">{user?.displayName?.split(' ')[0]}</span>
              <button className="btn-signout" onClick={() => signOut(auth)} title="Sign out">
                <span className="btn-signout-icon" aria-hidden="true">Out</span>
                <span className="btn-signout-label">Sign out</span>
              </button>
            </>
          ) : (
            <Link className="btn-signin" to="/login">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <div className="scheduler-body" data-mobile-view={mobileView}>
        <aside className="scheduler-left">
          <SchedulerSearch draftCourseKeys={draftCourseKeys} onAddCourse={handleAddCourse} />
        </aside>

        <main className="scheduler-center">
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
                colorOverrides={courseColorOverrides}
                onSetColor={handleSetCourseColor}
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
    </div>
  );
}
