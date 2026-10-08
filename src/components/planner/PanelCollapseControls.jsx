// Shared collapse/expand controls for the planner's two side panels, so the
// Search panel (left) and the HUB/Requirements panel (right) look and behave
// the same. `side` is which edge the panel sits on; the chevron points toward
// that edge when collapsing and away from it when expanding. `name` is the
// lowercase noun used in the tooltip ("search" -> "Collapse search").
function chevron(side, collapsing) {
  const towardLeft = (side === 'left') === collapsing;
  return towardLeft ? '‹' : '›';
}

export function PanelCollapseButton({ side, name, onClick }) {
  const label = `Collapse ${name}`;
  return (
    <button
      type="button"
      className="planner-panel-btn"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded="true"
    >
      {chevron(side, true)}
    </button>
  );
}

// The thin strip a collapsed panel shrinks to: the expand button plus a
// vertical label saying what's in there.
export function PanelRail({ side, name, text, onExpand }) {
  const label = `Expand ${name}`;
  return (
    <div className="planner-rail">
      <button
        type="button"
        className="planner-panel-btn"
        onClick={onExpand}
        title={label}
        aria-label={label}
        aria-expanded="false"
      >
        {chevron(side, false)}
      </button>
      <span className="planner-rail-label">{text}</span>
    </div>
  );
}
