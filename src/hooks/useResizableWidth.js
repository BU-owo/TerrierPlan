import { useCallback, useEffect, useState } from 'react';

function readStored(storageKey) {
  try {
    const raw = Number(localStorage.getItem(storageKey));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null; // storage blocked: just use the default width
  }
}

// A drag-resizable panel width, remembered in localStorage under
// `storageKey` (same idea as the Scheduler's preview width). The stored
// value is the student's preference; the returned `width` is that
// preference clamped to [min, getMax()] for the current layout — recomputed
// on every render, on window resize, and when `clampDeps` change — so a
// small window shrinks the panel without overwriting the saved width.
// `null` = use the CSS default. `getMax()` reads live layout.
export default function useResizableWidth(storageKey, { min, getMax, clampDeps = [] }) {
  const [preferred, setPreferred] = useState(() => readStored(storageKey));
  const [, setLayoutTick] = useState(0);

  const clamp = useCallback(
    (value) => Math.round(Math.min(Math.max(value, min), Math.max(min, getMax()))),
    // getMax reads live layout, not props
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min],
  );

  // Re-render (and so re-clamp) on window resize and caller layout changes.
  useEffect(() => {
    const bump = () => setLayoutTick((t) => t + 1);
    window.addEventListener('resize', bump);
    return () => window.removeEventListener('resize', bump);
  }, []);
  useEffect(() => {
    setLayoutTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, clampDeps);

  // A drag/keyboard change is clamped to what fits right now and saved.
  const setWidth = useCallback((value) => {
    setPreferred(value == null ? null : clamp(value));
  }, [clamp]);

  const reset = useCallback(() => setPreferred(null), []);

  useEffect(() => {
    try {
      if (preferred == null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(preferred));
    } catch {
      // storage blocked/full: the width still applies for this visit
    }
  }, [storageKey, preferred]);

  return { width: preferred == null ? null : clamp(preferred), setWidth, reset };
}
