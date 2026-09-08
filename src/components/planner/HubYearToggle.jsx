// The First-Year/Transfer requirement-table switch — extracted verbatim
// out of HubSidebar (same markup, same classes, same behavior) so
// HubFullView can render the exact same control instead of a rebuilt
// copy that could drift from it. HubSidebar's own rendering is unchanged;
// it just renders this component in place of the inline JSX it used to
// have.
export default function HubYearToggle({ isTransfer, onToggleTransfer }) {
  return (
    <div className="hub-year-toggle-group">
      <button
        className={`hub-year-toggle-btn ${!isTransfer ? 'active' : ''}`}
        onClick={() => onToggleTransfer(false)}
        title="Show first-year requirements"
      >
        First-Year
      </button>
      <button
        className={`hub-year-toggle-btn ${isTransfer ? 'active' : ''}`}
        onClick={() => onToggleTransfer(true)}
        title="Show transfer requirements"
      >
        Transfer
      </button>
    </div>
  );
}
