import { useEffect, useState } from 'react';
import { flushAllPendingWrites } from '../utils/pendingWrites';

// Slim "a new version is available" row at the top of the app shell (in
// normal flow, so it never covers the header or the mobile tab bar). The
// running build's id is baked in at build time (vite.config.js); a deploy
// writes a new /version.json. Checked every 5 minutes while the tab is
// visible and whenever it regains focus. Never reloads on its own: "Save
// and reload" first sends pending saves (see pendingWrites.js) and only
// reloads if they all went through. Off in dev; a failed or offline check
// does nothing.
const BUILD_ID = import.meta.env.VITE_BUILD_ID;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DISMISS_MS = 30 * 60 * 1000;

// Two frames: lets a blurred input commit its edit and React run the save
// effects that edit schedules, before the flush reads what's pending.
function nextFrames() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'saving' | 'failed'

  useEffect(() => {
    if (import.meta.env.DEV || !BUILD_ID) return undefined;
    let cancelled = false;
    async function check() {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const latest = typeof data?.buildId === 'string' ? data.buildId : '';
        if (!cancelled && latest && latest !== BUILD_ID) setAvailable(true);
      } catch {
        // offline, or not JSON (e.g. the SPA fallback page): try again later
      }
    }
    function handleVisibility() {
      if (document.visibilityState === 'visible') check();
    }
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!dismissed) return undefined;
    const timer = setTimeout(() => setDismissed(false), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [dismissed]);

  async function handleSaveAndReload() {
    setStatus('saving');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await nextFrames();
    if (await flushAllPendingWrites()) {
      window.location.reload();
    } else {
      setStatus('failed');
    }
  }

  if (!available || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">
        {status === 'failed'
          ? "Couldn't save your changes, so we didn't reload. Try again in a moment."
          : 'A new version of TerrierPlan is available.'}
      </span>
      <button
        type="button"
        className="update-banner-btn"
        onClick={handleSaveAndReload}
        disabled={status === 'saving'}
      >
        {status === 'saving' ? 'Saving…' : 'Save and reload'}
      </button>
      <button
        type="button"
        className="update-banner-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Hide for 30 minutes"
        title="Hide for 30 minutes"
      >
        ×
      </button>
    </div>
  );
}
