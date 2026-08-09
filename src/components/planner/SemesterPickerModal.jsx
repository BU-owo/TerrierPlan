// Shared "which semester?" fallback used anywhere a course can be added to
// the plan without an active/focused semester to target — keep this as the
// single add-flow picker rather than growing a second one per call site.
// `semesterOptions` is [{ value, label }], grid slots plus any toggled-on
// Summer slots — built once in PlannerPage and threaded down to every caller.
export default function SemesterPickerModal({ course, semesterOptions, onPick, onClose }) {
  if (!course) return null;

  return (
    <div className="search-picker-overlay" onClick={onClose}>
      <div className="search-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-picker-header">
          <h3>
            Add to semester:{' '}
            <span className="search-picker-course-code">
              {course.courseNumber ?? course.id}
            </span>
          </h3>
          <button
            className="search-picker-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="search-picker-options">
          {semesterOptions.map(({ value, label }) => (
            <button
              key={value}
              className="search-picker-option"
              onClick={() => onPick(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
