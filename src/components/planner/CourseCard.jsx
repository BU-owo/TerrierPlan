import { useState, useRef, useEffect, useContext } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { HUB_COLOR_FOR } from '../../utils/hubConstants';
import { getOfferingWarning } from '../../utils/offeringPattern';
import { isProfessionalCareer } from '../../utils/courseQuery';
import useUpcomingSeasons from '../../hooks/useUpcomingSeasons';
import useDelayedBusy from '../../hooks/useDelayedBusy';
import { formatCourseKey } from '../../utils/grsAlias';
import PawLoader from '../PawLoader';
import { CourseDataStatusContext } from './courseDataContext';

const MARINE_WARNING_TEXT = 'Marine Semester course: it is only offered in the fall, as part of the Marine Semester.';

export default function CourseCard({
  courseKey,
  data,
  credits,
  locked = false,
  season,
  onRemove,
  onToggleLock,
  onShowInfo,
  isDragOverlay = false,
  // "All semesters" overview: one-line card (code, name, credits); HUB units
  // are in the tooltip.
  compact = false,
  // Compact only: every course in this card's semester is locked.
  semesterLocked = false,
  // A Marine Semester course (ONLY) outside a Marine Semester term.
  marineWarning = false,
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

  // Compact cards open the info panel on click. The drag sensor only starts a
  // drag after 8px of movement, so a plain click still reaches onClick; this
  // flag just swallows the stray click some browsers fire after a drag ends.
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) {
      draggedRef.current = true;
      return undefined;
    }
    const t = setTimeout(() => { draggedRef.current = false; }, 80);
    return () => clearTimeout(t);
  }, [isDragging]);

  // No course doc yet: the formatted key, and in the name slot a small paw
  // while a lookup runs (only after a moment, see useDelayedBusy), or a quiet
  // "Details unavailable" once one came back without it. Neither shows a "—".
  const lookup = useContext(CourseDataStatusContext);
  const unavailable = !data && lookup.unavailable.has(courseKey);
  const loaderVisible = useDelayedBusy(!data && !unavailable && lookup.fetching);
  const pending = loaderVisible || (!data && !unavailable);

  const hubUnits = data?.hubUnits ?? [];
  const courseNumber = data?.courseNumber ?? formatCourseKey(courseKey);
  const courseName = data?.name ?? (unavailable ? 'Details unavailable' : '');
  const creditStr = credits != null ? `${credits} cr` : data ? '—' : '';
  const nameSlot = loaderVisible ? (
    <span role="status"><PawLoader size="small" hideLabel label={`Loading ${courseNumber}`} /></span>
  ) : pending ? null : courseName;
  const nameClass = `course-card-name${unavailable && !loaderVisible ? ' is-unavailable' : ''}`;
  // Historical offering data, not a guarantee — informational only, never
  // blocks placement or feeds into HUB/requirement logic.
  // A real upcoming section (cached catalog) overrides the history.
  const upcomingSeasons = useUpcomingSeasons(courseKey);
  const offeringWarning = !isDragOverlay ? getOfferingWarning(data?.offeringPattern, season, upcomingSeasons) : null;
  const showOfferingWarning = offeringWarning && !(offeringWarning.severity === 'notice' && noticeDismissed);

  if (compact && !isDragOverlay) {
    const tip = [
      [courseName || courseNumber, creditStr, hubUnits.length ? `HUB: ${hubUnits.join(', ')}` : null].filter(Boolean).join(' · '),
      data?.studyAbroad ? 'Study abroad' : null,
      offeringWarning?.text,
      marineWarning ? MARINE_WARNING_TEXT : null,
    ].filter(Boolean).join('\n');
    // A fully locked semester shows its lock in the header, so skip the
    // per-card one there; a card locked on its own keeps it.
    const showLock = onToggleLock && !(locked && semesterLocked);
    function openInfo() {
      if (draggedRef.current || !onShowInfo) return;
      onShowInfo();
    }
    return (
      <div
        ref={setNodeRef}
        className={`course-card is-compact${isDragging ? ' is-source' : ''}${locked ? ' is-locked' : ''}${onShowInfo ? ' has-info' : ''}`}
        title={tip}
        onClick={openInfo}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && e.key === 'Enter') { e.preventDefault(); openInfo(); }
        }}
        {...(locked ? { role: 'button', tabIndex: 0 } : { ...attributes, ...listeners })}
      >
        {showLock && (
          <button
            type="button"
            className={`course-card-lock${locked ? ' is-locked' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
            aria-label={locked ? `Unlock ${courseNumber}` : `Lock ${courseNumber}`}
            title={locked ? 'Locked — click to unlock' : 'Lock this course'}
          >
            {locked ? '🔒' : '🔓'}
          </button>
        )}
        {!locked && onRemove && (
          <button
            className="course-card-remove"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            aria-label={`Remove ${courseNumber}`}
          >
            ×
          </button>
        )}
        <span className="course-card-code">{courseNumber}</span>
        <span className={nameClass}>{nameSlot}</span>
        {offeringWarning && (
          <span
            className={`course-card-offering-warning is-${offeringWarning.severity} is-icon`}
            aria-label={offeringWarning.text}
          >
            <span aria-hidden="true">⚠</span>
          </span>
        )}
        {marineWarning && (
          <span className="course-card-offering-warning is-warning is-icon" aria-label={MARINE_WARNING_TEXT}>
            <span aria-hidden="true">⚠</span>
          </span>
        )}
        <span className="course-card-credits">{creditStr}</span>
      </div>
    );
  }

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
      <div className={nameClass}>{nameSlot}</div>
      {data?.studyAbroad && (
        <span className="offering-badge offering-badge-abroad course-card-abroad">Study abroad</span>
      )}
      {isProfessionalCareer(data?.career) && (
        <span className="offering-badge offering-badge-career course-card-career">{data.career}</span>
      )}
      {marineWarning && (
        <div className="course-card-offering-warning is-warning" title={MARINE_WARNING_TEXT}>
          <span className="course-card-offering-warning-text">
            <span aria-hidden="true">⚠</span> Marine Semester course
          </span>
        </div>
      )}
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
        {/* "i" sits next to the credits rather than in the corner: the corner
            already holds lock + remove, and the footer has the room for a
            tap-sized button. Same stopPropagation pattern as those buttons
            (and the search card's "i") so dragging and them are unaffected. */}
        <div className="course-card-footer-start">
          <span className="course-card-credits">{creditStr}</span>
          {!isDragOverlay && onShowInfo && (
            <button
              type="button"
              className="course-card-info-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onShowInfo();
              }}
              aria-label={`View details for ${courseNumber}`}
              title="Course details"
            >
              i
            </button>
          )}
        </div>
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
