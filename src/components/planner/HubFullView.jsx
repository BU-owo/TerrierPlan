import { useEffect, useMemo, useRef, useState } from 'react';
import { describeRequirementLabels, HUB_COLOR_FOR } from '../../utils/hubConstants';
import { useHubProgress, contributorsForRequirement, satisfiedCountForRequirement } from '../../hooks/useHubProgress';
import { loadAllCourses, queryCourses, collectDepartmentPrefixes, HUB_MATCH_MODES } from '../../utils/courseQuery';
import { normalizeCourseKey } from '../../utils/courseKey';
import { entryCourseKey } from '../../utils/courseEntry';
import { formatCourseLabel } from '../requirements/treeHelpers';
import HubYearToggle from './HubYearToggle';
import CourseChip from '../requirements/CourseChip';
import { PawIcon } from './CourseSearch';

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
//
// `potentialPercent`, when given and higher than `percent`, draws a second
// arc covering just the EXTRA range from `percent` to `potentialPercent` —
// "if I added everything in my Paw-tential stash, here's how much further
// this ring would fill," without touching what `percent`/`fulfilled` mean.
// A first pass tried a faded (lower-opacity) full circle stacked under the
// real fill, but opacity alone read as basically invisible at the small
// 38px card-header size — a dashed stroke doesn't have that problem at any
// size, and it reuses the same "dashed = not real yet" language the staged
// requirement chips use, so the two reinforce each other instead of using
// two different visual vocabularies for the same idea.
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
// Draws only the [startPct, endPct] arc segment (not the whole circle), so
// the potential arc never has to rely on stacking/z-order to hide the part
// that overlaps the real fill — it simply doesn't cover that part at all.
function describeArcSegment(cx, cy, r, startPct, endPct) {
  const startAngle = (Math.min(100, Math.max(0, startPct)) / 100) * 360;
  const endAngle = (Math.min(100, Math.max(0, endPct)) / 100) * 360;
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function HubProgressRing({ percent, fulfilled, total, potentialPercent, size = 56, strokeWidth = 6 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  const label = `${fulfilled}/${total}`;
  const fontSize = Math.round(size * (label.length > 3 ? 0.18 : 0.24));
  const showPotential = potentialPercent != null && potentialPercent > percent;
  // An SVG elliptical-arc command can't represent a full 360° sweep — its
  // start and end points land on the exact same spot (0% and 100% are the
  // same point on the circle), which browsers render as nothing at all.
  // That's exactly what "only staged courses, nothing real yet" looks like
  // (percent=0, potentialPercent=100) — an empty category filled purely by
  // stash would silently show no ring at all. Falls back to a plain dashed
  // <circle> (no start/end ambiguity) whenever the requested span is a full
  // circle, instead of the degenerate <path>.
  const isFullPotentialCircle = showPotential && percent <= 0 && potentialPercent >= 100;
  // Dash length scales with strokeWidth so the texture reads as clearly
  // "dashed" on the small 38px card-header ring as it does on the large
  // 72px overview ring, rather than a fixed pixel dash looking chunky on
  // one and disappearing into a blur on the other.
  const dashPattern = `${(strokeWidth * 0.7).toFixed(1)} ${(strokeWidth * 0.6).toFixed(1)}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="hub-ring" aria-hidden="true">
      <circle className="hub-ring-track" cx={cx} cy={cy} r={radius} strokeWidth={strokeWidth} fill="none" />
      {showPotential && isFullPotentialCircle && (
        <circle
          className="hub-ring-potential"
          cx={cx}
          cy={cy}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={dashPattern}
        />
      )}
      {showPotential && !isFullPotentialCircle && (
        <path
          className="hub-ring-potential"
          d={describeArcSegment(cx, cy, radius, percent, potentialPercent)}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={dashPattern}
          strokeLinecap="round"
        />
      )}
      <circle
        className="hub-ring-fill"
        cx={cx}
        cy={cy}
        r={radius}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
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
    </svg>
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
function DepartmentPrefixAutocomplete({ value, onChange, allPrefixes }) {
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
// `shaded` dims the row's info block (still shows the HUB tags, just faded)
// — used for an already-stashed row in the search results list, so
// stashing something doesn't erase its detail, only visually deprioritizes
// it against courses not yet acted on. Not used in the staging section
// below (nothing there needs deprioritizing against anything else in the
// same list). `neededUnitCodes`, when given (the staging section passes
// gapCodes), styles each tag as still-needed (bold + ringed) or
// already-fulfilled (muted) instead of rendering every tag the same.
function HubSearchResultRow({ course, isStashed, onAddToStash, onRemoveFromStash, shaded = false, neededUnitCodes }) {
  const label = course.courseNumber ?? course.id;
  return (
    <div className="search-result-card" style={{ cursor: 'default' }}>
      <div className="search-result-info" style={shaded ? { opacity: 0.55 } : undefined}>
        <div className="search-result-code">{label}</div>
        <div className="search-result-name-row">
          <span className="search-result-name">{course.name ?? '—'}</span>
        </div>
        {course.hubUnits?.length > 0 && (
          <div className="search-result-hub">
            {course.hubUnits.map((unit) => {
              if (!neededUnitCodes) {
                return (
                  <span key={unit} className={`hub-chip hub-chip-${HUB_COLOR_FOR[unit]?.groupId ?? 'def'}`}>
                    {unit}
                  </span>
                );
              }
              const needed = neededUnitCodes.includes(unit);
              return (
                <span
                  key={unit}
                  className={`hub-chip hub-chip-${HUB_COLOR_FOR[unit]?.groupId ?? 'def'}`}
                  title={needed ? 'Still needed' : 'Already fulfilled'}
                  style={{
                    fontWeight: needed ? 800 : 700,
                    opacity: needed ? 1 : 0.4,
                    boxShadow: needed ? '0 0 0 1.5px currentColor' : 'none',
                  }}
                >
                  {unit}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <button
        type="button"
        className={`search-result-stash-btn${isStashed ? ' is-stashed' : ''}`}
        onClick={() => (isStashed ? onRemoveFromStash(course.id) : onAddToStash(course.id))}
        aria-label={isStashed ? `Remove ${label} from Paw-tential Courses` : `Add ${label} to Paw-tential Courses`}
        title={isStashed ? 'Remove from Paw-tential Courses' : 'Add to Paw-tential Courses'}
      >
        <PawIcon filled={isStashed} />
      </button>
    </div>
  );
}

// One toggleable HUB code in the gap-fill search's include/exclude pickers —
// the exact same `hub-chip hub-chip-<groupId>` styling/coloring used
// everywhere else in the app for a read-only HUB tag (search results,
// course cards, requirement chips), turned into a real toggle button rather
// than a new chip design: unselected chips dim down, a selected chip gets a
// ring in its own color via inline style. No new hub-chip CSS variant.
function HubCodeChip({ code, selected, onToggle }) {
  return (
    <button
      type="button"
      className={`hub-chip hub-chip-${HUB_COLOR_FOR[code]?.groupId ?? 'def'}`}
      onClick={() => onToggle(code)}
      aria-pressed={selected}
      style={{
        cursor: 'pointer',
        border: '1.5px solid currentColor',
        opacity: selected ? 1 : 0.4,
        boxShadow: selected ? '0 0 0 1.5px currentColor' : 'none',
      }}
    >
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
  stash = [],
  onAddToStash,
  onRemoveFromStash,
  onClose,
}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // stashCourseKeys adds staged-only entries to contributorsByUnit (see
  // useHubProgress) — they render in the same requirement rows as real
  // contributors below, but never affect counts/progress/fulfilled/
  // groupSummaries.satisfied, which stay computed from real courses only.
  const { groupSummaries, contributorsByUnit, counts, openRequirements, allFulfilled } = useHubProgress({
    semesters,
    extraCourseKeys,
    externalCredits,
    courseMap,
    isTransfer,
    stashCourseKeys: stash,
  });

  // "What if I added everything in my stash" preview — the exact same
  // useHubProgress computation, just with the stash folded into
  // extraCourseKeys, so the ring-fade logic below never has to duplicate
  // any counting/progress math of its own. Only groupSummaries (for each
  // ring's potentialPercent) is used from this second call.
  const extraCourseKeysWithStash = useMemo(
    () => [...extraCourseKeys, ...stash],
    [extraCourseKeys, stash],
  );
  const { groupSummaries: potentialGroupSummaries } = useHubProgress({
    semesters,
    extraCourseKeys: extraCourseKeysWithStash,
    externalCredits,
    courseMap,
    isTransfer,
  });
  const potentialPercentByGroupId = useMemo(
    () => Object.fromEntries(potentialGroupSummaries.map((g) => [g.group.id, g.percent])),
    [potentialGroupSummaries],
  );

  // Search panel state. Courses load once into memory via the shared cache
  // in courseQuery.js (loadAllCourses) — if CourseSearch has already loaded
  // them this session this resolves immediately from that same cached
  // promise instead of firing a second Firestore read.
  const [allCourses, setAllCourses] = useState([]);
  const [searchPrefix, setSearchPrefix] = useState('');
  const [hubSearchInclude, setHubSearchInclude] = useState([]);
  const [hubSearchExclude, setHubSearchExclude] = useState([]);
  const [hubSearchMode, setHubSearchMode] = useState(HUB_MATCH_MODES.OR);

  useEffect(() => {
    let cancelled = false;
    loadAllCourses().then((courses) => {
      if (!cancelled) setAllCourses(courses);
    }).catch((err) => {
      console.error('Failed to load courses for search:', err);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Every real department/school prefix in the loaded catalog (e.g. "CAS",
  // "CAS CH", "COM CO") — auto-populates the prefix input's datalist
  // instead of requiring the student to already know exact department
  // codes to type.
  const departmentPrefixes = useMemo(() => collectDepartmentPrefixes(allCourses), [allCourses]);

  // Same Set-membership exclusion collectPoolCourses uses in treeHelpers.js
  // (planCourseKeySet) — courses already on the plan have nothing left to
  // offer this search. Deliberately does NOT also drop stashed courses (an
  // earlier pass did): stashing one from search results used to make it
  // disappear entirely, which meant a student couldn't keep comparing it
  // against other options still in the list. It stays visible, just
  // rendered with its stash button already in the "stashed" state (see
  // stashSet/HubSearchResultRow below).
  const excludeKeys = useMemo(() => {
    const gridCourseKeys = semesters.flatMap((sem) => sem.map(entryCourseKey));
    return new Set([...gridCourseKeys, ...extraCourseKeys].filter(Boolean).map(normalizeCourseKey));
  }, [semesters, extraCourseKeys]);

  const stashSet = useMemo(() => new Set(stash), [stash]);

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

  function toggleIncludeCode(code) {
    setHubSearchInclude((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }
  function toggleExcludeCode(code) {
    setHubSearchExclude((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
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
  const searchResults = useMemo(() => {
    if (!searchActive) return [];
    return queryCourses(
      allCourses,
      { prefix: trimmedPrefix, hubUnitCodes: hubSearchInclude, mode: hubSearchMode, excludeUnitCodes: hubSearchExclude },
      excludeKeys,
    );
  }, [allCourses, trimmedPrefix, hubSearchInclude, hubSearchMode, hubSearchExclude, excludeKeys]);

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
          <span className={`hub-ring-wrap hub-ring-${group.id}`}>
            <HubProgressRing
              percent={percent}
              fulfilled={groupFulfilled}
              total={groupTotal}
              potentialPercent={potentialPercentByGroupId[group.id]}
              size={38}
              strokeWidth={4}
            />
          </span>
          <div className="hub-full-group-heading">
            <h3 className="hub-full-group-label">{group.label}</h3>
            <span className={`hub-full-group-count${satisfied ? ' satisfied' : ''}`}>
              {groupFulfilled}/{groupTotal} units
            </span>
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

              return (
                <div key={requirement.id} className={`hub-full-requirement ${isSatisfied ? 'fulfilled' : 'pending'}`}>
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
                      {satisfiedCount}/{requirement.required}
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
                            <span className="req-pool-chip-status">Staged</span>
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
    <div className="full-view" role="dialog" aria-modal="true" aria-label="HUB Tracker">
      <header className="full-view-header">
        <h2 className="full-view-title">HUB Tracker</h2>
        <button
          type="button"
          className="full-view-close"
          onClick={onClose}
          aria-label="Close full-screen HUB Tracker view"
        >
          × Close
        </button>
      </header>
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
          <div className="hub-search-row">

          {/* Search Classes — ONE search over the shared course list: a
              department prefix (autocompleted from the real catalog) and
              HUB-code include/exclude are all facets of the same
              queryCourses call, not separate tools. Gap-fill just
              pre-populates the include chips from openRequirements. */}
          <div className="hub-browse-panel">
            <div className="hub-browse-header">
              <span className="hub-full-overview-heading">Search Classes</span>
              <DepartmentPrefixAutocomplete
                value={searchPrefix}
                onChange={setSearchPrefix}
                allPrefixes={departmentPrefixes}
              />
              <button
                type="button"
                className="panel-open-full-btn"
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

            <div className="hub-year-toggle-group" style={{ margin: '10px 0' }}>
              <button
                type="button"
                className={`hub-year-toggle-btn ${hubSearchMode === HUB_MATCH_MODES.OR ? 'active' : ''}`}
                onClick={() => setHubSearchMode(HUB_MATCH_MODES.OR)}
                title="Match courses carrying ANY of the included codes"
              >
                OR (any)
              </button>
              <button
                type="button"
                className={`hub-year-toggle-btn ${hubSearchMode === HUB_MATCH_MODES.AND ? 'active' : ''}`}
                onClick={() => setHubSearchMode(HUB_MATCH_MODES.AND)}
                title="Match courses carrying ALL of the included codes"
              >
                AND (all)
              </button>
            </div>

            <div className="hub-browse-code-row">
              <span className="hub-full-overview-heading">Include</span>
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
            </div>
            <div className="hub-browse-code-row">
              <span className="hub-full-overview-heading">Exclude</span>
              <div className="hub-browse-code-picker">
                {ALL_HUB_CODES.map((code) => (
                  <HubCodeChip
                    key={code}
                    code={code}
                    selected={hubSearchExclude.includes(code)}
                    onToggle={toggleExcludeCode}
                  />
                ))}
              </div>
            </div>

            {searchActive && (
              <div className="hub-browse-results">
                {searchResults.length === 0 ? (
                  <div className="search-empty">
                    No courses match those filters (already-planned courses are left out)
                  </div>
                ) : (
                  searchResults.map((course) => {
                    const isStashed = stashSet.has(course.id);
                    return (
                      <HubSearchResultRow
                        key={course.id}
                        course={course}
                        isStashed={isStashed}
                        shaded={isStashed}
                        onAddToStash={onAddToStash}
                        onRemoveFromStash={onRemoveFromStash}
                      />
                    );
                  })
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
              <div className="hub-staging-rail-body">
                {stashedHubCourses.map((course) => (
                  <HubSearchResultRow
                    key={course.id}
                    course={course}
                    isStashed
                    onRemoveFromStash={onRemoveFromStash}
                    neededUnitCodes={gapCodes}
                  />
                ))}
              </div>
            </aside>
          )}

          </div>

          <div className="hub-full-overview-toolbar">
            <span className="hub-full-overview-heading">HUB Categories</span>
            <button type="button" className="panel-open-full-btn" onClick={toggleAll}>
              {anyCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          </div>

          {/* Overview strip — one ring per category, spread across the full
              width. Each ring is a real toggle on the same collapse state
              the category's own card uses (not a separate "jump" flag) —
              toggles in place, no scrolling. Wraps to more rows on narrow
              viewports rather than scrolling horizontally. */}
          <div className="hub-full-overview">
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
                  <span className={`hub-ring-wrap hub-ring-${group.id}`}>
                    <HubProgressRing
                      percent={percent}
                      fulfilled={fulfilled}
                      total={total}
                      potentialPercent={potentialPercentByGroupId[group.id]}
                      size={72}
                      strokeWidth={6}
                    />
                  </span>
                  <span className="hub-full-overview-label">{group.label}</span>
                </button>
              );
            })}
          </div>

          {allFulfilled && (
            <div className="panel-all-fulfilled">
              <p>All HUB requirements fulfilled!</p>
            </div>
          )}

          <div className="hub-full-groups">
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
