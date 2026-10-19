import { useContext, useId } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { PawIcon } from '../planner/CourseSearch';
import { RequirementDragContext } from './requirementDrag';
import { fallOfferings } from '../../data/marineSemester';

// One course on the Marine Semester requirement card (MarinePoolList): the
// shared course-row anatomy (see RequirementCourseRow) — the code(s) in bold on
// the first line (never wrapping), the full title below it (two lines, then an
// ellipsis; the full title on hover), then ONE muted status line: a green dot
// with "Offered Fall 2026" or a grey dot with "Not in Fall 2026 list". The
// paw, "+" (add to the Marine Semester) and "i" sit top right. No "Marine
// Semester" or "Usually Fall" pill: every course on this card is a Marine
// Semester course taught in the fall. Click-to-stash and drag work as on any
// requirement row (same { from: 'requirements' } payload).
export default function MarineCourseRow({
  courseKey,
  codeText,
  title,
  offered,
  inPlan = false,
  statusLabel = 'In your plan',
  isStashed = false,
  onToggleStash,
  onShowCourseInfo,
  onRowClick,
  onAdd,
  course,
}) {
  const clickable = Boolean(onRowClick) && !inPlan;
  const canDrag = useContext(RequirementDragContext) && clickable;
  const dragId = `req-${useId()}-${courseKey}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { from: 'requirements', courseKey, course },
    disabled: !canDrag,
  });

  const showPaw = !inPlan;
  const showAdd = Boolean(onAdd) && !inPlan;
  const actionCount = [showPaw, showAdd, onShowCourseInfo].filter(Boolean).length;

  return (
    <div
      ref={canDrag ? setNodeRef : undefined}
      className={`req-course-row${isStashed ? ' is-stashed' : ''}${inPlan ? ' is-in-plan' : ''}${clickable ? ' is-clickable' : ''}${canDrag ? ' is-draggable' : ''}${isDragging ? ' is-dragging' : ''}`}
      onClick={clickable ? () => onRowClick(courseKey) : undefined}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
    >
      {inPlan && <span className="req-course-row-check" aria-label={statusLabel}>✓</span>}
      <div className="req-stacked-body">
        <span className="req-stacked-code">{codeText}</span>
        {title && <span className="req-stacked-title" title={`${codeText} — ${title}`}>{title}</span>}
        <div className="req-stacked-badges">
          <span className="req-stacked-status">
            <span className={`req-stacked-dot${offered ? ' is-offered' : ''}`} aria-hidden="true" />
            {offered ? `Offered Fall ${fallOfferings.year}` : `Not in Fall ${fallOfferings.year} list`}
          </span>
        </div>
      </div>
      {actionCount > 0 && (
        <div className={`req-stacked-actions${actionCount > 2 ? ' is-three' : ''}`}>
          {showPaw && (
            <button
              type="button"
              className={`search-result-stash-btn${isStashed ? ' is-stashed' : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleStash(courseKey); }}
              aria-label={isStashed ? `Remove ${codeText} from Paw-tential Courses` : `Save ${codeText} to Paw-tential Courses`}
            >
              <PawIcon filled={isStashed} />
            </button>
          )}
          {showAdd && (
            <button
              type="button"
              className="req-course-row-add"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onAdd(courseKey); }}
              aria-label={`Add ${codeText} to my Marine Semester`}
            >
              +
            </button>
          )}
          {onShowCourseInfo && (
            <button
              type="button"
              className="search-result-info-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onShowCourseInfo(courseKey); }}
              aria-label={`View details for ${codeText}`}
            >
              i
            </button>
          )}
        </div>
      )}
    </div>
  );
}
