import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import PlannerPage from './pages/PlannerPage';
import SchedulerPage from './pages/SchedulerPage';
import GlobalFooter from './components/GlobalFooter';
import { useState, useEffect } from 'react';
import './App.css';

const THEME_STORAGE_KEY = 'terrierplan_theme';

// Planner/Scheduler are full-height app shells (their own .planner-layout
// is height:100%, filling .app-shell-routes below) with internally-
// scrolling panels; Login just fills whatever height it's given and
// centers its card. Wrapping all three in one 100dvh flex column — routed
// content as the flexible middle, GlobalFooter as a shrink-to-fit row
// underneath — means the footer sits at the bottom of every page without
// creating a second, outer page-level scrollbar on top of the app shells'
// own internal scrolling.
function AppRoutes({ theme, onToggleTheme }) {
  return (
    <div className="app-shell">
      <div className="app-shell-routes">
        <Routes>
          <Route path="/login" element={<LoginPage theme={theme} onToggleTheme={onToggleTheme} />} />
          <Route path="/planner" element={<PlannerPage theme={theme} onToggleTheme={onToggleTheme} />} />
          <Route path="/scheduler" element={<SchedulerPage theme={theme} onToggleTheme={onToggleTheme} />} />
          <Route path="*" element={<Navigate to="/planner" replace />} />
        </Routes>
      </div>

      <GlobalFooter />
    </div>
  );
}

export default function App() {
  const { loading } = useAuth();

  const [showBeta, setShowBeta] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) || 'light');

  useEffect(() => {
    if (!localStorage.getItem('terrierplan_beta_seen')) {
      setShowBeta(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => current === 'dark' ? 'light' : 'dark');
  }

  function dismissBeta() {
    localStorage.setItem('terrierplan_beta_seen', 'true');
    setShowBeta(false);
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <img
          className="auth-loading-paw"
          src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
          alt="TerrierPlan"
          width={32}
          height={32}
        />
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <>
      {showBeta && (
        <div className="beta-overlay">
          <div className="beta-modal">
            <img
              className="beta-modal-paw"
              src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
              alt="TerrierPlan"
              width={48}
              height={48}
            />
            <h2>Welcome to TerrierPlan!</h2>
            <p>
              This project is currently in beta — things may be incomplete,
              broken, or change without warning. If you find bugs or have
              ideas, you know where to find me!
            </p>
            <button className="beta-dismiss-btn" onClick={dismissBeta}>
              Got it, let me in!!!!!!
            </button>
          </div>
        </div>
      )}
      <BrowserRouter>
        <AppRoutes theme={theme} onToggleTheme={toggleTheme} />
      </BrowserRouter>
    </>
  );
}
