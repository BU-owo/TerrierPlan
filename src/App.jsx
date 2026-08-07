import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import PlannerPage from './pages/PlannerPage';

function AppRoutes() {
  const location = useLocation();
  const isPlanner = location.pathname.startsWith('/planner');

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="*" element={<Navigate to="/planner" replace />} />
      </Routes>

      {/* The planner is a full-height app shell (100dvh, internal scroll);
          the footer only makes sense on the marketing-style login page. */}
      {!isPlanner && (
        <footer style={{
          textAlign: 'center',
          padding: '1.5rem 1rem',
          fontSize: '0.75rem',
          color: '#888',
          borderTop: '1px solid #eee',
        }}>
          Not affiliated with or endorsed by Boston University. This is an
          independent, community-made, mostly vibe-coded tool. Use at your
          own discretion.
        </footer>
      )}
    </>
  );
}

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-loading">
        <span className="auth-loading-paw">🐾</span>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}