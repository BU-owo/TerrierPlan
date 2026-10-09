import { useEffect } from 'react';

// First-visit "how do you want to start?" card, shown by PlannerPage once, on
// an empty plan (replaces the old app-wide beta modal). Each button has a label
// and a one-line caption; every
// choice — and closing the card — is reported to the parent, which records
// that it was seen. onChoose gets 'transcript' | 'plan' | 'scratch'; "Skip for
// now" is the same as closing the card (onDismiss).
const CHOICES = [
  { id: 'transcript', label: 'Import my transcript', caption: 'Fills in your plan from your unofficial BU transcript.' },
  { id: 'plan', label: 'Import a plan', caption: 'Got a plan from a friend or advisor? Open it here.' },
  { id: 'scratch', label: 'Start from scratch', caption: 'Search courses and build it yourself.' },
];

export default function PickYourPath({ onChoose, onDismiss }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onDismiss();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="beta-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="path-card" role="dialog" aria-modal="true" aria-labelledby="path-card-title">
        <button type="button" className="path-card-close" onClick={onDismiss} aria-label="Close" title="Close">
          ×
        </button>
        <div className="path-card-plate">
          <img
            className="path-card-mascot"
            src="/RhettCheck.png"
            alt="Rhett the Boston terrier climbing over a giant red checkmark"
          />
        </div>
        <h2 id="path-card-title">Welcome to TerrierPlan!</h2>
        <div className="path-card-choices">
          {CHOICES.map((choice) => (
            <button key={choice.id} type="button" className="path-card-btn" onClick={() => onChoose(choice.id)}>
              <span className="path-card-btn-label">{choice.label}</span>
              <span className="path-card-btn-caption">{choice.caption}</span>
            </button>
          ))}
        </div>
        <button type="button" className="path-card-skip" onClick={onDismiss}>
          Skip for now
        </button>
        <p className="path-card-beta">Beta: things may be incomplete or change without warning.</p>
      </div>
    </div>
  );
}
