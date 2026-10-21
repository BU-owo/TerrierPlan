import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import PlannerPage from './pages/PlannerPage';
import SchedulerPage from './pages/SchedulerPage';
import NotFoundPage from './pages/NotFoundPage';
import GlobalFooter from './components/GlobalFooter';
import UpdateBanner from './components/UpdateBanner';
import { markAppReady } from './startupErrors';
import { useState, useEffect } from 'react';
import PawLoader from './components/PawLoader';
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
      <UpdateBanner />
      <div className="app-shell-routes">
        <Routes>
          <Route path="/" element={<HomePage theme={theme} onToggleTheme={onToggleTheme} />} />
          <Route path="/login" element={<LoginPage theme={theme} onToggleTheme={onToggleTheme} />} />
          <Route path="/planner" element={<PlannerPage theme={theme} onToggleTheme={onToggleTheme} />} />
          <Route path="/scheduler" element={<SchedulerPage theme={theme} onToggleTheme={onToggleTheme} />} />
          <Route path="*" element={<NotFoundPage theme={theme} onToggleTheme={onToggleTheme} />} />
        </Routes>
      </div>

      <GlobalFooter />
    </div>
  );
}

export default function App() {
  const { loading } = useAuth();

  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // storage blocked: theme still applies for this session
    }
  }, [theme]);

  // Past the auth loading screen: from here on, uncaught window errors just
  // log instead of replacing the page with the crash screen.
  useEffect(() => {
    if (!loading) markAppReady();
  }, [loading]);

  function toggleTheme() {
    setTheme((current) => current === 'dark' ? 'light' : 'dark');
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <PawLoader theme={theme} alt="TerrierPlan" />
      </div>
    );
  }

  return (
    <>
      <BrowserRouter>
        <AppRoutes theme={theme} onToggleTheme={toggleTheme} />
      </BrowserRouter>
    </>
  );
}
