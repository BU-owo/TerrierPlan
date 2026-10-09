import { useEffect, useRef } from 'react';

// One-line, dismissible hint that sits in the page flow (never floats over
// the board, the grid or the mobile tab bar). Pair with useOneTimeHint.
// `onSeen` fires once, the first time the hint is actually on screen (not
// merely mounted inside a hidden mobile tab). Optional `action`
// ({ label, onClick }) adds a link-style button after the text; × still just
// dismisses.
export default function OneTimeHint({ onDismiss, onSeen, action = null, children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!onSeen || !ref.current) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      onSeen();
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onSeen();
        observer.disconnect();
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [onSeen]);

  return (
    <div className="one-time-hint" role="note" ref={ref}>
      <span className="one-time-hint-text">
        {children}
        {action && (
          <>
            {' '}
            <button type="button" className="one-time-hint-action" onClick={action.onClick}>
              {action.label}
            </button>
          </>
        )}
      </span>
      <button type="button" className="one-time-hint-dismiss" onClick={onDismiss} aria-label="Dismiss hint" title="Dismiss">
        ×
      </button>
    </div>
  );
}
