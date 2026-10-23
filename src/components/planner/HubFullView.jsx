import { useEffect, useMemo, useRef, useState } from 'react';
import { describeRequirementLabels, HUB_COLOR_FOR, HUB_LABELS } from '../../utils/hubConstants';
import { useHubProgress, contributorsForRequirement, satisfiedCountForRequirement } from '../../hooks/useHubProgress';
import { loadAllCourses, queryCourses, collectDepartmentPrefixes, HUB_MATCH_MODES, isProfessionalCareer } from '../../utils/courseQuery';
import { normalizeCourseKey } from '../../utils/courseKey';
import { entryCourseKey } from '../../utils/courseEntry';
import { completedHubInputs, hubBannerState } from '../../utils/completion';
import { formatCourseLabel } from '../requirements/treeHelpers';
import HubYearToggle from './HubYearToggle';
import EstimateNote from '../EstimateNote';
import { BU_LINKS } from '../../data/officialLinks';
import OneTimeHint from '../OneTimeHint';
import useOneTimeHint from '../../hooks/useOneTimeHint';
import CourseChip from '../requirements/CourseChip';
import { PawIcon } from './CourseSearch';
import FullViewHeader from './FullViewHeader';
import { HubChip, HubUnitTags, OfferingBadge, OFFERED_SNAPSHOT_NOTE } from './CourseTags';
import { CURRENT_TERM_LABEL } from '../../utils/term';
import useCurrentTermCourseKeys from '../../hooks/useCurrentTermCourseKeys';
import PawLoader from '../PawLoader';
import useDelayedBusy from '../../hooks/useDelayedBusy';

// Every HUB code, in HUB_GROUPS' own order (so the picker reads grouped by
// category, same visual order the color tokens already imply) — derived
// from HUB_COLOR_FOR rather than a separately hardcoded list, so it can't
// drift from the actual set of codes HubConstants knows about.
const ALL_HUB_CODES = Object.keys(HUB_COLOR_FOR);

// One ring, reused at two sizes (see the overview strip vs. each card's own
// header below) — SVG, no charting library, same currentColor-driven
// approach as the app's other hand-rolled icons (FlagIcon/PinIcon in the
// scheduler). Color comes entirely from whatever hub-ring-<id> class the
// caller wraps it in (see planner.css), which itself just points at the
// existing --hub-* tokens. The fill arc is still driven by `percent`; the
// center label shows the raw "fulfilled/total" count instead (e.g. "2/3")
// — more directly useful than a percentage, and every real HUB group's
// counts stay single-digit today, so it's no wider than "67%" was. Font
// size scales with `size` (inline, not a CSS class per size) and steps
// down for anything longer than 3 characters (a "10/10"-shaped group,
// should one ever exist) rather than truncating.

// `hideLabel` drops the center count (tiny rings that show it beside instead).
// `completedPercent`, when given and lower than `percent`, splits the fill:
// the category color up to completedPercent (completed courses), then a
// light tint of it (.hub-ring-planned) up to `percent`. Both are plain
// circles (dash length = circumference, offset = the unfilled share), so a
// full ring needs no special case. The center count is always `fulfilled`
// (done + planned) over `total`.
export function HubProgressRing({ percent, fulfilled, total, completedPercent, size = 56, strokeWidth = 6, hideLabel = false }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;
  const solidPercent = completedPercent != null ? Math.min(percent, completedPercent) : percent;
  const offsetFor = (pct) => circumference * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const label = `${fulfilled}/${total}`;
  const fontSize = Math.round(size * (label.length > 3 ? 0.18 : 0.24));
  const arcProps = {
    cx,
    cy,
    r: radius,
    strokeWidth,
    fill: 'none',
    strokeDasharray: circumference,
    transform: `rotate(-90 ${cx} ${cy})`,
  };

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="hub-ring" aria-hidden="true">
      <circle className="hub-ring-track" cx={cx} cy={cy} r={radius} strokeWidth={strokeWidth} fill="none" />
      {solidPercent < percent && (
        <circle className="hub-ring-planned" {...arcProps} strokeDashoffset={offsetFor(percent)} />
      )}
      {solidPercent > 0 && (
        <circle className="hub-ring-fill" {...arcProps} strokeDashoffset={offsetFor(solidPercent)} />
      )}
      {!hideLabel && (
        <text
          x="50%"
          y="50%"
          className="hub-ring-label"
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize }}
        >
          {label}
        </text>
      )}
    </svg>
  );
}

// "+N" paw chip under a category label: the units the Paw-tential stash
// would add over the plan there. Nothing when it adds none.
function PotentialAddChip({ units }) {
  if (!(units > 0)) return null;
  return (
    <span className="hub-potential-chip" title={`Would add ${units} with your Paw-tential courses.`}>
      <PawIcon filled />+{units}
    </span>
  );
}

// Splits the (already plan-order-stable) group list into render segments,
// preserving top-to-bottom order: an expanded category becomes its own
// solo full-width segment, and a run of consecutive COLLAPSED categories
// becomes one shared-grid segment. Without this, feeding every card
// straight into one CSS grid left leftover cells wherever an expanded
// (grid-column: 1/-1) card interrupted a partial row, which read as an
// accidental layout break rather than an intentional pattern — segmenting
// first means a run of collapsed cards always starts its OWN grid, so it
// always packs cleanly regardless of what came before it.
function segmentGroups(groupSummaries, collapsedOf) {
  const segments = [];
  let run = [];
  function flushRun() {
    if (run.length > 0) {
      segments.push({ type: 'run', items: run });
      run = [];
    }
  }
  for (const g of groupSummaries) {
    if (collapsedOf(g)) {
      run.push(g);
    } else {
      flushRun();
      segments.push({ type: 'solo', item: g });
    }
  }
  flushRun();
  return segments;
}

// Custom-styled suggestion dropdown for the department-prefix input,
// replacing a native <datalist> (unstyleable, can't be themed) with the
// exact same absolutely-positioned listbox look CourseSearch's own
// HubFilterSelect dropdown already uses elsewhere in this app — same
// position/border/radius/shadow tokens, not a new dropdown design. Arrow
// keys move a highlighted option, Enter selects it, Escape/click-outside
// closes; the input stays a plain free-text field throughout; a highlight
// is just a suggestion, never a requirement to pick one.
function DepartmentPrefixAutocomplete({ value, onChange, allPrefixes, loading = false }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  // Keeps arrow-key nav usable now that the list isn't capped to a
  // handful of items — without this, highlighting item 40 of a long "CAS"
  // match would move the selection outside the scrolled viewport instead
  // of scrolling to follow it.
  useEffect(() => {
    if (highlighted < 0) return;
    listRef.current?.children[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const trimmed = value.trim().toUpperCase();
  // No cap here — a broad match like "CAS" is meant to list every CAS
  // department; the listbox's own maxHeight/overflowY below is what makes
  // that scrollable instead of blowing out the page.
  const suggestions = trimmed ? allPrefixes.filter((p) => p.includes(trimmed)) : [];
  // Typing before the catalog is in: a small paw (after a moment) instead of nothing.
  const suggestionsLoading = useDelayedBusy(loading && open && Boolean(trimmed));

  function selectSuggestion(code) {
    onChange(code);
    setOpen(false);
    setHighlighted(-1);
  }

  function handleKeyDown(e) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="hub-browse-input-wrap" style={{ position: 'relative' }}>
      <input
        type="text"
        className="search-input"
        placeholder="e.g. CAS CS or CAS"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
      />
      {open && suggestionsLoading && suggestions.length === 0 && (
        <div
          role="status"
          style={{
            position: 'absolute',
            zIndex: 40,
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: 'var(--cream)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xs)',
            padding: '5px 8px',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          <PawLoader size="small" label="Loading departments…" />
        </div>
      )}
      {open && suggestions.length > 0 && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 40,
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--cream)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xs)',
            padding: 4,
            boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(0,0,0,.12))',
          }}
        >
          {suggestions.map((code, i) => (
            <div
              key={code}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(code);
              }}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                padding: '5px 8px',
                fontSize: 12,
                borderRadius: 3,
                cursor: 'pointer',
                color: 'var(--text)',
                background: i === highlighted ? 'var(--scarlet-pale)' : 'transparent',
              }}
            >
              {code}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Search results render this many at a time (see showMoreResults).
const RESULTS_PAGE_SIZE = 50;

// One search result row — same info layout as CourseSearch's own
// SearchResultCard (code, name, HUB unit tags) plus its exact stash-toggle
// button/icon, reused as-is rather than rebuilt. Deliberately simpler than
// SearchResultCard otherwise: no drag-to-semester (this view has no
// semester context to drop into) and no "already added" state (courses
// already in the plan never reach this list — see excludeKeys below).
// Stashed courses DO still show here (excludeKeys deliberately only drops
// plan courses, not stash) — with the button already in `is-stashed` amber
// so the student can keep comparing/toggling it right there instead of it
// vanishing the moment they stash it.
//
// Rows are never dimmed (a stashed row shows its filled paw button). The
// HUB tags are the shared HubUnitTags, which marks codes the student no
// longer needs.
function HubSearchResultRow({ course, isStashed, onAddToStash, onRemoveFromStash, onShowInfo, matchCodes }) {
  const label = course.courseNumber ?? course.id;
  // Staged rows come from courseMap, which has no `inCurrentTerm`.
  const currentTermKeys = useCurrentTermCourseKeys();
  return (
    <div className="search-result-card" style={{ cursor: 'default' }}>
      <div className="search-result-info">
        <div className="search-result-code">{label}</div>
        <div className="search-result-name-row">
          <span className="search-result-name" title={course.name ?? undefined}>{course.name ?? '—'}</span>
        </div>
        {/* Badges line: study-abroad flag, HUB tags, then the offering badge (hidden when empty). */}
        <div className="search-result-hub">
          {course.studyAbroad && (
            <span className="offering-badge offering-badge-abroad">Study abroad</span>
          )}
            <HubUnitTags units={course.hubUnits} max={Infinity} stashed={isStashed} matchCodes={matchCodes} />
            <OfferingBadge
              offeringPattern={course.offeringPattern}
              upcomingSeasons={course.upcomingSeasons}
              inCurrentTerm={course.inCurrentTerm ?? currentTermKeys?.has(course.id)}
            />
        </div>
      </div>
      {/* Stash and "i" stacked, same as CourseSearch's SearchResultCard. */}
      <div className="search-result-actions">
        <button
          type="button"
          className={`search-result-stash-btn${isStashed ? ' is-stashed' : ''}`}
          onClick={() => (isStashed ? onRemoveFromStash(course.id) : onAddToStash(course.id))}
          aria-label={isStashed ? `Remove ${label} from Paw-tential Courses` : `Save ${label} to Paw-tential`}
          title={isStashed ? 'Remove from Paw-tential Courses' : 'Save to Paw-tential'}
        >
          <PawIcon filled={isStashed} />
        </button>
        {onShowInfo && (
          <button
            type="button"
            className="search-result-info-btn"
            onClick={() => onShowInfo(course.id)}
            aria-label={`View details for ${label}`}
            title="Course details"
          >
            i
          </button>
        )}
      </div>
    </div>
  );
}

// One toggleable HUB code in the gap-fill search's include/exclude pickers —
// the same `hub-chip hub-chip-<groupId>` coloring as every read-only HUB
// tag, as a toggle button: unselected keeps the category tint with an
// outline in its own color; selected fills solid like a matching result
// chip (.is-match). Same size either way (see .hub-code-toggle).
// `exclude` (the Exclude grid): selected fills dark gray with a "−" instead.
function HubCodeChip({ code, selected, onToggle, exclude = false }) {
  const selectedClass = exclude ? ' is-excluded' : ' is-match';
  return (
    <button
      type="button"
      className={`hub-chip hub-chip-${HUB_COLOR_FOR[code]?.groupId ?? 'def'} hub-code-toggle${selected ? selectedClass : ''}`}
      onClick={() => onToggle(code)}
      aria-pressed={selected}
      title={HUB_LABELS[code] ?? code}
    >
      {exclude && selected && <span aria-hidden="true">− </span>}
      {code}
    </button>
  );
}

// Full-screen overlay/mode rendered from inside PlannerPage (not a route —
// mirrors RequirementsFullView.jsx's pattern exactly: same dialog/Escape
// chrome, opened via PlannerPage's `?view=hub` state instead of duplicating
// it). Progress/completion data comes entirely from useHubProgress, the
// same computation HubSidebar's compact tab uses — this component only
// adds a redesigned, higher-density presentation of it (an overview ring
// strip, collapsible per-category cards, inline course/exam names via the
// shared CourseChip) plus reuses HubYearToggle as-is. Does not touch
// requirementsEngine.js, HUB_REQUIREMENTS.md parsing, or external-credit
// HUB resolution.
//
// Also hosts a single course-search panel built on the shared in-memory
// course list (courseQuery.js's loadAllCourses/queryCourses): department
// prefix, HUB-code include/exclude, and AND/OR mode are all just facets of
// the ONE queryCourses call and ONE results list — not separate searches —
// so e.g. a department prefix and a HUB code combine instead of requiring
// two different tools. The include-set can also be one-click pre-filled
// from useHubProgress's openRequirements (still-needed unit codes) —
// "show me courses that could fill what I'm missing." Stashing a course
// from search results keeps it visible (styled as already-stashed) rather
// than removing it, so the student can keep comparing options; every ring
// also shows a faded preview arc of what stashing everything currently
// paw-tentialed would add, and a running list of those courses sits right
// in this view instead of only in the main planner's own stash panel.
export default function HubFullView({
  semesters,
  extraCourseKeys = [],
  externalCredits = [],
  courseMap,
  isTransfer,
  onToggleTransfer,
  lockStatusMap,
  // lockStatusMap when the done-vs-planned split applies, else undefined
  // (see planSplitEnabled): the solid/dashed ring split and planned rows.
  splitStatusMap,
  stash = [],
  onAddToStash,
  onRemoveFromStash,
  // Opens PlannerPage's CourseInfoPanel ("i" on search results).
  onShowCourseInfo,
  // True while CourseInfoPanel is open, so its own Escape closes just it.
  ignoreEscape = false,
  onClose,
  // Closes this view and opens the planner's Paw-tential Courses tab.
  onShowStash,
  // Swaps to the Requirements overlay without closing (see FullViewHeader).
  onSwitchView,
  // The plan or its courses' data is still loading (PlannerPage), so the
  // rings would count up from partial data: they dim with a small paw.
  hubLoading = false,
}) {
  const ringsLoaderVisible = useDelayedBusy(hubLoading);
  // One-time hints for this view (they outrank the planner's behind it).
  const [finderHintVisible, dismissFinderHint, markFinderSeen] = useOneTimeHint('hub_finder', { priority: 1 });
  const [potentialHintVisible, dismissPotentialHint, markPotentialSeen] = useOneTimeHint('hub_potential', {
    priority: 2,
    when: stash.length > 0,
  });

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !ignoreEscape) onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, ignoreEscape]);

  // stashCourseKeys adds staged-only entries to contributorsByUnit (see
  // useHubProgress) — they render in the same requirement rows as real
  // contributors below, but never affect counts/progress/fulfilled/
  // groupSummaries.satisfied, which stay computed from real courses only.
  const { groupSummaries, contributorsByUnit, counts, openRequirements, allFulfilled, fulfilled } = useHubProgress({
    semesters,
    extraCourseKeys,
    externalCredits,
    courseMap,
    isTransfer,
    stashCourseKeys: stash,
  });

  // "What if I added everything in my stash" preview — the exact same
  // useHubProgress computation, just with the stash folded into
  // extraCourseKeys, so nothing below duplicates any counting/progress
  // math of its own. Only groupSummaries (each category's "+N" paw chip) is
  // used from this second call. Stashed courses already on the plan are
  // dropped so they aren't counted twice (same as HubSidebar's "could add").
  const extraCourseKeysWithStash = useMemo(() => {
    const planKeys = new Set([...semesters.flatMap((sem) => sem.map(entryCourseKey)), ...extraCourseKeys]);
    return [...extraCourseKeys, ...stash.filter((key) => !planKeys.has(key))];
  }, [semesters, extraCourseKeys, stash]);
  const { groupSummaries: potentialGroupSummaries } = useHubProgress({
    semesters,
    extraCourseKeys: extraCourseKeysWithStash,
    externalCredits,
    courseMap,
    isTransfer,
  });
  // Units the stash would add over the plan, per category.
  const potentialAddByGroupId = useMemo(() => {
    const realByGroupId = Object.fromEntries(groupSummaries.map((g) => [g.group.id, g.fulfilled]));
    return Object.fromEntries(potentialGroupSummaries.map((g) => [g.group.id, Math.max(0, g.fulfilled - (realByGroupId[g.group.id] ?? 0))]));
  }, [groupSummaries, potentialGroupSummaries]);

  // Completed-only progress — the same computation again with only the
  // courses that count as done (see completion.js): the solid part of each
  // ring, and which satisfied requirements are done vs. only planned.
  const completedInputs = useMemo(
    () => completedHubInputs(semesters, extraCourseKeys, splitStatusMap),
    [semesters, extraCourseKeys, splitStatusMap],
  );
  const { groupSummaries: completedGroupSummaries, fulfilled: completedFulfilled } = useHubProgress({
    semesters: completedInputs.semesters,
    extraCourseKeys: completedInputs.extraCourseKeys,
    externalCredits,
    courseMap,
    isTransfer,
  });
  // Same banner rules as HubSidebar (hubBannerState).
  const hubBanner = hubBannerState({ allFulfilled, fulfilled, completedFulfilled });
  const completedPercentByGroupId = useMemo(
    () => Object.fromEntries(completedGroupSummaries.map((g) => [g.group.id, g.percent])),
    [completedGroupSummaries],
  );
  // Ring tooltip: "N done, M planned", zero parts left out.
  const completedFulfilledByGroupId = useMemo(
    () => Object.fromEntries(completedGroupSummaries.map((g) => [g.group.id, g.fulfilled])),
    [completedGroupSummaries],
  );
  function ringTitle(groupId, groupFulfilled) {
    const done = Math.min(groupFulfilled, completedFulfilledByGroupId[groupId] ?? 0);
    const planned = groupFulfilled - done;
    return [done > 0 && `${done} done`, planned > 0 && `${planned} planned`].filter(Boolean).join(', ') || undefined;
  }
  const completedSatisfiedIds = useMemo(
    () => new Set(completedGroupSummaries.flatMap((g) => g.requirements
      .filter(({ isSatisfied }) => isSatisfied)
      .map(({ requirement }) => requirement.id))),
    [completedGroupSummaries],
  );

  // Search panel state. Courses load once into memory via the shared cache
  // in courseQuery.js (loadAllCourses) — if CourseSearch has already loaded
  // them this session this resolves immediately from that same cached
  // promise instead of firing a second Firestore read.
  const [allCourses, setAllCourses] = useState([]);
  // Distinguishes "catalog still downloading" from "no matches" in the
  // results list. Set on failure too, so an error doesn't read as loading
  // forever (it falls back to the empty-results message, as before).
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [searchPrefix, setSearchPrefix] = useState('');
  const [hubSearchInclude, setHubSearchInclude] = useState([]);
  const [hubSearchExclude, setHubSearchExclude] = useState([]);
  const [hubSearchMode, setHubSearchMode] = useState(HUB_MATCH_MODES.OR);
  // Exclude picker starts collapsed behind "+ Exclude codes".
  const [excludeOpen, setExcludeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAllCourses().then((courses) => {
      if (!cancelled) setAllCourses(courses);
    }).catch((err) => {
      console.error('Failed to load courses for search:', err);
      if (!cancelled) setCoursesFailed(true);
    }).finally(() => {
      if (!cancelled) setCoursesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // HUB is for undergrads, who can take Undergrad and most Graduate courses
  // but not Law/Dental/Medical ones — so this search (and its prefix
  // datalist) drops only those. Study-abroad courses are dropped here too
  // (finder only — planner and scheduler search still list them).
  const nonProfessionalCourses = useMemo(
    () => allCourses.filter((course) => !isProfessionalCareer(course.career) && !course.studyAbroad),
    [allCourses],
  );

  // Every real department/school prefix in the loaded catalog (e.g. "CAS",
  // "CAS CH", "COM CO") — auto-populates the prefix input's datalist
  // instead of requiring the student to already know exact department
  // codes to type.
  const departmentPrefixes = useMemo(() => collectDepartmentPrefixes(nonProfessionalCourses), [nonProfessionalCourses]);

  // Same Set-membership exclusion collectPoolCourses uses in treeHelpers.js
  // (planCourseKeySet) — courses already on the plan have nothing left to
  // offer this search. Deliberately does NOT also drop stashed courses (an
  // earlier pass did): stashing one from search results used to make it
  // disappear entirely, which meant a student couldn't keep comparing it
  // against other options still in the list. It stays visible, just
  // rendered with its stash button already in the "stashed" state (see
  // stashSet/HubSearchResultRow below).
  // Memoized on the keys' contents: PlannerPage passes a new extraCourseKeys
  // array every render, which would otherwise rebuild this (and re-run the
  // search) on unrelated planner re-renders.
  const excludeKeysId = [...semesters.flatMap((sem) => sem.map(entryCourseKey)), ...extraCourseKeys]
    .filter(Boolean)
    .map(normalizeCourseKey)
    .sort()
    .join(',');
  const excludeKeys = useMemo(() => new Set(excludeKeysId ? excludeKeysId.split(',') : []), [excludeKeysId]);

  const stashSet = useMemo(() => new Set(stash), [stash]);
  // Include codes, filled on the results' HUB tags.
  const includeSet = useMemo(() => new Set(hubSearchInclude), [hubSearchInclude]);

  // Stashed courses that actually carry a HUB unit — a running "what I've
  // paw-tentially queued up for HUB" list, visible right here instead of
  // only in the main planner's Paw-tential Courses panel (which sits
  // behind this full-screen overlay). Reads courseMap the same way
  // useHubProgress itself does — no separate stash-tracking state.
  const stashedHubCourses = useMemo(
    () =>
      stash
        .filter((key) => (courseMap[key]?.hubUnits?.length ?? 0) > 0)
        .map((key) => ({ id: key, ...courseMap[key] })),
    [stash, courseMap],
  );

  // Every still-needed unit code across every unsatisfied requirement,
  // deduped — openRequirements already gives us "the code(s) that would
  // satisfy this requirement" per requirement; gap-fill just unions them
  // instead of asking per-requirement.
  const gapCodes = useMemo(() => {
    const codes = new Set();
    openRequirements.forEach((req) => req.unitCodes.forEach((code) => codes.add(code)));
    return Array.from(codes);
  }, [openRequirements]);

  // Include and Exclude are mutually exclusive per code: picking a code in
  // one drops it from the other (a code in both would match nothing).
  function toggleIncludeCode(code) {
    const adding = !hubSearchInclude.includes(code);
    setHubSearchInclude((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    if (adding) setHubSearchExclude((prev) => prev.filter((c) => c !== code));
  }
  function toggleExcludeCode(code) {
    const adding = !hubSearchExclude.includes(code);
    setHubSearchExclude((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    if (adding) setHubSearchInclude((prev) => prev.filter((c) => c !== code));
  }
  // "Clear": include, exclude and match mode (the Offered toggle stays).
  function clearCodeFilters() {
    setHubSearchInclude([]);
    setHubSearchExclude([]);
    setHubSearchMode(HUB_MATCH_MODES.OR);
  }
  // Pre-fills the include-set from the student's actual remaining gaps —
  // still just state after this, not locked, so every chip/mode toggle
  // (and the prefix input) keeps working normally on top of it.
  function applyGapFill() {
    setHubSearchInclude(gapCodes);
    setHubSearchMode(HUB_MATCH_MODES.OR);
    setHubSearchExclude([]);
  }

  // ONE search: prefix, HUB include/exclude, and mode are all just
  // arguments to the same queryCourses call — a department prefix and a
  // HUB code narrow the same result set together, they don't run as two
  // separate searches.
  const trimmedPrefix = searchPrefix.trim();
  const searchActive = Boolean(trimmedPrefix) || hubSearchInclude.length > 0 || hubSearchExclude.length > 0;
  const catalogLoaderVisible = useDelayedBusy(searchActive && !coursesLoaded);
  // In-memory only: limit results to catalog `inCurrentTerm` courses.
  const [offeredOnly, setOfferedOnly] = useState(false);
  const hasCurrentTermData = useMemo(() => allCourses.some((c) => c.inCurrentTerm), [allCourses]);
  const searchResults = useMemo(() => {
    if (!searchActive) return [];
    const matches = queryCourses(
      nonProfessionalCourses,
      { prefix: trimmedPrefix, hubUnitCodes: hubSearchInclude, mode: hubSearchMode, excludeUnitCodes: hubSearchExclude },
      excludeKeys,
    );
    return offeredOnly ? matches.filter((course) => course.inCurrentTerm) : matches;
  }, [searchActive, nonProfessionalCourses, trimmedPrefix, hubSearchInclude, hubSearchMode, hubSearchExclude, excludeKeys, offeredOnly]);

  // Rendering every match is slow (gap-fill can match ~2.5k courses), so
  // only the first RESULTS_PAGE_SIZE of the ranked list render, plus
  // RESULTS_PAGE_SIZE more per "Show more". Tied to the search inputs it
  // was grown for, so changing any of them starts back at one page (and a
  // stash or other re-render doesn't).
  const searchInputsId = JSON.stringify([trimmedPrefix, hubSearchInclude, hubSearchMode, hubSearchExclude, offeredOnly]);
  const [shownResults, setShownResults] = useState({ inputsId: null, count: RESULTS_PAGE_SIZE });
  const visibleCount = shownResults.inputsId === searchInputsId ? shownResults.count : RESULTS_PAGE_SIZE;
  function showMoreResults() {
    setShownResults({ inputsId: searchInputsId, count: visibleCount + RESULTS_PAGE_SIZE });
  }
  // Memoized so a re-render that doesn't change the results (e.g. a chip
  // click elsewhere in the view) doesn't re-render every row.
  const resultRows = useMemo(
    () => searchResults.slice(0, visibleCount).map((course) => (
      <HubSearchResultRow
        key={course.id}
        course={course}
        isStashed={stashSet.has(course.id)}
        matchCodes={includeSet}
        onAddToStash={onAddToStash}
        onRemoveFromStash={onRemoveFromStash}
        onShowInfo={onShowCourseInfo}
      />
    )),
    [searchResults, visibleCount, stashSet, includeSet, onAddToStash, onRemoveFromStash, onShowCourseInfo],
  );

  // Per-category collapse state — the ONE source of truth for both the
  // overview ring row and each category's own card; same "override
  // defaults to computed satisfied-ness" idiom HubSidebar's own
  // collapsedOverrides already uses (satisfied categories start collapsed,
  // everything else starts open), just keyed by group.id.
  const [collapsedOverrides, setCollapsedOverrides] = useState({});

  function isCollapsed(groupSummary) {
    return collapsedOverrides[groupSummary.group.id] ?? groupSummary.satisfied;
  }

  // Toggles in place — no scrollIntoView, whether triggered from an
  // overview ring or a card's own header. The card updates wherever it
  // already sits on the page; scrolling to it is left to the user.
  function toggleGroup(groupId, currentlyCollapsed) {
    setCollapsedOverrides((prev) => ({ ...prev, [groupId]: !currentlyCollapsed }));
  }

  const anyCollapsed = groupSummaries.some((g) => isCollapsed(g));

  function toggleAll() {
    setCollapsedOverrides(Object.fromEntries(groupSummaries.map((g) => [g.group.id, !anyCollapsed])));
  }

  function renderGroupCard(groupSummary) {
    const { group, requirements, fulfilled: groupFulfilled, total: groupTotal, percent, satisfied } = groupSummary;
    const collapsed = isCollapsed(groupSummary);

    return (
      <section key={group.id} className={`hub-full-group${collapsed ? '' : ' is-expanded'}`}>
        <div
          className="hub-full-group-header"
          role="button"
          tabIndex={0}
          onClick={() => toggleGroup(group.id, collapsed)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleGroup(group.id, collapsed);
            }
          }}
          aria-expanded={!collapsed}
        >
          <span className={`hub-ring-wrap hub-ring-${group.id}`} title={ringTitle(group.id, groupFulfilled)}>
            <HubProgressRing
              percent={percent}
              fulfilled={groupFulfilled}
              total={groupTotal}
              completedPercent={completedPercentByGroupId[group.id]}
              size={38}
              strokeWidth={4}
            />
          </span>
          <div className="hub-full-group-heading">
            <h3 className="hub-full-group-label">{group.label}</h3>
            <span className={`hub-full-group-count${satisfied ? ' satisfied' : ''}`}>
              {groupFulfilled}/{groupTotal} units
            </span>
            <PotentialAddChip units={potentialAddByGroupId[group.id]} />
          </div>
          <span className="hub-full-group-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        </div>

        {!collapsed && (
          <div className="hub-full-requirements">
            {requirements.map(({ requirement, isSatisfied }) => {
              const { displayLabel, shortLabel } = describeRequirementLabels(requirement);
              const satisfiedCount = satisfiedCountForRequirement(requirement, counts);
              const needsMultiple = requirement.required > 1;
              // A staged course showing up on a requirement that's already
              // satisfied is just noise — it has nothing left to prove
              // there. Real course/credit contributors still show
              // regardless (that's what actually satisfied it).
              const contributors = contributorsForRequirement(requirement, contributorsByUnit).filter(
                (c) => c.type !== 'staged' || !isSatisfied,
              );
              // Satisfied, but not by completed courses alone.
              const planned = isSatisfied && !completedSatisfiedIds.has(requirement.id);

              return (
                <div key={requirement.id} className={`hub-full-requirement ${isSatisfied ? 'fulfilled' : 'pending'}${planned ? ' is-planned' : ''}`}>
                  <div className="hub-full-requirement-header">
                    <span className="hub-full-requirement-indicator" aria-hidden="true">
                      {isSatisfied ? '✓' : '○'}
                    </span>
                    <span className="hub-full-requirement-label">{displayLabel}</span>
                    {shortLabel && <span className="hub-full-requirement-detail">{shortLabel}</span>}
                    {needsMultiple && (
                      <span
                        className="hub-full-requirement-multi"
                        title={`Requires ${requirement.required} separate courses to fulfill`}
                      >
                        needs {requirement.required}
                      </span>
                    )}
                    <span className={`hub-full-requirement-count${isSatisfied ? ' satisfied' : ''}`}>
                      {satisfiedCount}/{requirement.required}{planned ? ' · planned' : ''}
                    </span>
                  </div>
                  <div className="hub-full-requirement-chips">
                    {contributors.length === 0 && (
                      <span className="hub-full-requirement-empty">No courses fulfilling this yet</span>
                    )}
                    {contributors.map((contributor, i) => {
                      if (contributor.type === 'course') {
                        return (
                          <CourseChip
                            key={`course-${contributor.courseKey}-${i}`}
                            courseKey={contributor.courseKey}
                            courseMap={courseMap}
                            interactive={false}
                            density="full"
                            lockStatus={lockStatusMap?.[contributor.courseKey]}
                          />
                        );
                      }
                      if (contributor.type === 'staged') {
                        // Not a real contributor — it's in the Paw-tential
                        // stash, not the plan, so it never counts toward
                        // isSatisfied above. Dashed border + STAGED badge
                        // (same visual grammar as the ring's dashed preview
                        // arc) makes that distinction obvious at a glance
                        // rather than requiring the student to notice it's
                        // sitting in a requirement that's still "pending".
                        return (
                          <span
                            key={`staged-${contributor.courseKey}-${i}`}
                            className="req-pool-chip claimed req-pool-chip--full req-pool-chip--staged"
                            title={`${formatCourseLabel(contributor.courseKey, courseMap, 'full')} — staged in your Paw-tential Courses, not yet added to your plan`}
                          >
                            <span className="req-pool-chip-check" aria-hidden="true">○</span>
                            <span className="req-pool-chip-text">
                              {formatCourseLabel(contributor.courseKey, courseMap, 'full')}
                            </span>
                            <span className="req-pool-chip-status">Paw-tential</span>
                          </span>
                        );
                      }
                      return (
                        <span
                          key={`credit-${i}`}
                          className="req-pool-chip claimed req-pool-chip--full req-pool-chip--completed"
                          title={contributor.label}
                        >
                          <span className="req-pool-chip-check" aria-hidden="true">✓</span>
                          <span className="req-pool-chip-text">{contributor.label}</span>
                          <span className="req-pool-chip-status">{contributor.creditType.toUpperCase()}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  // Collapsed (typically: completed) categories sort to the top, expanded
  // ones after — stable on original index within each group, so unrelated
  // cards don't jitter around when one toggle changes the sort. Since this
  // puts every collapsed category in one contiguous block up front,
  // segmentGroups' run-detection turns that block into a single shared
  // grid and leaves each expanded category as its own full-width row after
  // it.
  const cardOrder = groupSummaries
    .map((groupSummary, index) => ({ groupSummary, index }))
    .sort((a, b) => {
      const aRank = isCollapsed(a.groupSummary) ? 0 : 1;
      const bRank = isCollapsed(b.groupSummary) ? 0 : 1;
      return aRank !== bRank ? aRank - bRank : a.index - b.index;
    })
    .map(({ groupSummary }) => groupSummary);

  const segments = segmentGroups(cardOrder, isCollapsed);

  return (
    <div className="full-view" role="dialog" aria-modal="true" aria-label="HUB Tracker and Course Finder">
      <FullViewHeader
        title="HUB Tracker & Course Finder"
        view="hub"
        onSwitchView={onSwitchView}
        onClose={onClose}
        closeAriaLabel="Close HUB tracker and course finder"
      />
      <div className="full-view-body">
        <div className="full-view-inner">
          <HubYearToggle isTransfer={isTransfer} onToggleTransfer={onToggleTransfer} />

          {/* Search Classes + the staging rail share one row, capped to
              Search Classes' own height (align-items: stretch — the rail
              never grows taller than it, it scrolls internally instead via
              .hub-staging-rail-body's own overflow). HUB Categories below
              is a separate, full-width section entirely outside this row —
              it never shares a column with the rail, so nothing there can
              ever end up rendered underneath it (a fixed-position mobile
              rail previously could, when its height didn't match the
              actual scrollable content beneath it). */}
          {finderHintVisible && (
            <OneTimeHint onDismiss={dismissFinderHint} onSeen={markFinderSeen}>
              Pick the HUB units you need. We&apos;ll list courses that cover them.
            </OneTimeHint>
          )}

          <div className="hub-search-row">

          {/* Search Classes — ONE search over the shared course list: a
              department prefix (autocompleted from the real catalog) and
              HUB-code include/exclude are all facets of the same
              queryCourses call, not separate tools. Gap-fill just
              pre-populates the include chips from openRequirements. */}
          <div className="hub-browse-panel">
            <div className="hub-browse-header">
              <div className="hub-match-row">
                <span className="hub-full-overview-heading">Match:</span>
                <div className="hub-year-toggle-group hub-match-pill">
                  <button
                    type="button"
                    className={`hub-year-toggle-btn ${hubSearchMode === HUB_MATCH_MODES.OR ? 'active' : ''}`}
                    onClick={() => setHubSearchMode(HUB_MATCH_MODES.OR)}
                    aria-pressed={hubSearchMode === HUB_MATCH_MODES.OR}
                    title="Match courses carrying ANY of the included codes"
                  >
                    Any selected
                  </button>
                  <button
                    type="button"
                    className={`hub-year-toggle-btn ${hubSearchMode === HUB_MATCH_MODES.AND ? 'active' : ''}`}
                    onClick={() => setHubSearchMode(HUB_MATCH_MODES.AND)}
                    aria-pressed={hubSearchMode === HUB_MATCH_MODES.AND}
                    title="Match courses carrying ALL of the included codes"
                  >
                    All in one course
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="hub-gapfill-btn"
                onClick={applyGapFill}
                disabled={gapCodes.length === 0}
                title={
                  gapCodes.length === 0
                    ? 'No remaining gaps to fill'
                    : `Pre-fill with your ${gapCodes.length} remaining HUB code(s)`
                }
              >
                Gap-fill my remaining units
              </button>
            </div>
            <div className="hub-browse-search">
              <DepartmentPrefixAutocomplete
                value={searchPrefix}
                onChange={setSearchPrefix}
                allPrefixes={departmentPrefixes}
                loading={!coursesLoaded}
              />
            </div>

            <div className="hub-include-header">
              <span className="hub-full-overview-heading">Include</span>
              <span className="hub-include-actions">
                {/* Active excludes, removable, beside the link while the grid is closed. */}
                {!excludeOpen && hubSearchExclude.map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={`hub-chip hub-chip-${HUB_COLOR_FOR[code]?.groupId ?? 'def'} hub-exclude-chip`}
                    onClick={() => toggleExcludeCode(code)}
                    title={HUB_LABELS[code] ?? code}
                    aria-label={`Remove ${code} from excluded codes`}
                  >
                    × {code}
                  </button>
                ))}
                <button
                  type="button"
                  className={`hub-stash-link${excludeOpen ? ' is-open' : ''}`}
                  onClick={() => setExcludeOpen((open) => !open)}
                  aria-expanded={excludeOpen}
                >
                  Exclude{hubSearchExclude.length > 0 ? ` (${hubSearchExclude.length})` : ''}
                </button>
                {(hubSearchInclude.length > 0 || hubSearchExclude.length > 0) && (
                  <button type="button" className="hub-stash-link" onClick={clearCodeFilters}>
                    Clear
                  </button>
                )}
              </span>
            </div>
            <div className="hub-browse-code-picker">
              {ALL_HUB_CODES.map((code) => (
                <HubCodeChip
                  key={code}
                  code={code}
                  selected={hubSearchInclude.includes(code)}
                  onToggle={toggleIncludeCode}
                />
              ))}
            </div>

            {excludeOpen && (
              <>
                <div className="hub-include-header">
                  <span className="hub-full-overview-heading">Exclude</span>
                  <button
                    type="button"
                    className="hub-exclude-close"
                    onClick={() => setExcludeOpen(false)}
                    aria-label="Close Exclude"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <div className="hub-browse-code-picker">
                  {ALL_HUB_CODES.map((code) => (
                    <HubCodeChip
                      key={code}
                      code={code}
                      selected={hubSearchExclude.includes(code)}
                      onToggle={toggleExcludeCode}
                      exclude
                    />
                  ))}
                </div>
              </>
            )}

            {/* "N courses" left, the Spring chip right. Same size on and off
                (no ✓); the snapshot note lives in its tooltip. */}
            {(hasCurrentTermData || !coursesLoaded || (searchActive && coursesLoaded && !catalogLoaderVisible && searchResults.length > 0)) && (
              <div className="hub-browse-count-row">
                <p className="hub-browse-count">
                  {searchActive && coursesLoaded && !catalogLoaderVisible && searchResults.length > 0
                    && `${searchResults.length} course${searchResults.length === 1 ? '' : 's'}`}
                </p>
                {hasCurrentTermData && (
                  <button
                    type="button"
                    className={`hub-chip offered-filter-chip${offeredOnly ? ' is-on' : ''}`}
                    aria-pressed={offeredOnly}
                    title={`Only show courses offered in ${CURRENT_TERM_LABEL}. ${OFFERED_SNAPSHOT_NOTE}.`}
                    onClick={() => setOfferedOnly(!offeredOnly)}
                  >
                    {CURRENT_TERM_LABEL}
                  </button>
                )}
              </div>
            )}
            {searchActive && coursesLoaded && !catalogLoaderVisible && searchResults.length > 0 && (
              <>
                {/* Chip key, rendered with the same HubChip as the results. */}
                <p className="hub-chip-legend">
                  <HubChip unit="HUB" match />
                  {' '}Filled = matches your search ·{' '}
                  <HubChip unit="HUB" covered />
                  {' '}Faded = already covered ·{' '}
                  <HubChip unit="HUB" paw />
                  {' '}Paw = a Paw-tential course covers it
                </p>
              </>
            )}
            {searchActive && (
              <div className="hub-browse-results">
                {!coursesLoaded || catalogLoaderVisible ? (
                  <div className="search-loading hub-results-pending" role="status" aria-busy="true">
                    {catalogLoaderVisible ? (
                      <PawLoader size="small" label="Loading courses…" />
                    ) : (
                      <span className="hub-results-skeleton" aria-hidden="true"><span /><span /><span /></span>
                    )}
                  </div>
                ) : coursesFailed ? (
                  <div className="search-empty" role="alert">Couldn&apos;t load courses. Reload to try again.</div>
                ) : searchResults.length === 0 ? (
                  <div className="search-empty">
                    {hubSearchMode === HUB_MATCH_MODES.AND && hubSearchInclude.length >= 2
                      ? "No single course covers all of these. Try 'Any selected'."
                      : 'No courses match those filters (already-planned courses are left out)'}
                  </div>
                ) : (
                  <>
                    {resultRows}
                    {visibleCount < searchResults.length && (
                      <button type="button" className="hub-stash-link hub-show-more" onClick={showMoreResults}>
                        Show more
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Capped to Search Classes' height via the row's align-items:
              stretch — scrolls internally (.hub-staging-rail-body) rather
              than growing past it. Only rendered once something's staged. */}
          {stashedHubCourses.length > 0 && (
            <aside className="hub-staging-rail">
              <div className="hub-staging-rail-header">
                Your Paw-tential HUB Courses ({stashedHubCourses.length})
              </div>
              <p className="hub-staging-rail-note">
                Saved in your planner&apos;s Paw-tential Courses tab. Not on your plan yet.
              </p>
              {onShowStash && (
                <button type="button" className="hub-stash-link hub-staging-rail-link" onClick={onShowStash}>
                  View in planner →
                </button>
              )}
              <div className="hub-staging-rail-body">
                {stashedHubCourses.map((course) => (
                  <HubSearchResultRow
                    key={course.id}
                    course={course}
                    isStashed
                    onRemoveFromStash={onRemoveFromStash}
                  />
                ))}
              </div>
            </aside>
          )}

          </div>

          <EstimateNote
            prominent
            link={BU_LINKS.myBU}
            lead="This is a guide for your planning purposes. Please confirm HUB requirement completion on"
            label="MyBU"
          />

          <div className="hub-full-overview-toolbar">
            <span className="hub-full-overview-heading">
              HUB Categories{' '}
              <span role="status">
                {ringsLoaderVisible && <PawLoader size="small" hideLabel label="Loading your HUB progress" />}
              </span>
            </span>
            <button type="button" className="panel-open-full-btn" onClick={toggleAll}>
              {anyCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          </div>

          {/* Overview strip — one ring per category, spread across the full
              width. Each ring is a real toggle on the same collapse state
              the category's own card uses (not a separate "jump" flag) —
              toggles in place, no scrolling. Wraps to more rows on narrow
              viewports rather than scrolling horizontally. */}
          {potentialHintVisible && (
            <OneTimeHint onDismiss={dismissPotentialHint} onSeen={markPotentialSeen}>
              Paw +N = units your Paw-tential courses would add.
            </OneTimeHint>
          )}

          <div className={`hub-full-overview${ringsLoaderVisible ? ' paw-refreshing' : ''}`} aria-busy={ringsLoaderVisible || undefined}>
            {groupSummaries.map((groupSummary) => {
              const { group, percent, fulfilled, total } = groupSummary;
              const collapsed = isCollapsed(groupSummary);
              return (
                <button
                  key={group.id}
                  type="button"
                  className={`hub-full-overview-item hub-ring-${group.id}`}
                  onClick={() => toggleGroup(group.id, collapsed)}
                  aria-pressed={!collapsed}
                  aria-label={`${group.label} — ${percent}% complete, ${collapsed ? 'collapsed' : 'expanded'}. Toggle.`}
                >
                  <span className={`hub-ring-wrap hub-ring-${group.id}`} title={ringTitle(group.id, fulfilled)}>
                    <HubProgressRing
                      percent={percent}
                      fulfilled={fulfilled}
                      total={total}
                      completedPercent={completedPercentByGroupId[group.id]}
                      size={72}
                      strokeWidth={6}
                    />
                  </span>
                  <span className="hub-full-overview-label">{group.label}</span>
                  <PotentialAddChip units={potentialAddByGroupId[group.id]} />
                </button>
              );
            })}
          </div>
          {/* Swatches use the ring's own stroke classes, in a neutral gray. */}
          <p className="hub-ring-legend">
            <svg className="hub-ring-legend-swatch" width="16" height="6" aria-hidden="true">
              <line className="hub-ring-fill" x1="1" y1="3" x2="15" y2="3" strokeWidth="4" />
            </svg>
            Dark = done ·{' '}
            <svg className="hub-ring-legend-swatch" width="16" height="6" aria-hidden="true">
              <line className="hub-ring-planned" x1="1" y1="3" x2="15" y2="3" strokeWidth="4" />
            </svg>
            Light = planned
          </p>

          {hubBanner.celebrate && (
            <div className="panel-all-fulfilled">
              <p>{hubBanner.variant === 'covered' ? 'Your plan covers every HUB requirement!' : 'All HUB requirements fulfilled!'}</p>
              {hubBanner.variant === 'covered' && (
                <p className="panel-all-fulfilled-sub">
                  {hubBanner.plannedUnits} unit{hubBanner.plannedUnits === 1 ? '' : 's'} still to take
                </p>
              )}
            </div>
          )}

          <div className={`hub-full-groups${ringsLoaderVisible ? ' paw-refreshing' : ''}`} aria-busy={ringsLoaderVisible || undefined}>
            {segments.map((segment, i) =>
              segment.type === 'solo' ? (
                renderGroupCard(segment.item)
              ) : (
                <div key={`run-${i}`} className="hub-full-groups-row">
                  {segment.items.map((g) => renderGroupCard(g))}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
