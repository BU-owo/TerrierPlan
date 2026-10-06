import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import CourseCard from './CourseCard';
import NoteCard from './NoteCard';
import { entryCourseKey, entriesNoteCredits, isNoteEntry } from '../../utils/courseEntry';

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
  // Id of a note this column just added, so it mounts in edit mode.
  const [newNoteId, setNewNoteId] = useState(null);

  // Notes have no lock, so the lock toggle and "all locked" check only look
  // at real course entries — a column holding only notes is never "locked".
  const courseEntries = courses.filter((entry) => !isNoteEntry(entry));
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
          {(courses.length > 0 || compact) && (
            <span className="semester-credits">{totalCredits || (compact ? 0 : '—')} cr</span>
          )}
          {compact && onAddNote && (
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
        {courses.map((entry) => {
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
        {onAddNote && !compact && (
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
