import { useContext, useState } from 'react';
import MarineCourseRow from './MarineCourseRow';
import { shortCourseCode } from './treeHelpers';
import { MarineSemesterContext } from '../planner/marineContext';
import { marinePoolRows } from '../../data/marineSemester';

const INITIAL_VISIBLE = 8;

// The browse list on the Marine Semester requirement card
// (`poolFrom: "marineSemester"`): the bulletin's Marine Semester courses from
// src/data/marineSemester.js, cross-listed twins as one row, each with an
// status line ("Offered Fall 2026" / "Not in the latest Fall list"), an
// explicit "+" that adds it to the plan's Marine Semester, and the same drag
// and click-to-stash behavior as any requirement row. Above it: how many
// slots the plan's Marine Semester still holds, or a button to add one.
export default function MarinePoolList({
  courseMap,
  planCourseKeySet,
  stashSet,
  onToggleStash,
  onShowCourseInfo,
  onRowClick,
}) {
  const marine = useContext(MarineSemesterContext);
  const [showAll, setShowAll] = useState(false);
  const rows = marinePoolRows();
  const visible = showAll ? rows : rows.slice(0, INITIAL_VISIBLE);

  return (
    <div className="req-pool marine-pool">
      {marine.hasTerm ? (
        <div className="req-course-grid">
          <div className="req-course-row is-in-plan">
            <span className="req-course-row-check" aria-hidden="true">✓</span>
            <span className="req-course-row-title is-wrap">
              {`${marine.slots} slot${marine.slots === 1 ? '' : 's'} in your Marine Semester`}
            </span>
          </div>
        </div>
      ) : (
        marine.onOpenCreatePicker && (
          <button type="button" className="marine-pool-create" onClick={marine.onOpenCreatePicker}>
            Add my Marine Semester to the plan
          </button>
        )
      )}
      <div className="req-course-grid">
        {visible.map(({ key, keys, offered }) => {
          const placedKey = keys.find((k) => planCourseKeySet.has(k));
          const showKey = placedKey ?? key;
          return (
            <MarineCourseRow
              key={key}
              courseKey={showKey}
              course={courseMap[showKey]}
              codeText={keys.map(shortCourseCode).join(' / ')}
              // A twin pair shows the primary's title (the other's if that one isn't loaded).
              title={courseMap[key]?.name ?? keys.map((k) => courseMap[k]?.name).find(Boolean)}
              inPlan={Boolean(placedKey)}
              isStashed={keys.some((k) => stashSet.has(k))}
              onToggleStash={onToggleStash}
              onShowCourseInfo={onShowCourseInfo}
              onRowClick={onRowClick}
              onAdd={marine.onAddCourse ?? undefined}
              offered={offered}
            />
          );
        })}
      </div>
      {rows.length > INITIAL_VISIBLE && (
        <button type="button" className="req-node-pool-toggle" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? 'Show fewer' : `Show all ${rows.length} courses`}
        </button>
      )}
    </div>
  );
}
