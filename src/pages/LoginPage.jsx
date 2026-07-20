import { useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleGoogleSignIn() {
    setError('');
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      navigate('/planner');
    } catch (err) {
      setError('Sign-in failed. Make sure pop-ups are allowed and try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-mascot" aria-hidden="true">🐾</div>
        <h1 className="login-title">TerrierPlan</h1>
        <p className="login-subtitle">
          Plan your BU degree, track HUB units, and build your schedule — all in one place.
        </p>

        <button
          className="login-google-btn"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          {loading ? 'Signing in…' : 'Sign in with Google'}
        </button>

        {error && <p className="login-error">{error}</p>}

        <p className="login-footer">
          Boston University students only. Your data is private to you.
        </p>
      </div>

      <style>{`
        .login-page {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(150deg, #CC0000 0%, #8B0000 100%);
          padding: 24px;
        }
        .login-card {
          background: var(--white);
          border-radius: var(--radius-xl);
          padding: 40px 36px;
          max-width: 380px;
          width: 100%;
          text-align: center;
          box-shadow: var(--shadow-lg);
        }
        .login-mascot {
          font-size: 48px;
          margin-bottom: 8px;
        }
        .login-title {
          font-size: 26px;
          font-weight: 700;
          color: var(--scarlet);
          letter-spacing: -0.5px;
          margin-bottom: 8px;
        }
        .login-subtitle {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.55;
          margin-bottom: 28px;
        }
        .login-google-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 11px 20px;
          border: 1.5px solid var(--border);
          border-radius: var(--radius-md);
          background: var(--white);
          font-size: 14px;
          font-weight: 500;
          color: var(--text);
          transition: background .15s, border-color .15s, box-shadow .15s;
        }
        .login-google-btn:hover:not(:disabled) {
          background: var(--cream);
          border-color: #aaa;
          box-shadow: var(--shadow-sm);
        }
        .login-google-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .login-error {
          margin-top: 14px;
          font-size: 13px;
          color: #DC2626;
        }
        .login-footer {
          margin-top: 24px;
          font-size: 12px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
