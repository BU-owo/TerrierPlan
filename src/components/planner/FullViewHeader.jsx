// Shared header for the full-screen overlays (RequirementsFullView,
// HubFullView): title, a Requirements | HUB switch (First-Year/Transfer
// toggle styling) that swaps overlays without closing, and a large Close
// button. It sits outside the overlay's scrolling body, so it stays visible
// while scrolling. Escape handling stays in each overlay.
const VIEWS = [
  { id: 'requirements', label: 'Requirements' },
  { id: 'hub', label: 'HUB' },
];

export default function FullViewHeader({ title, view, onSwitchView, onClose, closeAriaLabel }) {
  return (
    <header className="full-view-header">
      <h2 className="full-view-title">{title}</h2>
      {onSwitchView && (
        <div className="hub-year-toggle-group full-view-switch" role="group" aria-label="Switch view">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`hub-year-toggle-btn${view === id ? ' active' : ''}`}
              aria-pressed={view === id}
              onClick={() => {
                if (view !== id) onSwitchView(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="full-view-close" onClick={onClose} aria-label={closeAriaLabel}>
        Close
      </button>
    </header>
  );
}
