import { useState, useEffect } from 'react';

// True at the wide (side-by-side panels) layout, false at the narrow one where
// the bottom tab bar shows one panel at a time. Same breakpoint as
// usePanelCollapse and the pages' mobile CSS. Used so a hint inside a hidden
// mobile tab doesn't hold up hints on the visible one (see useOneTimeHint).
const DESKTOP_QUERY = '(min-width: 861px)';

export default function useDesktopLayout() {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e) => setDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop;
}
