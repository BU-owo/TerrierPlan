import { useDroppable } from '@dnd-kit/core';
import CourseCard from './CourseCard';
import { SEMESTER_LABELS } from '../../utils/hubConstants';

export default function SemesterColumn({
  index,
  courses,
  courseMap,
  creditsMap,
  isActive,
  onColumnClick,
  onRemoveCourse,
  draggingId,
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `col-${index}` });

  const totalCredits = courses.reduce(
    (sum, key) => sum + (creditsMap[key] ?? 0),
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
        <span className="semester-name">{SEMESTER_LABELS[index]}</span>
        {courses.length > 0 && (
          <span className="semester-credits">{totalCredits || '—'} cr</span>
        )}
      </div>

      <div ref={setNodeRef} className="semester-courses">
        {courses.map((key) => (
          <CourseCard
            key={key}
            courseKey={key}
            data={courseMap[key]}
            credits={creditsMap[key]}
            isDragging={draggingId === key}
            onRemove={() => onRemoveCourse(key)}
          />
        ))}
        {courses.length === 0 && (
          <div className="semester-empty">
            {isActive ? 'Search and add a course ↗' : 'Drop courses here'}
          </div>
        )}
      </div>
    </div>
  );
}
