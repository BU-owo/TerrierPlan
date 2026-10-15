import { useMemo, useState } from 'react';
import { loadAllCourses, isProfessionalCareer, isInactiveCourse } from '../../utils/courseQuery';
import { parseCourseKey } from '../../utils/courseKey';
import CourseList from './CourseList';

// Inline list of catalog courses matching one COURSE_RANGE / _CAP entry
// (replaces the old "Browse eligible courses" jump to Search). The catalog
// is the same shared static-file cache Search and HubFullView use
// (loadAllCourses), loaded only once the list is first expanded. Matching
// uses parseCourseKey — the engine's own split — so the list never offers a
// course the engine wouldn't count. Courses already in the plan are hidden;
// stashed ones stay, with a filled paw. Law/Dental/Medical are dropped.
export default function RangeCourseList({
  range,
  planCourseKeySet,
  stashSet,
  onToggleStash,
  onShowCourseInfo,
  subsetLabels,
  onRowClick,
}) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  const [courses, setCourses] = useState([]);

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
    return courses
      .map((course) => ({ course, parsed: parseCourseKey(course.id) }))
      .filter(({ course, parsed }) =>
        parsed
        && parsed.subject === range.subject
        && parsed.number >= range.min
        && parsed.number <= range.max
        && !excludeSet.has(course.id)
        && !includeSet.has(course.id)
        && !planCourseKeySet.has(course.id)
        && !isProfessionalCareer(course.career))
      .sort((a, b) => a.parsed.number - b.parsed.number)
      .map(({ course }) => course);
  }, [status, courses, range, planCourseKeySet]);

  // Inactive (long-unoffered) courses hide unless stashed; if that leaves
  // nothing, show them all greyed rather than an empty list.
  const activeOrStashed = matching.filter((course) => !isInactiveCourse(course) || stashSet.has(course.id));
  const allInactive = activeOrStashed.length === 0 && matching.length > 0;
  const shown = allInactive ? matching : activeOrStashed;

  return (
    <>
      <button type="button" className="req-node-pool-toggle" onClick={toggle} aria-expanded={expanded}>
        Browse eligible courses {expanded ? '▾' : '▸'}
      </button>
      {expanded && status === 'loading' && <div className="search-loading" role="status">Loading courses…</div>}
      {expanded && status === 'error' && (
        <div className="req-pool-filter-empty">Couldn&apos;t load courses. Close and reopen to try again.</div>
      )}
      {expanded && status === 'ready' && (
        <CourseList
          courses={shown}
          dimmed={allInactive}
          stashSet={stashSet}
          onToggleStash={onToggleStash}
          onShowCourseInfo={onShowCourseInfo}
          subsetLabels={subsetLabels}
          onRowClick={onRowClick}
          emptyText="No other courses in this range."
        />
      )}
    </>
  );
}
