import { Link } from 'react-router-dom';

// The Home | Planner | Scheduler tabs in AppHeader's first row — plain
// <Link>s (not a raw <a> or buttons) so client-side nav still passes
// through PlannerPage's onClickCapture unsaved-changes guard, which
// intercepts any internal <a> click. Styled in AppHeader.css.
export default function HeaderNav({ active }) {
  const tabClass = (name) => `tp-tab${active === name ? ' is-active' : ''}`;
  const current = (name) => (active === name ? 'page' : undefined);

  return (
    <nav className="tp-tabs" aria-label="TerrierPlan sections">
      {/* Icon-only on phones (see AppHeader.css) — the word "Home" alone
          pushes the row past a 375px screen. */}
      <Link to="/" className={`${tabClass('home')} tp-tab-home`} aria-label="Home" aria-current={current('home')}>
        <svg className="tp-tab-home-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h3v-3.5h2V13h3V6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="tp-tab-home-label">Home</span>
      </Link>
      <Link to="/planner" className={tabClass('planner')} aria-current={current('planner')}>
        Planner
      </Link>
      <Link to="/scheduler" className={tabClass('scheduler')} aria-current={current('scheduler')}>
        Scheduler
      </Link>
    </nav>
  );
}
