import { formatCourseLabel, describeLockStatus, shortCourseCode } from './treeHelpers';
import { PawIcon } from '../planner/CourseSearch';

// `density='compact'` (the sidebar tab) keeps the original behavior exactly:
// code-only chip, name in the title tooltip. `density='full'` shows the name
// inline and, for non-interactive (claimed) chips, a planned/current/
// completed distinction — see describeLockStatus. Interactive chips toggle
// the course in Paw-tential Courses (never the plan); `isStashed` fills the
// paw, same as the search results' stash button. `subsetLabel` marks a
// course that also counts toward an atLeast subset.
export default function CourseChip({ courseKey, courseMap, interactive, onClick, density = 'compact', lockStatus, isStashed = false, subsetLabel }) {
  const data = courseMap[courseKey];
  const code = data?.courseNumber ?? shortCourseCode(courseKey);
  const display = formatCourseLabel(courseKey, courseMap, density);
  const title = density === 'compact' && data?.name ? `${code} — ${data.name}` : display;

  if (!interactive) {
    if (density === 'full') {
      const { variant, label } = describeLockStatus(lockStatus);
      const checkIcon = variant === 'completed' ? '✓' : variant === 'current' ? '●' : '○';
      return (
        <span className={`req-pool-chip claimed req-pool-chip--full req-pool-chip--${variant}`} title={title}>
          <span className="req-pool-chip-check" aria-hidden="true">{checkIcon}</span>
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
      className={`req-pool-chip eligible req-pool-chip--stash${isStashed ? ' is-stashed' : ''}${density === 'full' ? ' req-pool-chip--full' : ''}`}
      title={`${title} — ${isStashed ? 'Remove from Paw-tential Courses' : 'Save to Paw-tential Courses (saved for later, not on your plan)'}`}
      aria-pressed={isStashed}
      onClick={onClick}
    >
      <PawIcon filled={isStashed} />
      <span className="req-pool-chip-text">{display}</span>
      {subsetLabel && <span className="req-pool-chip-status req-subset-badge">{subsetLabel}</span>}
    </button>
  );
}
