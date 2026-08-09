import { useState } from 'react';
import CourseChip from './CourseChip';

// Above this many entries, a full-density pool section gets a text filter
// instead of dumping every chip inline — e.g. BMB Electives' ~46-course
// COURSE_LIST is an unreadable wall otherwise. Compact (sidebar) density
// never filters, regardless of pool size — same behavior as before.
const LARGE_POOL_THRESHOLD = 12;

function courseMatchesFilter(key, courseMap, filterLower) {
  if (!filterLower) return true;
  const data = courseMap[key];
  const haystack = `${data?.courseNumber ?? key} ${data?.name ?? ''} ${key}`.toLowerCase();
  return haystack.includes(filterLower);
}

export default function CoursePool({
  claimed,
  eligible,
  ranges,
  courseMap,
  onAddCourse,
  onBrowseRange,
  density = 'compact',
  lockStatusMap,
}) {
  const [eligibleFilter, setEligibleFilter] = useState('');
  const [claimedFilter, setClaimedFilter] = useState('');

  if (claimed.length === 0 && eligible.length === 0 && ranges.length === 0) return null;

  const eligibleFilterable = density === 'full' && eligible.length > LARGE_POOL_THRESHOLD;
  const claimedFilterable = density === 'full' && claimed.length > LARGE_POOL_THRESHOLD;

  const eligibleLower = eligibleFilter.trim().toLowerCase();
  const visibleEligible = eligibleFilterable
    ? eligible.filter(({ key }) => courseMatchesFilter(key, courseMap, eligibleLower))
    : eligible;

  const claimedLower = claimedFilter.trim().toLowerCase();
  const visibleClaimed = claimedFilterable
    ? claimed.filter(({ key }) => courseMatchesFilter(key, courseMap, claimedLower))
    : claimed;

  return (
    <div className="req-pool">
      {(eligible.length > 0 || ranges.length > 0) && (
        <div className="req-pool-section">
          <span className="req-pool-section-label">Add:</span>
          {eligibleFilterable && (
            <input
              type="text"
              className="req-pool-filter-input"
              placeholder={`Filter ${eligible.length} courses…`}
              value={eligibleFilter}
              onChange={(e) => setEligibleFilter(e.target.value)}
            />
          )}
          <div className={eligibleFilterable ? 'req-pool-chips req-pool-chips--list' : 'req-pool-chips'}>
            {eligibleFilterable && visibleEligible.length === 0 && (
              <span className="req-pool-filter-empty">No courses match &ldquo;{eligibleFilter}&rdquo;.</span>
            )}
            {visibleEligible.map(({ key }) => (
              <CourseChip
                key={key}
                courseKey={key}
                courseMap={courseMap}
                density={density}
                interactive
                onClick={() => onAddCourse(key)}
              />
            ))}
            {ranges.map(({ range, label }) => (
              <button
                key={`${range.subject}-${range.min}-${range.max}`}
                type="button"
                className="req-pool-chip eligible"
                title={`Browse ${label} in Search`}
                onClick={() => onBrowseRange(range)}
              >
                Browse eligible courses →
              </button>
            ))}
          </div>
        </div>
      )}
      {claimed.length > 0 && (
        <div className="req-pool-section">
          <span className="req-pool-section-label">Fulfilled by:</span>
          {claimedFilterable && (
            <input
              type="text"
              className="req-pool-filter-input"
              placeholder={`Filter ${claimed.length} courses…`}
              value={claimedFilter}
              onChange={(e) => setClaimedFilter(e.target.value)}
            />
          )}
          <div className={claimedFilterable ? 'req-pool-chips req-pool-chips--list' : 'req-pool-chips'}>
            {claimedFilterable && visibleClaimed.length === 0 && (
              <span className="req-pool-filter-empty">No courses match &ldquo;{claimedFilter}&rdquo;.</span>
            )}
            {visibleClaimed.map(({ key }) => (
              <CourseChip
                key={key}
                courseKey={key}
                courseMap={courseMap}
                density={density}
                lockStatus={lockStatusMap?.[key]}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
