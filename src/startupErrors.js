// Startup crash handling. Imported first from main.jsx so its listeners are
// registered before any other module (Firebase, pages, data) evaluates.
//
// - renderCrashScreen(): writes the "Something went wrong" screen into #root
//   as plain DOM, so it works even if React never mounted. ErrorBoundary
//   renders the same screen in JSX from the same pieces below.
// - window 'error': show that screen for uncaught script errors React's
//   boundary can't catch, but only until the app has finished starting up
//   (markAppReady). After that they just log, instead of replacing a working
//   page. Resource-load failures (img/script/link/font) are ignored.
// - window 'unhandledrejection': log only, never the crash screen.
// - 'vite:preloadError': a lazy chunk failed to load (usually a deploy
//   replaced the hashed files under an open tab), so reload once.
//
// Nothing here throws, and every error is still console.error'd.

// Same value as DRAFT_STORAGE_KEY in utils/draftStorage.js. Hard-coded so this
// module has no imports and can't itself fail to load. Only this key is ever
// cleared: terrierplan_scheduler_schedules and terrierplan_session are kept.
const DRAFT_STORAGE_KEY = 'terrierplan_scheduler_draft';
const PRELOAD_RELOAD_KEY = 'terrierplan_preload_reload_at';
const PRELOAD_RELOAD_WINDOW_MS = 30000;
const STACK_LINES = 6;

export const CRASH_TITLE = 'Something went wrong loading TerrierPlan.';
export const CRASH_RELOAD_LABEL = 'Reload';
export const CRASH_RESET_LABEL = 'Reset saved scheduler data and reload';
// Same invite as DISCORD_URL in components/GlobalFooter.jsx (hard-coded here
// because this module has no imports).
export const CRASH_DISCORD_URL = 'https://discord.gg/bostonuniversity';
export const CRASH_REDDIT_URL = 'https://www.reddit.com/user/BUowo/';

let appReady = false;
let crashShown = false;
let reactRoot = null;

// main.jsx hands over its root so a takeover can unmount React cleanly before
// writing into #root, rather than leaving React holding nodes it no longer owns.
export function setReactRoot(root) {
  reactRoot = root;
}

// Called once the app has rendered past its loading screen.
export function markAppReady() {
  appReady = true;
}

// Called by ErrorBoundary when it shows the screen, so a follow-on window error
// doesn't redraw over it.
export function markCrashShown() {
  crashShown = true;
}

export function reloadPage() {
  window.location.reload();
}

export function resetDraftAndReload() {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch (e) {
    console.error('[TerrierPlan] Could not clear saved scheduler draft:', e);
  }
  window.location.reload();
}

// Message, first few stack lines, optional React component stack, and the
// browser's user agent: everything a screenshot from a phone needs.
export function formatErrorDetails(error, componentStack) {
  let message;
  let stack = '';
  if (error instanceof Error) {
    message = (error.name || 'Error') + ': ' + error.message;
    stack = error.stack || '';
  } else {
    try {
      message = typeof error === 'string' ? error : JSON.stringify(error);
    } catch {
      message = String(error);
    }
  }

  const lines = [message || 'Unknown error'];
  const stackLines = stack.split('\n').filter((line) => line.trim() && line.trim() !== message);
  if (stackLines.length) lines.push('', ...stackLines.slice(0, STACK_LINES));
  if (componentStack) {
    const componentLines = componentStack.split('\n').filter((line) => line.trim());
    if (componentLines.length) lines.push('', 'Component stack:', ...componentLines.slice(0, STACK_LINES));
  }
  lines.push('', 'Browser: ' + (navigator.userAgent || 'unknown'));
  return lines.join('\n');
}

// Inline <style>, not index.css, so the screen is readable even when the app's
// stylesheet didn't load. Colors use the theme tokens when they exist (cream on
// light, the dark page color on dark) with light-theme fallbacks otherwise.
const CRASH_STYLES = `
.tp-crash {
  min-height: 100vh;
  padding: 32px 16px;
  background: var(--cream, #FAF7F0);
  color: var(--text, #1A1209);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.5;
}
.tp-crash-inner { max-width: 640px; margin: 0 auto; }
.tp-crash-title { font-size: 20px; font-weight: 700; margin: 0 0 16px; }
.tp-crash-details {
  margin: 0 0 20px;
  padding: 12px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--white, #FFFFFF);
  border: 1px solid var(--border, #E5E0D5);
  border-radius: 6px;
}
.tp-crash-report { margin: 0 0 20px; }
.tp-crash-report a { color: inherit; font-weight: 600; text-decoration: underline; }
.tp-crash-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.tp-crash-btn {
  padding: 10px 16px;
  font: inherit;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--scarlet, #CC0000);
}
.tp-crash-btn-primary { background: var(--scarlet, #CC0000); color: #FFFFFF; }
.tp-crash-btn-secondary { background: transparent; color: var(--text, #1A1209); }
`;

export function ensureCrashStyles() {
  try {
    if (document.getElementById('tp-crash-styles')) return;
    const style = document.createElement('style');
    style.id = 'tp-crash-styles';
    style.textContent = CRASH_STYLES;
    document.head.appendChild(style);
  } catch {
    // Unstyled is still readable.
  }
}

function crashLink(href, text) {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}

export function renderCrashScreen(error) {
  if (crashShown) return;
  crashShown = true;

  try {
    if (reactRoot) {
      try {
        reactRoot.unmount();
      } catch {
        // Already unmounting or never rendered; #root is replaced below anyway.
      }
      reactRoot = null;
    }

    ensureCrashStyles();

    let container = document.getElementById('root');
    if (!container) {
      container = document.createElement('div');
      container.id = 'root';
      document.body.appendChild(container);
    }

    const screen = document.createElement('div');
    screen.className = 'tp-crash';
    screen.setAttribute('role', 'alert');

    const inner = document.createElement('div');
    inner.className = 'tp-crash-inner';

    const title = document.createElement('h1');
    title.className = 'tp-crash-title';
    title.textContent = CRASH_TITLE;

    const details = document.createElement('pre');
    details.className = 'tp-crash-details';
    details.textContent = formatErrorDetails(error);

    const report = document.createElement('p');
    report.className = 'tp-crash-report';
    report.appendChild(document.createTextNode('Please let BUowo know about this error on '));
    report.appendChild(crashLink(CRASH_DISCORD_URL, 'Discord'));
    report.appendChild(document.createTextNode(' or '));
    report.appendChild(crashLink(CRASH_REDDIT_URL, 'Reddit'));
    report.appendChild(document.createTextNode('. A screenshot of this screen helps.'));

    const actions = document.createElement('div');
    actions.className = 'tp-crash-actions';

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'tp-crash-btn tp-crash-btn-primary';
    reload.textContent = CRASH_RELOAD_LABEL;
    reload.addEventListener('click', reloadPage);

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'tp-crash-btn tp-crash-btn-secondary';
    reset.textContent = CRASH_RESET_LABEL;
    reset.addEventListener('click', resetDraftAndReload);

    // appendChild/innerHTML rather than append/replaceChildren: this has to
    // work on old Safari, which is exactly where startup failures show up.
    actions.appendChild(reload);
    actions.appendChild(reset);
    inner.appendChild(title);
    inner.appendChild(details);
    inner.appendChild(report);
    inner.appendChild(actions);
    screen.appendChild(inner);
    container.innerHTML = '';
    container.appendChild(screen);
  } catch (e) {
    console.error('[TerrierPlan] Could not render the crash screen:', e);
  }
}

window.addEventListener('error', (event) => {
  // Resource-load failures arrive as a plain Event targeted at the element
  // (and only reach window in the capture phase). They carry no Error and no
  // message, so they're not a script failure.
  if (event.target && event.target !== window) return;
  if (!event.error && !event.message) return;
  // Benign browser notice, not an app failure.
  if (typeof event.message === 'string' && event.message.indexOf('ResizeObserver loop') !== -1) return;

  const error = event.error || event.message;
  console.error('[TerrierPlan] Uncaught error:', error);
  if (!appReady) renderCrashScreen(error);
});

// Rejections are logged only: a failed background request (Firebase, stats)
// shouldn't replace the page, even during startup.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[TerrierPlan] Unhandled promise rejection:', event.reason);
});

window.addEventListener('vite:preloadError', (event) => {
  console.error('[TerrierPlan] Failed to load a code chunk:', event.payload);

  // Reload at most once per PRELOAD_RELOAD_WINDOW_MS. If sessionStorage is
  // unavailable we can't guard against a loop, so don't reload at all and let
  // the error surface normally.
  try {
    const last = Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY)) || 0;
    if (Date.now() - last < PRELOAD_RELOAD_WINDOW_MS) return;
    window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  // Stop Vite from rethrowing the import error while the page reloads.
  event.preventDefault();
  window.location.reload();
});
