import { useMemo, useState } from 'react';
import { loadAllCourses, isProfessionalCareer, isInactiveCourse } from '../../utils/courseQuery';
import PawLoader from '../PawLoader';
import useDelayedBusy from '../../hooks/useDelayedBusy';
import { parseCourseKey } from '../../utils/courseKey';
import { rangeMatchesSubject } from '../../utils/requirementsEngine';
import CourseList from './CourseList';

// subjectPrefix ranges ("any BU course", "any CAS course") can match thousands
// of courses: they show a search box first and at most this many rows.
const WIDE_RANGE_LIMIT = 12;

// Catalog courses grouped by subject, parsed once per loaded catalog and
// shared by every RangeCourseList: [{ course, number }] sorted by catalog
// number. Keyed by the catalog array itself (loadAllCourses returns the same
// array every time), so a new catalog load rebuilds it and nothing is stored
// twice. Matching uses parseCourseKey — the engine's own split — so a list
// never offers a course the engine wouldn't count.
const subjectIndexes = new WeakMap();
function getSubjectIndex(courses) {
  let index = subjectIndexes.get(courses);
  if (!index) {
    index = new Map();
    for (const course of courses) {
      const parsed = parseCourseKey(course.id);
      if (!parsed) continue;
      if (!index.has(parsed.subject)) index.set(parsed.subject, []);
      index.get(parsed.subject).push({ course, number: parsed.number });
    }
    for (const list of index.values()) list.sort((a, b) => a.number - b.number);
    subjectIndexes.set(courses, index);
  }
  return index;
}

// Inline list of catalog courses matching one COURSE_RANGE / _CAP entry
// ("Browse eligible courses", same in the sidebar and the full view). The
// catalog is the same shared static-file cache Search and HubFullView use
// (loadAllCourses), loaded only once the list is first expanded. Courses
// already in the plan are hidden; stashed ones stay, with a filled paw.
// Law/Dental/Medical are dropped. `label` replaces the toggle text (a labeled
// row in a headed box, see CoursePool); `children` render under the toggle.
export default function RangeCourseList({
  label,
  children,
  alwaysShowControls = false,
  range,
  planCourseKeySet,
  stashSet,
  onToggleStash,
  onShowCourseInfo,
  subsetLabels,
  onRowClick,
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  const [courses, setCourses] = useState([]);
  const loaderVisible = useDelayedBusy(status === 'loading');
  // Held on 'loading' while the paw finishes its minimum time on screen.
  const shownStatus = loaderVisible ? 'loading' : status;

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && status !== 'ready' && status !== 'loading') {
      setStatus('loading');
      loadAllCourses()
        .then((all) => {
          setCourses(all);
          setStatus('ready');
        })
        .catch((err) => {
          console.error('Failed to load courses for requirement range:', err);
          setStatus('error');
        });
    }
  }

  const matching = useMemo(() => {
    if (status !== 'ready') return [];
    const excludeSet = new Set(range.exclude || []);
    // `include` keys are listed above the browse list (see CoursePool).
    const includeSet = new Set(range.include || []);
    const index = getSubjectIndex(courses);
    // One subject: its list. A subjectPrefix range: every matching subject, A–Z.
    const candidates = range.subject
      ? (rangeMatchesSubject(range, range.subject) ? index.get(range.subject) || [] : [])
      : [...index.keys()].filter((subject) => rangeMatchesSubject(range, subject)).sort()
        .flatMap((subject) => index.get(subject));
    return candidates
      .filter(({ course, number }) =>
        number >= range.min
        && number <= range.max
        && !excludeSet.has(course.id)
        && !includeSet.has(course.id)
        && !planCourseKeySet.has(course.id)
        && !isProfessionalCareer(course.career))
      .map(({ course }) => course);
  }, [status, courses, range, planCourseKeySet]);

  // Inactive (long-unoffered) courses hide unless stashed; if that leaves
  // nothing, show them all greyed rather than an empty list.
  const activeOrStashed = matching.filter((course) => !isInactiveCourse(course) || stashSet.has(course.id));
  const allInactive = activeOrStashed.length === 0 && matching.length > 0;
  const pool = allInactive ? matching : activeOrStashed;

  // Wide (subjectPrefix) ranges: nothing listed until 2+ characters are typed,
  // then the first WIDE_RANGE_LIMIT matches.
  const wide = !range.subject;
  const queryLower = query.trim().toLowerCase();
  const queryMatches = wide && queryLower.length >= 2
    ? pool.filter((course) =>
      `${course.courseNumber ?? course.id} ${course.name ?? ''} ${course.id}`.toLowerCase().includes(queryLower))
    : [];
  const shown = wide ? queryMatches.slice(0, WIDE_RANGE_LIMIT) : pool;

  return (
    <>
      <button type="button" className={`req-node-pool-toggle${label ? ' req-node-pool-toggle--row' : ''}`} onClick={toggle} aria-expanded={expanded}>
        {label ?? 'Browse eligible courses'} {expanded ? '▾' : '▸'}
      </button>
      {children}
      {expanded && shownStatus === 'loading' && (
        <div className="search-loading" role="status" aria-busy="true">
          {loaderVisible && <PawLoader size="small" label="Loading courses…" />}
        </div>
      )}
      {expanded && shownStatus === 'error' && (
        <div className="req-pool-filter-empty">Couldn&apos;t load courses. Close and reopen to try again.</div>
      )}
      {expanded && shownStatus === 'ready' && wide && (
        <div className="req-range-list">
          <input
            type="text"
            className="req-pool-filter-input"
            placeholder={`Search ${pool.length.toLocaleString()} courses…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {queryLower.length < 2 && (
            <div className="req-pool-filter-empty">Type a course code or title to see matches.</div>
          )}
          {queryLower.length >= 2 && (
            <CourseList
              courses={shown}
              dimmed={allInactive}
              stashSet={stashSet}
              onToggleStash={onToggleStash}
              onShowCourseInfo={onShowCourseInfo}
              subsetLabels={subsetLabels}
              onRowClick={onRowClick}
              emptyText={<>No courses match &ldquo;{query}&rdquo;.</>}
            />
          )}
          {queryMatches.length > WIDE_RANGE_LIMIT && (
            <div className="req-pool-filter-empty">
              {queryMatches.length - WIDE_RANGE_LIMIT} more match. Keep typing to narrow it down.
            </div>
          )}
        </div>
      )}
      {expanded && shownStatus === 'ready' && !wide && (
        <CourseList
          courses={shown}
          dimmed={allInactive}
          stashSet={stashSet}
          onToggleStash={onToggleStash}
          onShowCourseInfo={onShowCourseInfo}
          subsetLabels={subsetLabels}
          onRowClick={onRowClick}
          emptyText="No other courses in this range."
          alwaysShowControls={alwaysShowControls}
        />
      )}
    </>
  );
}
