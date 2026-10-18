import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Small reusable notice: bottom-center, auto-dismissed after `duration` ms,
// announced politely to screen readers. `toast` is { id, message } or null;
// a new id restarts the timer even for the same message. On phones it sits
// just above the planner's mobile tab bar (measured, since the footer below
// it changes height); it never covers the header.
export default function Toast({ toast, onDismiss, duration = 4000 }) {
  const [bottom, setBottom] = useState(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => dismissRef.current?.(), duration);
    return () => clearTimeout(timer);
  }, [toast, duration]);

  useLayoutEffect(() => {
    if (!toast) return;
    const tabBar = document.querySelector('.mobile-tab-bar');
    const rect = tabBar && getComputedStyle(tabBar).display !== 'none' ? tabBar.getBoundingClientRect() : null;
    setBottom(rect && rect.height > 0 ? window.innerHeight - rect.top + 8 : null);
  }, [toast]);

  return (
    <div className="tp-toast-region" aria-live="polite" role="status">
      {toast && (
        <div key={toast.id} className="tp-toast" style={bottom != null ? { bottom } : undefined}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
