import { useEffect, useRef, useState } from 'react';

// A fast load shouldn't flash a loader: it only shows once the wait has lasted this
// long, and once shown it stays at least this long so it doesn't blink away.
export const LOADER_SHOW_DELAY_MS = 150;
export const LOADER_MIN_VISIBLE_MS = 300;

// True while a loader should be on screen for `active`: after LOADER_SHOW_DELAY_MS of
// being active, until it has been up for LOADER_MIN_VISIBLE_MS and `active` is over.
export default function useDelayedBusy(active) {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active && !visible) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, LOADER_SHOW_DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (!active && visible) {
      const left = Math.max(0, LOADER_MIN_VISIBLE_MS - (Date.now() - shownAt.current));
      const timer = setTimeout(() => setVisible(false), left);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [active, visible]);

  return visible;
}
