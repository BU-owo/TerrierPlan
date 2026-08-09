import { formatCourseLabel, describeLockStatus } from './treeHelpers';

// `density='compact'` (the sidebar tab) keeps the original behavior exactly:
// code-only chip, name in the title tooltip. `density='full'` shows the name
// inline and, for non-interactive (claimed) chips, a planned/completed
// distinction driven by lockStatus — see describeLockStatus.
export default function CourseChip({ courseKey, courseMap, interactive, onClick, density = 'compact', lockStatus }) {
  const data = courseMap[courseKey];
  const code = data?.courseNumber ?? courseKey;
  const display = formatCourseLabel(courseKey, courseMap, density);
  const title = density === 'compact' && data?.name ? `${code} — ${data.name}` : display;

  if (!interactive) {
    if (density === 'full') {
      const { variant, label } = describeLockStatus(lockStatus);
      return (
        <span className={`req-pool-chip claimed req-pool-chip--full req-pool-chip--${variant}`} title={title}>
          <span className="req-pool-chip-check" aria-hidden="true">{variant === 'planned' ? '○' : '✓'}</span>
          <span className="req-pool-chip-text">{display}</span>
          <span className="req-pool-chip-status">{label}</span>
        </span>
      );
    }
    return (
      <span className="req-pool-chip claimed" title={title}>
        {display}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`req-pool-chip eligible${density === 'full' ? ' req-pool-chip--full' : ''}`}
      title={`Add ${title}`}
      onClick={onClick}
    >
      {display}
    </button>
  );
}
