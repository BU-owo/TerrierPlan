import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import PlannerPage from './pages/PlannerPage';
import { useState, useEffect } from 'react';
import './App.css';

export default function App() {
  const { loading } = useAuth();

  const [showBeta, setShowBeta] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('terrierplan_beta_seen')) {
      setShowBeta(true);
    }
  }, []);

  function dismissBeta() {
    localStorage.setItem('terrierplan_beta_seen', 'true');
    setShowBeta(false);
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <img
          className="auth-loading-paw"
          src="/faviconlight.png"
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
              src="/faviconlight.png"
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
