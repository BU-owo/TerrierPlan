import { Link } from 'react-router-dom';

// Shared by both top-level pages' headers now that there are two of them —
// a plain <Link> (not a raw <a>) so client-side nav still passes through
// PlannerPage's onClickCapture unsaved-changes guard, which intercepts any
// internal <a> click.
export default function HeaderNav({ active }) {
  return (
    <nav className="app-header-nav" aria-label="TerrierPlan sections">
      {/* Icon-only on phones (see planner.css) — the word "Home" alone
          pushes the header past a 375px screen. */}
      <Link to="/" className="app-header-nav-link app-header-nav-home" aria-label="Home">
        <svg className="app-header-nav-home-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h3v-3.5h2V13h3V6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="app-header-nav-home-label">Home</span>
      </Link>
      <Link
        to="/planner"
        className={`app-header-nav-link${active === 'planner' ? ' active' : ''}`}
      >
        Planner
      </Link>
      <Link
        to="/scheduler"
        className={`app-header-nav-link${active === 'scheduler' ? ' active' : ''}`}
      >
        Scheduler
      </Link>
    </nav>
  );
}
