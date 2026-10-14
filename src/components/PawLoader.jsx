// The app's bouncing-paw loader: the icon plus its "Loading…" line. The wrappers
// differ (App's is full-screen, the planner's sits in its board area, the scheduler's
// are inline), so this is just the shared inside. The bounce is the
// `.auth-loading-paw` animation in index.css / App.css, which stops under
// prefers-reduced-motion (the text stays).
export default function PawLoader({ theme, label = 'Loading…', alt = '' }) {
  return (
    <>
      <img
        className="auth-loading-paw"
        src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
        alt={alt}
        width={32}
        height={32}
      />
      <p>{label}</p>
    </>
  );
}
