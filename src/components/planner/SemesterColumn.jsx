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
  season,
  courses,
  courseMap,
  creditsMap,
  isActive,
  onColumnClick,
  onRemoveCourse,
  onToggleLock,
  onToggleSemesterLock,
  onRemoveColumn,
  draggingId,
  // 'past' | 'current' | 'upcoming' | null — this slot's relation to the
  // student-designated current semester (see getSemesterStatus). Purely
  // informational (the "Current"/"Completed" badge below) — locking itself
  // always runs through completedCourseKeys, same as the per-card lock
  // button, so a semester is never more than a set of individually-lockable
  // cards.
  status = null,
  // Set<courseKey> — the student's global "completed" list (see
  // PlannerPage/SemesterBoard); this is what actually drives each card's
  // locked state, not anything stored on the entry itself.
  completedCourseKeys,
}) {
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  const totalCredits = courses.reduce(
    (sum, entry) => sum + (creditsMap[entryCourseKey(entry)] ?? 0),
    0,
  );
  const allLocked = courses.length > 0
    && courses.every((entry) => completedCourseKeys.has(entryCourseKey(entry)));

  return (
    <div
      className={[
        'semester-column',
        isActive ? 'is-active' : '',
        isOver ? 'is-drag-over' : '',
        status === 'current' ? 'is-current' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onColumnClick}
    >
      <div className="semester-header">
        <span className="semester-name">{label}</span>
        <div className="semester-header-right">
          {status === 'current' && (
            <span
              className="semester-status-badge is-current"
              title="Your current semester"
            >
              Current
            </span>
          )}
          {status === 'past' && (
            <span
              className="semester-status-badge is-past"
              title="Marked as completed"
            >
              Completed
            </span>
          )}
          {courses.length > 0 && (
            <span className="semester-credits">{totalCredits || '—'} cr</span>
          )}
          {courses.length > 0 && onToggleSemesterLock && (
            <button
              type="button"
              className={`semester-lock-toggle${allLocked ? ' is-locked' : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleSemesterLock(); }}
              aria-label={allLocked ? `Unlock all courses in ${label}` : `Lock all courses in ${label}`}
              title={allLocked ? 'Unlock all courses in this semester' : 'Lock all courses in this semester'}
            >
              {allLocked ? '🔒' : '🔓'}
            </button>
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
          const locked = completedCourseKeys.has(key);
          return (
            <CourseCard
              key={key}
              courseKey={key}
              data={courseMap[key]}
              credits={creditsMap[key]}
              locked={locked}
              season={season}
              isDragging={draggingId === key}
              onRemove={locked ? undefined : () => onRemoveCourse(key)}
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
