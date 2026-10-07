import { useState } from 'react';
import SectionNotes from './SectionNotes';
import { describeSectionTime, describeExamTime, describeMeeting, classMeetings, examMeetings } from '../../utils/sectionTime';

// One selectable section under a DraftCourseCard. Checkbox membership is
// the "in consideration" set for its course — multiple rows can be checked
// at once per course, which is the thing that was flagged as confusing
// before, so the checked state has its own visible fill/border treatment
// (not just a checkmark) and the row itself highlights when checked.
//
// Locking is a separate, stronger constraint than checking (see
// scheduleCombos.js) — a locked row's checkbox is forced checked+disabled
// (the lock already implies it's "in", and un-checking it while leaving the
// lock in place would be a confusing state to be in), and it gets its own
// pin/border treatment distinct from a plain checked row.
//
// `manual` (Manual mode): the checkbox means "placed on the grid" instead of
// "in consideration", and there's no lock — pins only steer generation.
export default function SectionRow({ section, checked, locked, conflicts, notes, filteredOut, onToggle, onToggleLock, manual = false }) {
  const [conflictExpanded, setConflictExpanded] = useState(false);

  const instructorLabel = section.instructors?.length
    ? section.instructors.map((i) => `${i.first ? i.first[0] + '. ' : ''}${i.last}`.trim()).join(', ')
    : 'Staff';
  const seatsLabel = section.capEnrl != null ? `${section.totEnrl ?? 0}/${section.capEnrl} seats` : null;
  const isOpen = (section.enrlStat || '').toLowerCase() === 'open';
  const conflictCount = conflicts?.length ?? 0;
  // Rooms per class meeting: one shared room reads as before; differing rooms
  // are shown next to each meeting's own time.
  const meetings = classMeetings(section);
  const rooms = [...new Set(meetings.map((m) => m.facilId).filter(Boolean))];
  const roomsDiffer = rooms.length > 1;
  const singleRoom = meetings.length === 0 ? section.facilId : rooms[0];
  const examTime = examMeetings(section).length > 0 ? describeExamTime(section) : '';
  const conflictFullText = conflictCount > 0 ? `Conflicts with ${conflicts.map((c) => c.label).join('; ')}` : '';

  return (
    <div
      className={[
        'sched-section-row',
        checked ? 'is-checked' : '',
        locked ? 'is-locked' : '',
        conflictCount > 0 ? 'has-conflict' : '',
        filteredOut ? 'is-filtered-out' : '',
      ].filter(Boolean).join(' ')}
    >
      <label className="sched-section-row-main">
        <input
          type="checkbox"
          checked={checked || locked}
          disabled={locked}
          onChange={onToggle}
          aria-label={manual ? `Place section ${section.classSection} on your schedule` : `Consider section ${section.classSection}`}
        />
        <div className="sched-section-row-info">
          <div className="sched-section-row-top">
            <span className="sched-section-label">Section {section.classSection}</span>
            <span className={`sched-enrl-badge ${isOpen ? 'is-open' : 'is-closed'}`}>
              {section.enrlStat || '—'}
            </span>
            {examTime && <span className="sched-exam-chip" title="This section has an exam block — it doesn't count as a time conflict">Exam block</span>}
            {filteredOut && (
              <span className="sched-filtered-out-badge" title="Doesn't fit your time filter">Outside filter</span>
            )}
          </div>
          <div className="sched-section-row-details">
            <span>
              {roomsDiffer
                ? meetings.map((m) => `${describeMeeting(m)}${m.facilId ? ` (${m.facilId})` : ''}`).join(' · ')
                : describeSectionTime(section)}
            </span>
            {!roomsDiffer && singleRoom && <span>{singleRoom}</span>}
            {examTime && <span>Exam: {examTime}</span>}
            <span>{instructorLabel}</span>
            {section.mode && <span>{section.mode}</span>}
            {seatsLabel && <span>{seatsLabel}</span>}
            {section.credits != null && <span>{section.credits} cr</span>}
          </div>
          {notes && <div className="sched-section-row-notes"><SectionNotes notes={notes} /></div>}
        </div>
      </label>

      {!manual && (
        <button
          type="button"
          className={`sched-lock-btn${locked ? ' is-locked' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
          aria-label={locked ? `Unlock section ${section.classSection}` : `Lock section ${section.classSection} into every generated schedule`}
          title={locked ? 'Locked into every generated schedule — click to unlock' : 'Lock this section into every generated schedule'}
        >
          {locked ? '📌' : '📍'}
        </button>
      )}

      {conflictCount > 0 && (
        <button
          type="button"
          className="sched-conflict-summary"
          onClick={() => setConflictExpanded((v) => !v)}
          title={conflictFullText}
          aria-expanded={conflictExpanded}
        >
          <span aria-hidden="true">⚠</span> Conflicts with {conflictCount} selected section{conflictCount === 1 ? '' : 's'}
          <span className="sched-conflict-summary-caret" aria-hidden="true">{conflictExpanded ? '▲' : '▼'}</span>
        </button>
      )}
      {conflictCount > 0 && conflictExpanded && (
        <ul className="sched-conflict-detail">
          {conflicts.map((c) => (
            <li key={c.sectionId}>{c.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
