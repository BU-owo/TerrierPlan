// One dismissible note under the draft toolbar when so many sections are
// selected that generation may be slow or stop early. The link opens the Global
// Time Filter, the quickest way to narrow things down.
export default function LargeSelectionBanner({ onOpenFilter, onDismiss }) {
  return (
    <div className="sched-large-selection-banner" role="status">
      <span>
        Lots of sections selected, so generation may be slow or stop early. Try the{' '}
        <button type="button" className="sched-large-selection-link" onClick={onOpenFilter}>
          Global Time Filter
        </button>{' '}
        to narrow it down.
      </span>
      <button type="button" className="sched-large-selection-dismiss" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
