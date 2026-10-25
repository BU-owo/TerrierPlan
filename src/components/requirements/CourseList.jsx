import { Fragment, useState } from 'react';
import RequirementCourseRow from './RequirementCourseRow';
import { OfferedFilterToggle } from '../planner/CourseTags';
import useCurrentTermCourseKeys from '../../hooks/useCurrentTermCourseKeys';
import { CURRENT_TERM_LABEL } from '../../utils/term';

const INITIAL_VISIBLE = 12;

// Every enumerated group of courses (pool entries, range include keys,
// catalog range lists) renders through this: a 2-column grid (1 on narrow
// screens) of RequirementCourseRow, all inline up to 12. Over 12: a filter
// (text + offered-this-term toggle), the first 12, and "Show more" for the rest — never an inner scroll box.
// `courses` are { id, ...catalog/courseMap data }. `subsetLabels`
// (courseKey -> label) marks courses that also count toward an atLeast
// subset.
export default function CourseList({
  courses,
  stashSet,
  onToggleStash,
  onShowCourseInfo,
  subsetLabels,
  emptyText,
  onRowClick,
  // An OR_EQUIVALENT / SUBSTITUTE_GROUP slot: with exactly two courses it
  // gets an "or" pill between them and an "Either one counts" caption.
  equivalent = false,
  // Every course here is inactive (nothing else to offer) — shown greyed
  // with a "Not offered recently" caption instead of an empty slot.
  dimmed = false,
  // courseKey -> pill text for alternates ("Substitute"); untagged = standard.
  optionTags,
  // Headed-box rows (see CoursePool): filter box and term chip at any length,
  // the chip greyed when nothing here is offered this term.
  alwaysShowControls = false,
}) {
  const pair = equivalent && courses.length === 2;
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  // Browsing filter only — these rows are never claimed ✓ rows.
  const [offeredOnly, setOfferedOnly] = useState(false);
  const currentTermKeys = useCurrentTermCourseKeys();
  const isOffered = (course) => course.inCurrentTerm || currentTermKeys?.has(course.id);
  const showFilter = alwaysShowControls || courses.length > INITIAL_VISIBLE;
  const chipDisabled = alwaysShowControls && !courses.some(isOffered);
  const showChip = alwaysShowControls || (courses.length > INITIAL_VISIBLE && currentTermKeys?.size > 0);
  const offeredFilterOn = offeredOnly && !chipDisabled;

  const filterLower = filter.trim().toLowerCase();
  const textFiltered = filterLower
    ? courses.filter((course) =>
      `${course.courseNumber ?? course.id} ${course.name ?? ''} ${course.id}`.toLowerCase().includes(filterLower))
    : courses;
  const filtered = offeredFilterOn
    ? textFiltered.filter(isOffered)
    : textFiltered;
  const visible = showAll || filterLower ? filtered : filtered.slice(0, INITIAL_VISIBLE);

  return (
    <div className="req-range-list">
      {showFilter && (
        <input
          type="text"
          className="req-pool-filter-input"
          placeholder={`Filter ${courses.length} courses…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {showChip && (
        <OfferedFilterToggle checked={offeredFilterOn} onChange={setOfferedOnly} disabled={chipDisabled} />
      )}
      {filtered.length === 0 && (filterLower || offeredFilterOn || emptyText) && (
        <div className="req-pool-filter-empty">
          {offeredFilterOn && textFiltered.length > 0
            ? <>None offered {CURRENT_TERM_LABEL} — turn off the filter to see all.</>
            : filterLower ? <>No courses match &ldquo;{filter}&rdquo;.</> : emptyText}
        </div>
      )}
      {dimmed && <span className="req-either-caption">Not offered recently</span>}
      {pair && <span className="req-either-caption">Either one counts</span>}
      <div className={`req-course-grid${pair ? ' req-course-grid--pair' : ''}`}>
        {visible.map((course, i) => (
          <Fragment key={course.id}>
            {pair && i === 1 && <span className="req-or-pill">or</span>}
            <RequirementCourseRow
              courseKey={course.id}
              course={course}
              isStashed={stashSet.has(course.id)}
              onToggleStash={onToggleStash}
              onShowCourseInfo={onShowCourseInfo}
              subsetLabel={subsetLabels?.get(course.id)}
              onRowClick={onRowClick}
              dimmed={dimmed}
              tag={optionTags?.[course.id]}
            />
          </Fragment>
        ))}
      </div>
      {!showAll && !filterLower && filtered.length > INITIAL_VISIBLE && (
        <button type="button" className="req-node-pool-toggle" onClick={() => setShowAll(true)}>
          Show more ({filtered.length - INITIAL_VISIBLE})
        </button>
      )}
    </div>
  );
}
