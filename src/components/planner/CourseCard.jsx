import { useDraggable } from '@dnd-kit/core';
import { HUB_COLOR_FOR } from '../../utils/hubConstants';

export default function CourseCard({
  courseKey,
  data,
  credits,
  onRemove,
  isDragOverlay = false,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: courseKey,
    disabled: isDragOverlay,
  });

  const hubUnits = data?.hubUnits ?? [];
  const courseNumber = data?.courseNumber ?? courseKey;
  const courseName = data?.name ?? '—';
  const creditStr = credits != null ? `${credits} cr` : '—';

  const cardContent = (
    <>
      {!isDragOverlay && (
        <button
          className="course-card-remove"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label={`Remove ${courseNumber}`}
          tabIndex={-1}
        >
          ×
        </button>
      )}
      <div className="course-card-code">{courseNumber}</div>
      <div className="course-card-name">{courseName}</div>
      <div className="course-card-footer">
        <span className="course-card-credits">{creditStr}</span>
        <div className="course-card-hubs">
          {hubUnits.slice(0, 3).map((unit) => (
            <span
              key={unit}
              className={`hub-chip hub-chip-${HUB_COLOR_FOR[unit] ?? 'def'}`}
            >
              {unit}
            </span>
          ))}
          {hubUnits.length > 3 && (
            <span className="hub-chip hub-chip-more">+{hubUnits.length - 3}</span>
          )}
        </div>
      </div>
    </>
  );

  if (isDragOverlay) {
    return <div className="course-card is-overlay">{cardContent}</div>;
  }

  return (
    <div
      ref={setNodeRef}
      className={`course-card${isDragging ? ' is-source' : ''}`}
      {...attributes}
      {...listeners}
    >
      {cardContent}
    </div>
  );
}
