import { useState, useEffect, useCallback } from 'react';

// Collapse state for a planner side panel, remembered in localStorage under
// `storageKey`. Collapsing is a desktop-only affordance: below this width the
// mobile bottom-tab layout takes over, so `collapsed` is always false there
// (whatever was stored) and `desktop` tells callers whether to show controls.
const DESKTOP_QUERY = '(min-width: 861px)';

function readStored(storageKey) {
  try {
    return localStorage.getItem(storageKey) === '1';
  } catch {
    return false; // storage blocked/unavailable: just start expanded
  }
}

export default function usePanelCollapse(storageKey) {
  const [stored, setStored] = useState(() => readStored(storageKey));
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e) => setDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setCollapsed = useCallback((next) => {
    setStored(next);
    try {
      localStorage.setItem(storageKey, next ? '1' : '0');
    } catch {
      // storage blocked/full: the panel still collapses for this visit
    }
  }, [storageKey]);

  return { collapsed: stored && desktop, desktop, setCollapsed };
}
