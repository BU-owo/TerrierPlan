import { compareSectionsByTime } from '../../utils/sectionTime';
import SectionRow from './SectionRow';

// BU's PeopleSoft export only distinguishes sections by "Enrollment" vs
// "Non-Enroll" classType — internal jargon that doesn't mean anything to a
// student. Regrouping into labeled Lecture / Discussion-Lab buckets (with a
// header explaining the relationship) replaces that raw badge instead of
// showing it per-row. Anything with an unrecognized classType still shows
// up (never silently dropped) under its own group rather than being folded
// into one of these two and mislabeled.
const GROUPS = [
  {
    key: 'lecture',
    label: 'Lecture',
    hint: 'Pick the lecture section you plan to attend.',
    match: (s) => s.classType === 'Enrollment',
  },
  {
    key: 'discussion',
    label: 'Discussion / Lab',
    hint: "Tied to a lecture section above — check the lecture's notes for which one pairs with it.",
    match: (s) => s.classType === 'Non-Enroll',
  },
];

function groupSections(sections, sortMode) {
  const comparator = sortMode === 'time'
    ? compareSectionsByTime
    : (a, b) => (a.classSection || '').localeCompare(b.classSection || '');

  const groups = GROUPS.map((g) => ({ ...g, sections: [] }));
  const otherSections = [];
  for (const section of sections) {
    const group = groups.find((g) => g.match(section));
    (group ? group.sections : otherSections).push(section);
  }
  groups.forEach((g) => g.sections.sort(comparator));
  otherSections.sort(comparator);
  if (otherSections.length > 0) {
    groups.push({ key: 'other', label: 'Other', hint: null, sections: otherSections });
  }
  return groups.filter((g) => g.sections.length > 0);
}

export default function DraftCourseCard({
  courseKey,
  courseData,
  sections,
  loading,
  considering,
  lockedSectionId,
  conflictMap,
  sortMode,
  onToggleSection,
  onToggleLock,
  onSelectAll,
  onDeselectAll,
  onRemoveCourse,
}) {
  const courseLabel = courseData?.courseNumber ?? courseKey;
  const consideringCount = considering.size;
  const allSelected = sections.length > 0 && consideringCount >= sections.length;
  const groups = groupSections(sections, sortMode);

  return (
    <div className="sched-draft-card">
      <div className="sched-draft-card-header">
        <div>
          <div className="sched-draft-card-code">{courseLabel}</div>
          <div className="sched-draft-card-name">{courseData?.name ?? '—'}</div>
        </div>
        <div className="sched-draft-card-header-right">
          {lockedSectionId ? (
            <span className="sched-draft-card-hint is-locked">📌 Locked to a section</span>
          ) : consideringCount === 0 ? (
            <span className="sched-draft-card-hint">Pick at least one section</span>
          ) : (
            <span className="sched-draft-card-hint">{consideringCount} in consideration</span>
          )}
          {sections.length > 0 && (
            <button
              type="button"
              className="sched-select-all-btn"
              onClick={() => (allSelected ? onDeselectAll() : onSelectAll())}
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          )}
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
      </div>

      {loading && <div className="sched-draft-card-loading">Loading sections…</div>}

      {!loading && sections.length === 0 && (
        <div className="sched-draft-card-empty">No sections found for this term.</div>
      )}

      {!loading && groups.map((group) => (
        <div className="sched-section-group" key={group.key}>
          <div className="sched-section-group-header">
            <span className="sched-section-group-label">{group.label}</span>
            {group.hint && <span className="sched-section-group-hint">{group.hint}</span>}
          </div>
          <div className="sched-section-list">
            {group.sections.map((section) => (
              <SectionRow
                key={section.id}
                section={section}
                checked={considering.has(section.id)}
                locked={lockedSectionId === section.id}
                conflicts={conflictMap[section.id]}
                onToggle={() => onToggleSection(section.id)}
                onToggleLock={() => onToggleLock(section.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
