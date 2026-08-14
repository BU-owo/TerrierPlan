import { Link } from 'react-router-dom';

// Shared by both top-level pages' headers now that there are two of them —
// a plain <Link> (not a raw <a>) so client-side nav still passes through
// PlannerPage's onClickCapture unsaved-changes guard, which intercepts any
// internal <a> click.
export default function HeaderNav({ active }) {
  return (
    <nav className="app-header-nav" aria-label="TerrierPlan sections">
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
