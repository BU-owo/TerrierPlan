import { HUB_GROUPS, HUB_LABELS, HUB_REQUIRED } from '../../utils/hubConstants';

export default function HubSidebar({ semesters, courseMap }) {
  // Count how many courses in the plan satisfy each HUB unit
  const counts = {};
  for (const sem of semesters) {
    for (const key of sem) {
      for (const unit of courseMap[key]?.hubUnits ?? []) {
        counts[unit] = (counts[unit] ?? 0) + 1;
      }
    }
  }

  const allUnits = HUB_GROUPS.flatMap((g) => g.units);
  const totalUnits = allUnits.length;
  const fulfilledUnits = allUnits.filter(
    (u) => (counts[u] ?? 0) >= (HUB_REQUIRED[u] ?? 1),
  ).length;
  const allFulfilled = fulfilledUnits === totalUnits;

  return (
    <div className="hub-sidebar">
      <div className="hub-sidebar-header">
        <h2>BU Hub</h2>
        <span className="hub-sidebar-totals">
          {fulfilledUnits}/{totalUnits}
        </span>
      </div>

      {allFulfilled && (
        <div className="hub-all-fulfilled">
          <div className="hub-all-fulfilled-icon">🎉</div>
          <p>All HUB units fulfilled!</p>
        </div>
      )}

      {HUB_GROUPS.map((group) => (
        <div key={group.label} className="hub-group">
          <div className="hub-group-label">{group.label}</div>
          {group.units.map((unit) => {
            const required = HUB_REQUIRED[unit] ?? 1;
            const have = counts[unit] ?? 0;
            const status =
              have >= required
                ? 'fulfilled'
                : have > 0
                  ? 'partial'
                  : 'needed';
            return (
              <div key={unit} className={`hub-unit-row ${status}`}>
                <div className={`hub-unit-indicator ${status}`}>
                  {status === 'fulfilled' ? '✓' : null}
                </div>
                <span className="hub-unit-label" title={HUB_LABELS[unit]}>
                  {HUB_LABELS[unit]}
                </span>
                <span className={`hub-unit-count ${status}`}>
                  {have}/{required}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
