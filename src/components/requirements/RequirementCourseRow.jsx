import { useContext, useId } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { PawIcon } from '../planner/CourseSearch';
import { RequirementDragContext } from './requirementDrag';
import { HubUnitTags, MarineSemesterPill, OfferingBadge } from '../planner/CourseTags';
import useUpcomingSeasons from '../../hooks/useUpcomingSeasons';
import useCurrentTermCourseKeys from '../../hooks/useCurrentTermCourseKeys';
import { shortCourseCode } from './treeHelpers';

// The one row used for every selectable course in the requirements view
// (pool groups, range lists, sequence options): code, title (two lines then
// an ellipsis), then the HUB tags and badges on their own line, paw + (i)
// top right. `course` is the catalog/courseMap data, if
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
  // In-plan rows only, when the done-vs-planned split applies: 'completed'
  // (green ✓, the default look), 'current' (blue-gray •) or 'planned'
  // (dashed, hollow ○). null keeps the plain green in-plan row.
  planStatus = null,
  // Where a planned / in-progress course sits ("Fall 2026"): its "In plan ·
  // …" tag. Absent (Summer & Winter list, external credit) → "In plan".
  planSlotLabel,
  compact = false,
  // Long-unoffered course shown only because nothing else is left.
  dimmed = false,
  // Alternate-course pill ("Substitute"): row stays fully selectable, just softer.
  tag,
  // Filled by a petition (a substituted course): ✎ and a "Substituted" pill.
  // `replacesLabel` ("EC 201") names the required course it stands in for.
  substituted = false,
  replacesLabel,
  // Substitute from outside the catalog / plan (transfer, study abroad, ...):
  // free text shown in place of a course code and title.
  substituteLabel,
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

  const countOf = (...flags) => flags.filter(Boolean).length;

  // Label-only substitute (transfer, study abroad, ...): ✎, the free text, and
  // the "Substituted for" pill — no buttons.
  if (substituted && substituteLabel) {
    return (
      <div className="req-course-row is-substituted">
        <span className="req-course-row-check req-course-row-sub-mark" title="Substituted" aria-label="Substituted">✎</span>
        <div className="req-stacked-body">
          <span className="req-stacked-code is-wrap" title={substituteLabel}>{substituteLabel}</span>
          <div className="req-stacked-badges">
            <span className="req-course-row-pill">{replacesLabel ? `Substituted for ${replacesLabel}` : 'Substituted'}</span>
          </div>
        </div>
      </div>
    );
  }

  const showPaw = !substituted && !inPlan;
  const actionCount = countOf(showPaw, onShowCourseInfo);

  // The shared course-row anatomy (also MarineCourseRow, and the search/stash
  // cards in planner.css): line 1 the bold code, line 2 the title (two lines,
  // then an ellipsis; the full title on hover), line 3 every badge, wrapping
  // below the title so none squeezes it. A ✓ / ✎ state mark sits on the left;
  // the paw (save for later) and "i" sit top right.
  return (
    <div
      ref={canDrag ? setNodeRef : undefined}
      className={`req-course-row${isStashed ? ' is-stashed' : ''}${compact ? ' is-compact' : ''}${inPlan ? ' is-in-plan' : ''}${inPlan && planStatus ? ` is-plan-${planStatus}` : ''}${clickable ? ' is-clickable' : ''}${dimmed ? ' is-dimmed' : ''}${tag ? ' is-alt' : ''}${substituted ? ' is-substituted' : ''}${canDrag ? ' is-draggable' : ''}${isDragging ? ' is-dragging' : ''}`}
      onClick={clickable ? () => onRowClick(courseKey) : undefined}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
    >
      {substituted ? (
        <span
          className="req-course-row-check req-course-row-sub-mark"
          title={replacesLabel ? `Substituted for ${replacesLabel}` : 'Substituted'}
          aria-label="Substituted"
        >✎</span>
      ) : inPlan ? (
        <span className="req-course-row-check" title={statusLabel} aria-label={statusLabel}>
          {planStatus === 'current' ? '•' : planStatus === 'planned' ? '◉' : '✓'}
        </span>
      ) : null}
      <div className="req-stacked-body">
        <span className="req-stacked-code">{code}</span>
        {name && <span className="req-stacked-title" title={`${code} — ${name}`}>{name}</span>}
        <div className="req-stacked-badges">
          <MarineSemesterPill courseKey={courseKey} />
          {inPlan && planStatus === 'current' && <span className="req-course-row-pill is-in-progress">In progress</span>}
          {inPlan && (planStatus === 'planned' || planStatus === 'current') && (
            <span className="req-course-row-pill is-plan-term">{planSlotLabel ? `In plan · ${planSlotLabel}` : 'In plan'}</span>
          )}
          {substituted && (
            <span className="req-course-row-pill">{replacesLabel ? `Substituted for ${replacesLabel}` : 'Substituted'}</span>
          )}
          {tag && <span className="req-course-row-pill">{tag}</span>}
          {compact ? (
            <OfferingBadge inCurrentTerm={course?.inCurrentTerm ?? currentTermKeys?.has(courseKey)} />
          ) : (
            <>
              <HubUnitTags units={course?.hubUnits} />
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
        </div>
      </div>
      {actionCount > 0 && (
        <div className={`req-stacked-actions${actionCount > 2 ? ' is-three' : ''}`}>
          {showPaw && (
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
          {onShowCourseInfo && (
            <button
              type="button"
              className="search-result-info-btn"
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
      )}
    </div>
  );
}
