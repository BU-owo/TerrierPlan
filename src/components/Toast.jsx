import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Small reusable notice: bottom-center, auto-dismissed, announced politely to
// screen readers. `toast` is { id, message, tone?, duration?, action? } or
// null; a new id restarts the timer even for the same message.
//   tone: 'confirm'   the neutral style for a confirmation (default: the dark
//                     notice style, used for refusals)
//   duration          ms before it goes away (default: the `duration` prop,
//                     4000); the timer pauses while the toast is hovered or
//                     holds keyboard focus
//   action            { label, onClick } adds a button (e.g. "Undo"); the
//                     caller decides what clicking does, including dismissing
// On phones it sits just above the planner's mobile tab bar (measured, since
// the footer below it changes height); it never covers the header.
export default function Toast({ toast, onDismiss, duration = 4000 }) {
  const [bottom, setBottom] = useState(null);
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const total = toast?.duration ?? duration;
  const remainingRef = useRef(total);

  // A new toast starts with its full time (declared before the timer effect,
  // so it runs first).
  useEffect(() => {
    remainingRef.current = total;
    setPaused(false);
  }, [toast, total]);

  useEffect(() => {
    if (!toast || paused) return undefined;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismissRef.current?.(), remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [toast, paused, total]);

  useLayoutEffect(() => {
    if (!toast) return;
    const tabBar = document.querySelector('.mobile-tab-bar');
    const rect = tabBar && getComputedStyle(tabBar).display !== 'none' ? tabBar.getBoundingClientRect() : null;
    setBottom(rect && rect.height > 0 ? window.innerHeight - rect.top + 8 : null);
  }, [toast]);

  return (
    <div className="tp-toast-region" aria-live="polite" role="status">
      {toast && (
        <div
          key={toast.id}
          className={`tp-toast${toast.tone === 'confirm' ? ' tp-toast--confirm' : ''}${toast.action ? ' has-action' : ''}`}
          style={bottom != null ? { bottom } : undefined}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
        >
          <span className="tp-toast-message">{toast.message}</span>
          {toast.action && (
            <button type="button" className="tp-toast-action" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
