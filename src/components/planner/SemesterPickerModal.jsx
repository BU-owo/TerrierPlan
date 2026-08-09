import { SEMESTER_LABELS } from '../../utils/hubConstants';

// Shared "which semester?" fallback used anywhere a course can be added to
// the plan without an active/focused semester to target — keep this as the
// single add-flow picker rather than growing a second one per call site.
export default function SemesterPickerModal({ course, onPick, onClose }) {
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
          {SEMESTER_LABELS.map((label, i) => (
            <button
              key={i}
              className="search-picker-option"
              onClick={() => onPick(i)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
