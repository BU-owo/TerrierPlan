import { useContext, useId } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { PawIcon } from '../planner/CourseSearch';
import { RequirementDragContext } from './requirementDrag';
import { HubUnitTags, OfferingBadge } from '../planner/CourseTags';
import useUpcomingSeasons from '../../hooks/useUpcomingSeasons';
import useCurrentTermCourseKeys from '../../hooks/useCurrentTermCourseKeys';
import { shortCourseCode } from './treeHelpers';

// The one row used for every selectable course in the requirements view
// (pool groups, range lists, sequence options): a single compact line of
// paw toggle + short code + title (ellipsized, full title on hover) + HUB
// tags + offering badge + (i). `course` is the catalog/courseMap data, if
// any. `inPlan` swaps the paw for a green ✓ and tints the row (claimed /
// in-plan courses); `statusLabel` ("Completed", "Planned", …) is its
// tooltip. `compact` (sequence cards) drops the HUB tags and shows only the
// offered-this-term badge. `subsetLabel` adds a small ✱ marker (full label on hover) for a
// course that also counts toward an atLeast subset.
//
// In the desktop sidebar (RequirementDragContext) a selectable row is also
// draggable onto a semester column — same data shape as a search result
// ({ from, courseKey, course }), handled by PlannerPage's handleDragEnd.
// The PointerSensor's distance threshold keeps a plain click a click.
export default function RequirementCourseRow({
  courseKey,
  course,
  isStashed = false,
  inPlan = false,
  onToggleStash,
  onShowCourseInfo,
  subsetLabel,
  // Whole-row click: add to Paw-tential Courses (never removes — the paw
  // does that). Not wired on in-plan rows.
  onRowClick,
  statusLabel = 'In your plan',
  compact = false,
  // Long-unoffered course shown only because nothing else is left.
  dimmed = false,
}) {
  const catalogSeasons = useUpcomingSeasons(courseKey);
  const currentTermKeys = useCurrentTermCourseKeys();
  const code = shortCourseCode(courseKey);
  const name = course?.name;
  const clickable = Boolean(onRowClick) && !inPlan;
  const canDrag = useContext(RequirementDragContext) && clickable;
  // Unique per row: the same course can appear in several requirement groups.
  const dragId = `req-${useId()}-${courseKey}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { from: 'requirements', courseKey, course },
    disabled: !canDrag,
  });

  return (
    <div
      ref={canDrag ? setNodeRef : undefined}
      className={`req-course-row${isStashed ? ' is-stashed' : ''}${compact ? ' is-compact' : ''}${inPlan ? ' is-in-plan' : ''}${clickable ? ' is-clickable' : ''}${dimmed ? ' is-dimmed' : ''}${canDrag ? ' is-draggable' : ''}${isDragging ? ' is-dragging' : ''}`}
      onClick={clickable ? () => onRowClick(courseKey) : undefined}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
    >
      {inPlan ? (
        <span className="req-course-row-check" title={statusLabel} aria-label={statusLabel}>✓</span>
      ) : (
        <button
          type="button"
          className={`search-result-stash-btn${isStashed ? ' is-stashed' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStash(courseKey);
          }}
          aria-label={isStashed ? `Remove ${code} from Paw-tential Courses` : `Save ${code} to Paw-tential Courses (saved for later, not on your plan)`}
          title={isStashed ? 'Remove from Paw-tential Courses' : 'Save to Paw-tential Courses (saved for later, not on your plan)'}
        >
          <PawIcon filled={isStashed} />
        </button>
      )}
      <span className="req-course-row-code">{code}</span>
      <span className="req-course-row-title" title={name ? `${code} — ${name}` : code}>{name ?? ''}</span>
      {/* display: contents normally (one line); narrow sidebar rows put
          this on a second line (planner.css). */}
      <span className="req-course-row-meta">
        {compact ? (
          <OfferingBadge inCurrentTerm={course?.inCurrentTerm ?? currentTermKeys?.has(courseKey)} />
        ) : (
          <>
            <span className="req-course-row-tags">
              <HubUnitTags units={course?.hubUnits} />
            </span>
            <OfferingBadge
              offeringPattern={course?.offeringPattern}
              upcomingSeasons={course?.upcomingSeasons ?? catalogSeasons}
              inCurrentTerm={course?.inCurrentTerm ?? currentTermKeys?.has(courseKey)}
            />
          </>
        )}
        {subsetLabel && (
          <span className="req-subset-marker" title={subsetLabel} aria-label={subsetLabel}>✱</span>
        )}
      </span>
      {onShowCourseInfo && (
        <button
          type="button"
          className="search-result-info-btn req-course-row-info"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onShowCourseInfo(courseKey);
          }}
          aria-label={`View details for ${code}`}
          title="Course details"
        >
          i
        </button>
      )}
    </div>
  );
}
