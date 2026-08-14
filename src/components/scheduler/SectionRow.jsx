import { describeSectionTime } from '../../utils/sectionTime';

// One selectable section under a DraftCourseCard. Checkbox membership is
// the "in consideration" set for its course — multiple rows can be checked
// at once per course, which is the thing that was flagged as confusing
// before, so the checked state has its own visible fill/border treatment
// (not just a checkmark) and the row itself highlights when checked.
export default function SectionRow({ section, checked, conflicts, onToggle }) {
  const instructorLabel = section.instructors?.length
    ? section.instructors.map((i) => `${i.first ? i.first[0] + '. ' : ''}${i.last}`.trim()).join(', ')
    : 'Staff';
  const seatsLabel = section.capEnrl != null ? `${section.totEnrl ?? 0}/${section.capEnrl} seats` : null;
  const isOpen = (section.enrlStat || '').toLowerCase() === 'open';

  return (
    <div className={`sched-section-row${checked ? ' is-checked' : ''}${conflicts?.length ? ' has-conflict' : ''}`}>
      <label className="sched-section-row-main">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Consider section ${section.classSection}`}
        />
        <div className="sched-section-row-info">
          <div className="sched-section-row-top">
            <span className="sched-section-label">Section {section.classSection}</span>
            {section.classType && <span className="sched-section-type-badge">{section.classType}</span>}
            <span className={`sched-enrl-badge ${isOpen ? 'is-open' : 'is-closed'}`}>
              {section.enrlStat || '—'}
            </span>
          </div>
          <div className="sched-section-row-details">
            <span>{describeSectionTime(section)}</span>
            {section.facilId && <span>{section.facilId}</span>}
            <span>{instructorLabel}</span>
            {section.mode && <span>{section.mode}</span>}
            {seatsLabel && <span>{seatsLabel}</span>}
            {section.credits != null && <span>{section.credits} cr</span>}
          </div>
        </div>
      </label>
      {conflicts?.length > 0 && (
        <div className="sched-conflict-note">
          <span aria-hidden="true">⚠</span> Conflicts with {conflicts.map((c) => c.label).join('; ')}
        </div>
      )}
    </div>
  );
}
