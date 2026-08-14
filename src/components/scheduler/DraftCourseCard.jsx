import SectionRow from './SectionRow';

export default function DraftCourseCard({
  courseKey,
  courseData,
  sections,
  loading,
  considering,
  conflictMap,
  onToggleSection,
  onRemoveCourse,
}) {
  const courseLabel = courseData?.courseNumber ?? courseKey;
  const consideringCount = considering.size;

  return (
    <div className="sched-draft-card">
      <div className="sched-draft-card-header">
        <div>
          <div className="sched-draft-card-code">{courseLabel}</div>
          <div className="sched-draft-card-name">{courseData?.name ?? '—'}</div>
        </div>
        <div className="sched-draft-card-header-right">
          {consideringCount === 0 ? (
            <span className="sched-draft-card-hint">Pick at least one section</span>
          ) : (
            <span className="sched-draft-card-hint">{consideringCount} in consideration</span>
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

      {!loading && sections.length > 0 && (
        <div className="sched-section-list">
          {sections.map((section) => (
            <SectionRow
              key={section.id}
              section={section}
              checked={considering.has(section.id)}
              conflicts={conflictMap[section.id]}
              onToggle={() => onToggleSection(section.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
