import { Children, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import HeaderNav from './HeaderNav';
import UserMenu from './UserMenu';
import FeedbackModal from './FeedbackModal';
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
  const [showFeedback, setShowFeedback] = useState(false);
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
            className="tp-feedback-btn"
            onClick={() => setShowFeedback(true)}
            aria-label="Send feedback or report a bug"
            title="Send feedback or report a bug"
          >
            {/* Bug outline; currentColor so it follows the button. */}
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 7.5V6a3 3 0 0 1 6 0v1.5" />
              <path d="M12 20a6 6 0 0 1-6-6v-3a3.5 3.5 0 0 1 3.5-3.5h5A3.5 3.5 0 0 1 18 11v3a6 6 0 0 1-6 6z" />
              <path d="M12 20v-9" />
              <path d="M6 13H3M21 13h-3M6.5 9 4 7M17.5 9 20 7M6.5 17.5 4 19.5M17.5 17.5 20 19.5" />
            </svg>
          </button>
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
      <FeedbackModal open={showFeedback} onClose={() => setShowFeedback(false)} />
    </header>
  );
}
