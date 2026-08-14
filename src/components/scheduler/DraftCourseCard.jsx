import { compareSectionsByTime } from '../../utils/sectionTime';
import { groupSectionsByComponent } from '../../utils/sectionComponents';
import SectionRow from './SectionRow';

function groupStatusLabel(considering, lockedIdsInGroup) {
  const consideringCount = considering.length;
  if (lockedIdsInGroup.length > 0) {
    return `📌 ${lockedIdsInGroup.length > 1 ? `${lockedIdsInGroup.length} locked` : 'Locked'}${
      consideringCount > 0 ? ` + ${consideringCount} more in consideration` : ''
    }`;
  }
  return consideringCount === 0 ? 'Pick at least one section' : `${consideringCount} in consideration`;
}

export default function DraftCourseCard({
  courseKey,
  courseData,
  sections,
  loading,
  considering,
  lockedIds,
  conflictMap,
  sortMode,
  onToggleSection,
  onToggleLock,
  onSelectAll,
  onDeselectAll,
  onRemoveCourse,
}) {
  const courseLabel = courseData?.courseNumber ?? courseKey;
  const comparator = sortMode === 'time'
    ? compareSectionsByTime
    : (a, b) => (a.classSection || '').localeCompare(b.classSection || '');
  const groups = groupSectionsByComponent(sections, comparator);

  return (
    <div className="sched-draft-card">
      <div className="sched-draft-card-header">
        <div>
          <div className="sched-draft-card-code">{courseLabel}</div>
          <div className="sched-draft-card-name">{courseData?.name ?? '—'}</div>
        </div>
        <button
          type="button"
          className="sched-remove-course-btn"
          onClick={onRemoveCourse}
          aria-label={`Remove ${courseLabel} from schedule draft`}
          title="Remove course"
        >
          ×
        </button>
      </div>

      {loading && <div className="sched-draft-card-loading">Loading sections…</div>}

      {!loading && sections.length === 0 && (
        <div className="sched-draft-card-empty">No sections found for this term.</div>
      )}

      {!loading && groups.map((group) => {
        const groupConsidering = considering[group.key] || [];
        const groupLockedIds = group.sections
          .map((s) => s.id)
          .filter((id) => lockedIds.has(id));
        const allSelected = group.sections.length > 0 && groupConsidering.length + groupLockedIds.length >= group.sections.length;

        return (
          <div className="sched-section-group" key={group.key}>
            <div className="sched-section-group-header">
              <span className="sched-section-group-label">{group.label}</span>
              <span className={`sched-section-group-hint${group.commonNotes ? ' is-notes' : ''}`}>
                {group.commonNotes || group.hint}
              </span>
              <span className={`sched-draft-card-hint${groupLockedIds.length > 0 ? ' is-locked' : ''}`}>
                {groupStatusLabel(groupConsidering, groupLockedIds)}
              </span>
              <button
                type="button"
                className="sched-select-all-btn"
                onClick={() => (allSelected ? onDeselectAll(group.key) : onSelectAll(group.key))}
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="sched-section-list">
              {group.sections.map((section) => (
                <SectionRow
                  key={section.id}
                  section={section}
                  checked={groupConsidering.includes(section.id)}
                  locked={lockedIds.has(section.id)}
                  conflicts={conflictMap[section.id]}
                  notes={!group.commonNotes ? section.notes : null}
                  onToggle={() => onToggleSection(group.key, section.id)}
                  onToggleLock={() => onToggleLock(group.key, section.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
