import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import PlannerPage from './pages/PlannerPage';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="auth-loading">
        <span className="auth-loading-paw">🐾</span>
        <p>Hang on…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/planner"
          element={
            <RequireAuth>
              <PlannerPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/planner" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
