import { Children } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import HeaderNav from './HeaderNav';
import UserMenu from './UserMenu';
import './AppHeader.css';

// Shared two-row header for the app pages. Row 1 (brand, section tabs,
// help/theme/account) is the same everywhere; row 2 is a page toolbar that
// only renders when the page passes children. Rendered by each page itself
// rather than once in App.jsx, so it stays inside PlannerPage's
// onClickCapture unsaved-changes guard.
//
// onSignOut/onSignIn default to a plain sign-out and client-side nav to
// /login; PlannerPage overrides both to go through its leave guard.
export default function AppHeader({
  active,
  theme,
  onToggleTheme,
  onOpenHelp,
  onSignOut,
  onSignIn,
  children,
}) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const hasToolbar = Children.toArray(children).length > 0;
  const themeLabel = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;

  return (
    <header className="tp-header">
      <div className="tp-header-row1">
        <Link to="/" className="tp-header-brand" aria-label="TerrierPlan home">
          <img src="/faviconred.png" alt="" width={18} height={18} />
          <span className="tp-header-brand-text">TerrierPlan</span>
        </Link>

        <HeaderNav active={active} />

        <div className="tp-header-actions">
          <button
            type="button"
            className="tp-help-btn"
            onClick={onOpenHelp}
            aria-label="Help & feedback"
            title="Help & feedback"
          >
            ?
          </button>
          <button
            type="button"
            className="tp-theme-btn"
            onClick={onToggleTheme}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <UserMenu
            user={user}
            loading={loading}
            onSignOut={onSignOut ?? (() => signOut(auth))}
            onSignIn={onSignIn ?? (() => navigate('/login'))}
          />
        </div>
      </div>

      {hasToolbar && <div className="tp-header-row2">{children}</div>}
    </header>
  );
}
