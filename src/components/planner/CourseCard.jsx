import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { HUB_COLOR_FOR } from '../../utils/hubConstants';
import { getOfferingWarning } from '../../utils/offeringPattern';

export default function CourseCard({
  courseKey,
  data,
  credits,
  locked = false,
  season,
  onRemove,
  onToggleLock,
  isDragOverlay = false,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: courseKey,
    data: { from: 'board', courseKey },
    disabled: isDragOverlay || locked,
  });

  // 'notice' (alternating-pattern, placed in its usual season) is a soft
  // "worth double-checking" heads-up, so it can be dismissed per-card. Real
  // mismatches ('warning' — course likely isn't offered that term at all)
  // stay put regardless. Local-only and resets on remount (e.g. if the
  // course is moved to a different slot), which is fine — it's a low-stakes
  // UI nicety, not a persisted preference.
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const hubUnits = data?.hubUnits ?? [];
  const courseNumber = data?.courseNumber ?? courseKey;
  const courseName = data?.name ?? '—';
  const creditStr = credits != null ? `${credits} cr` : '—';
  // Historical offering data, not a guarantee — informational only, never
  // blocks placement or feeds into HUB/requirement logic.
  const offeringWarning = !isDragOverlay ? getOfferingWarning(data?.offeringPattern, season) : null;
  const showOfferingWarning = offeringWarning && !(offeringWarning.severity === 'notice' && noticeDismissed);

  const cardContent = (
    <>
      {!isDragOverlay && onToggleLock && (
        <button
          type="button"
          className={`course-card-lock${locked ? ' is-locked' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleLock}
          aria-label={locked ? `Unlock ${courseNumber}` : `Lock ${courseNumber}`}
          title={locked ? 'Locked — click to unlock' : 'Lock this course'}
          tabIndex={-1}
        >
          {locked ? '🔒' : '🔓'}
        </button>
      )}
      {!isDragOverlay && !locked && onRemove && (
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
      {showOfferingWarning && (
        <div
          className={`course-card-offering-warning is-${offeringWarning.severity}`}
          title={offeringWarning.text}
        >
          <span className="course-card-offering-warning-text">
            <span aria-hidden="true">⚠</span> {offeringWarning.shortLabel}
          </span>
          {offeringWarning.severity === 'notice' && (
            <button
              type="button"
              className="course-card-offering-warning-dismiss"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setNoticeDismissed(true); }}
              aria-label="Dismiss this heads-up"
              title="Dismiss"
            >
              ×
            </button>
          )}
        </div>
      )}
      <div className="course-card-footer">
        <span className="course-card-credits">{creditStr}</span>
        <div className="course-card-hubs">
          {hubUnits.slice(0, 3).map((unit) => {
            const colorInfo = HUB_COLOR_FOR[unit];
            const groupId = colorInfo?.groupId ?? 'def';
            return (
              <span
                key={unit}
                className={`hub-chip hub-chip-${groupId}`}
                style={colorInfo?.color ? { '--hub-color': colorInfo.color } : {}}
              >
                {unit}
              </span>
            );
          })}
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
      className={`course-card${isDragging ? ' is-source' : ''}${locked ? ' is-locked' : ''}`}
      {...(locked ? {} : { ...attributes, ...listeners })}
    >
      {cardContent}
    </div>
  );
}
