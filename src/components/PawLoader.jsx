// The app's bouncing-paw loader: the icon plus its "Loading…" line. The wrappers
// differ (App's is full-screen, the planner's sits in its board area, the scheduler's
// are inline), so this is just the shared inside. The bounce is the
// `.auth-loading-paw` animation in index.css / App.css, which stops under
// prefers-reduced-motion (the text stays).
// size="small": a 16px paw on one line with the label, for waits inside a panel or
// list (see .paw-loader-sm in index.css). hideLabel keeps the label for screen
// readers only. Without a `theme`, it follows the page's data-theme (set in App).
export default function PawLoader({ theme, label = 'Loading…', alt = '', size, hideLabel = false }) {
  const dark = (theme ?? document.documentElement.dataset.theme) === 'dark';
  const src = dark ? '/favicondark.png' : '/faviconlight.png';
  if (size === 'small') {
    return (
      <span className="paw-loader-sm">
        <img className="auth-loading-paw" src={src} alt="" width={16} height={16} />
        <span className={hideLabel ? 'paw-loader-sr' : undefined}>{label}</span>
      </span>
    );
  }
  return (
    <>
      <img
        className="auth-loading-paw"
        src={src}
        alt={alt}
        width={32}
        height={32}
      />
      <p>{label}</p>
    </>
  );
}
