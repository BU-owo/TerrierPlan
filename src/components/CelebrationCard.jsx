import { useEffect, useRef } from 'react';
import './CelebrationCard.css';

// "You did it" card for a finished milestone (see useCelebration). Reuses the
// beta overlay as its scrim, like PickYourPath. Rhett sits on the card's
// bottom edge; the card clips him so his arms read as popping up from behind
// it. Closes on the button, Escape, or a backdrop click.
export default function CelebrationCard({ title, subtitle, note, buttonLabel = 'Nice!', onDismiss }) {
  const dismissRef = useRef(null);

  useEffect(() => {
    dismissRef.current?.focus();
  }, []);

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
      <div
        className="celebration-card"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-labelledby="celebration-card-title"
        aria-describedby="celebration-card-subtitle"
      >
        <h2 id="celebration-card-title">{title}</h2>
        <p id="celebration-card-subtitle" className="celebration-card-subtitle">{subtitle}</p>
        {note && <p className="celebration-card-note">{note}</p>}
        <button ref={dismissRef} type="button" className="beta-dismiss-btn" onClick={onDismiss}>
          {buttonLabel}
        </button>
        <img
          className="celebration-card-mascot"
          src="/RhettCelebrate.png"
          alt="Rhett the Boston terrier cheering in confetti"
        />
      </div>
    </div>
  );
}
