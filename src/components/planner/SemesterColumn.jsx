import { useDroppable } from '@dnd-kit/core';
import CourseCard from './CourseCard';
import { entryCourseKey } from '../../utils/courseEntry';

// Generic semester-shaped column — used both for the fixed Fall/Spring grid
// slots and for a year's optional Summer slot (see SemesterBoard). `dropId`
// is the dnd-kit droppable id so callers can use whatever id scheme fits
// their slot (`col-3` for grid slots, `col-summer-1` for a Summer slot).
export default function SemesterColumn({
  dropId,
  label,
  courses,
  courseMap,
  creditsMap,
  isActive,
  onColumnClick,
  onRemoveCourse,
  onToggleLock,
  onRemoveColumn,
  draggingId,
}) {
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  const totalCredits = courses.reduce(
    (sum, entry) => sum + (creditsMap[entryCourseKey(entry)] ?? 0),
    0,
  );

  return (
    <div
      className={[
        'semester-column',
        isActive ? 'is-active' : '',
        isOver ? 'is-drag-over' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onColumnClick}
    >
      <div className="semester-header">
        <span className="semester-name">{label}</span>
        <div className="semester-header-right">
          {courses.length > 0 && (
            <span className="semester-credits">{totalCredits || '—'} cr</span>
          )}
          {onRemoveColumn && (
            <button
              type="button"
              className="semester-column-remove"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onRemoveColumn(); }}
              aria-label={`Remove ${label} term`}
              title={`Remove ${label} term`}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div ref={setNodeRef} className="semester-courses">
        {courses.map((entry) => {
          const key = entryCourseKey(entry);
          return (
            <CourseCard
              key={key}
              courseKey={key}
              data={courseMap[key]}
              credits={creditsMap[key]}
              locked={entry.locked}
              isDragging={draggingId === key}
              onRemove={entry.locked ? undefined : () => onRemoveCourse(key)}
              onToggleLock={() => onToggleLock(key)}
            />
          );
        })}
        {courses.length === 0 && (
          <div className="semester-empty">
            {isActive ? 'Search and add a course ↗' : 'Drop courses here'}
          </div>
        )}
      </div>
    </div>
  );
}
