import { useState } from 'react';
import { describeSectionTime } from '../../utils/sectionTime';

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
export default function SectionRow({ section, checked, locked, conflicts, notes, filteredOut, onToggle, onToggleLock }) {
  const [conflictExpanded, setConflictExpanded] = useState(false);

  const instructorLabel = section.instructors?.length
    ? section.instructors.map((i) => `${i.first ? i.first[0] + '. ' : ''}${i.last}`.trim()).join(', ')
    : 'Staff';
  const seatsLabel = section.capEnrl != null ? `${section.totEnrl ?? 0}/${section.capEnrl} seats` : null;
  const isOpen = (section.enrlStat || '').toLowerCase() === 'open';
  const conflictCount = conflicts?.length ?? 0;
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
          aria-label={`Consider section ${section.classSection}`}
        />
        <div className="sched-section-row-info">
          <div className="sched-section-row-top">
            <span className="sched-section-label">Section {section.classSection}</span>
            <span className={`sched-enrl-badge ${isOpen ? 'is-open' : 'is-closed'}`}>
              {section.enrlStat || '—'}
            </span>
            {filteredOut && (
              <span className="sched-filtered-out-badge" title="Doesn't fit your time filter">Outside filter</span>
            )}
          </div>
          <div className="sched-section-row-details">
            <span>{describeSectionTime(section)}</span>
            {section.facilId && <span>{section.facilId}</span>}
            <span>{instructorLabel}</span>
            {section.mode && <span>{section.mode}</span>}
            {seatsLabel && <span>{seatsLabel}</span>}
            {section.credits != null && <span>{section.credits} cr</span>}
          </div>
          {notes && <div className="sched-section-row-notes">{notes}</div>}
        </div>
      </label>

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
