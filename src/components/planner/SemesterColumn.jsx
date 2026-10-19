import { useContext, useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import CourseCard from './CourseCard';
import NoteCard from './NoteCard';
import TermBlockCard from './TermBlockCard';
import { MarineSemesterContext } from './marineContext';
import {
  entryCourseKey, entriesNoteCredits, hasMisplacedMarker, isBlockEntry, isMarineTerm, isMarker, isMixedMarineTerm,
  isNoteEntry, isOnlyCourseOutsideMarine, isPlainNoteEntry,
} from '../../utils/courseEntry';

// A course card needs a courseKey; unknown kinds, notes with an unknown
// blockType and a keyless course object render as a read-only TermBlockCard.
const isCourseCardEntry = (entry) => entryCourseKey(entry) != null;

// Generic semester-shaped column — used both for the fixed Fall/Spring grid
// slots and for a year's optional Summer slot (see SemesterBoard). `dropId`
// is the dnd-kit droppable id so callers can use whatever id scheme fits
// their slot (`col-3` for grid slots, `col-summer-1` for a Summer slot).
export default function SemesterColumn({
  dropId,
  // This slot's target (a grid index, or `summer:{year}`) — the Marine
  // Semester rules and handlers are keyed by it.
  target,
  label,
  season,
  courses,
  courseMap,
  creditsMap,
  isActive,
  onColumnClick,
  onRemoveCourse,
  onToggleLock,
  onShowCourseInfo,
  onToggleSemesterLock,
  onRemoveColumn,
  // Free-text note placeholders (see isNoteEntry) — bound to this slot by
  // SemesterBoard; onAddNote returns the new note's id.
  onAddNote,
  onUpdateNote,
  onRemoveNote,
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
  // "All semesters" overview: compact header/cards.
  compact = false,
}) {
  const { isOver, setNodeRef } = useDroppable({ id: dropId });
  const marine = useContext(MarineSemesterContext);
  // A Marine Semester term is derived from its contents (courseEntry.js). Its
  // header gets a badge and a ⋯ menu; the "+ Add placeholder" row is hidden
  // (its placeholders are the course slots); mixed or misplaced cases get a
  // plain inline warning. Nothing is ever hidden, moved or removed for them.
  const isMarine = isMarineTerm(courses, target);
  const isMixed = isMixedMarineTerm(courses, target);
  const misplacedMarker = hasMisplacedMarker(courses, target);
  const hasMarineParts = courses.some((entry) => isMarker(entry) || (isMarine && isPlainNoteEntry(entry)));
  const warning = isMixed
    ? "This term also has courses that aren't Marine Semester courses. The Marine Semester fills the whole term."
    : misplacedMarker
      ? 'This term has a Marine Semester marker, but a Marine Semester only works in a Fall.'
      : null;
  // (A degraded marker — an old tab dropped its blockType — is hidden too once
  // the term is a Marine Semester; elsewhere it is just a placeholder.)
  const otherEntries = courses.filter((entry) => !(isMarker(entry) && (isBlockEntry(entry) || isMarine)));
  const showMarineMenu = (isMarine || misplacedMarker) && (marine.onMoveTerm || marine.onRemoveTerm);
  // The one open Marine popover: 'info' (the badge's "About the Marine
  // Semester") or 'menu' (the ⋯ menu); closes on Esc or a click elsewhere.
  const [panel, setPanel] = useState(null);
  const marineRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!panel) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !marineRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setPanel(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [panel]);
  // Id of a note this column just added, so it mounts in edit mode.
  const [newNoteId, setNewNoteId] = useState(null);

  // Notes have no lock, so the lock toggle and "all locked" check only look
  // at real course entries — a column holding only notes is never "locked".
  const courseEntries = courses.filter(isCourseCardEntry);
  const totalCredits = courseEntries.reduce(
    (sum, entry) => sum + (creditsMap[entryCourseKey(entry)] ?? 0),
    0,
  ) + entriesNoteCredits(courses);
  const allLocked = courseEntries.length > 0
    && courseEntries.every((entry) => completedCourseKeys.has(entryCourseKey(entry)));

  // Overview: the whole grid cell is the drop target (so the blank space
  // under a short semester still takes drops), and .semester-block draws
  // the visible box/rings filling that cell. Detailed keeps the course list
  // as the target, and .semester-block is display:contents.
  return (
    <div
      ref={compact ? setNodeRef : undefined}
      className={[
        'semester-column',
        isActive ? 'is-active' : '',
        isOver ? 'is-drag-over' : '',
        status === 'current' ? 'is-current' : '',
        compact ? 'is-compact' : '',
        season ? `is-${season}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onColumnClick}
    >
      <div className="semester-block">
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
          {(isMarine || misplacedMarker) && (
            <span className="semester-marine-wrap" ref={marineRef}>
              <button
                type="button"
                className={`semester-marine-badge${warning ? ' is-warn' : ''}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setPanel((open) => (open === 'info' ? null : 'info')); }}
                aria-haspopup="dialog"
                aria-expanded={panel === 'info'}
                title="About the Marine Semester"
              >
                <span className="semester-marine-badge-text">{compact ? 'Marine' : 'Marine Semester'}</span>
                {warning ? ' ⚠' : ''}
              </button>
              {panel === 'info' && (
                <div className="semester-marine-popover" role="dialog" aria-label="About the Marine Semester" onClick={(e) => e.stopPropagation()}>
                  <strong>About the Marine Semester</strong>
                  <p>BU places you in four month-long courses (16 credits).</p>
                  <p>Only Marine Semester courses, and research in lieu of one block course, can go in this term.</p>
                  <p>Requires admission to the Marine Semester.</p>
                  {warning && <p className="semester-marine-popover-warn">{warning}</p>}
                  {hasMarineParts && marine.onRemoveTerm && (
                    <button
                      type="button"
                      className="semester-marine-popover-link"
                      onClick={() => { setPanel(null); marine.onRemoveTerm(target); }}
                    >
                      Remove Marine Semester
                    </button>
                  )}
                </div>
              )}
            </span>
          )}
          {(courses.length > 0 || compact) && (
            <span className="semester-credits">{totalCredits || (compact ? 0 : '—')} cr</span>
          )}
          {showMarineMenu && (
            <span className="semester-marine-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="semester-marine-menu-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setPanel((open) => (open === 'menu' ? null : 'menu')); }}
                aria-label="Marine Semester options"
                aria-haspopup="menu"
                aria-expanded={panel === 'menu'}
                title="Marine Semester options"
              >
                ⋯
              </button>
              {panel === 'menu' && (
                <div className="semester-marine-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                  {isMarine && marine.onMoveTerm && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setPanel(null); marine.onMoveTerm(target); }}
                    >
                      Move to another Fall…
                    </button>
                  )}
                  {hasMarineParts && marine.onRemoveTerm && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setPanel(null); marine.onRemoveTerm(target); }}
                    >
                      Remove Marine Semester
                    </button>
                  )}
                </div>
              )}
            </span>
          )}
          {compact && onAddNote && !isMarine && (
            <button
              type="button"
              className="semester-add-note"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setNewNoteId(onAddNote()); }}
              title="Add a placeholder to this semester"
              aria-label="Add a placeholder to this semester"
            >
              +
            </button>
          )}
          {courseEntries.length > 0 && onToggleSemesterLock && (
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

      <div ref={compact ? undefined : setNodeRef} className="semester-courses">
        {warning && !compact && <p className="special-term-warning">{warning}</p>}
        {otherEntries.map((entry, index) => {
          if (isBlockEntry(entry)) {
            return <TermBlockCard key={entry.id} entry={entry} compact={compact} />;
          }
          if (isNoteEntry(entry)) {
            return (
              <NoteCard
                key={entry.id}
                note={entry}
                initiallyEditing={entry.id === newNoteId}
                compact={compact}
                onUpdate={(patch) => onUpdateNote(entry.id, patch)}
                onRemove={() => onRemoveNote(entry.id)}
              />
            );
          }
          if (!isCourseCardEntry(entry)) {
            return <TermBlockCard key={entry.id ?? `block-${index}`} entry={entry} compact={compact} />;
          }
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
              compact={compact}
              semesterLocked={allLocked}
              isDragging={draggingId === key}
              onRemove={locked ? undefined : () => onRemoveCourse(key)}
              onToggleLock={() => onToggleLock(key)}
              onShowInfo={onShowCourseInfo ? () => onShowCourseInfo(key) : undefined}
              marineWarning={isOnlyCourseOutsideMarine(key, courses, target)}
            />
          );
        })}
        {courses.length === 0 && (
          <div className="semester-empty">
            {compact ? 'Drop here' : isActive ? 'Search and add a course ↗' : 'Drop courses here'}
          </div>
        )}
        {/* Last row of the list (inside the droppable, so dropping onto it
            still lands in this column). */}
        {onAddNote && !compact && !isMarine && (
          <button
            type="button"
            className="add-placeholder-row"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setNewNoteId(onAddNote()); }}
            title="Add a placeholder to this semester"
            aria-label="Add a placeholder to this semester"
          >
            + Add placeholder
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
