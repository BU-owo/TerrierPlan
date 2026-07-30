import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import PlannerPage from './pages/PlannerPage';

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
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="*" element={<Navigate to="/planner" replace />} />
        </Routes>
      </BrowserRouter>

      <footer style={{
        textAlign: 'center',
        padding: '1.5rem 1rem',
        fontSize: '0.75rem',
        color: '#888',
        borderTop: '1px solid #eee',
        marginTop: '2rem'
      }}>
        Not affiliated with or endorsed by Boston University. This is an
        independent, community-made tool built with AI assistance. Data is sourced from BU's official catalog and website. Use at your
        own discretion.
      </footer> 
    </>
  );
}