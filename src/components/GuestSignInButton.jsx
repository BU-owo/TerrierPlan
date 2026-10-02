import { useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase';

// "Sign in with Google" for the guest notices on the Planner and Scheduler.
// The same Firebase call LoginPage makes (a Google popup), but without
// navigating anywhere: the page the guest is on stays put, and each page's
// own signed-in effects (plan migration in the Planner, saved-schedule
// migration in the Scheduler) run off the auth state change exactly as they
// do after any other sign-in. `onBeforeSignIn` lets a page flush guest state
// to localStorage first (the Planner's autosave), which migration reads.
// Callers give it a `className` and, optionally, their own label markup.
export default function GuestSignInButton({ className, onBeforeSignIn, children = 'Sign in with Google' }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    setFailed(false);
    setBusy(true);
    try {
      onBeforeSignIn?.();
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      setFailed(true);
      console.error('Sign-in failed:', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={handleClick} disabled={busy}>
        {children}
      </button>
      {failed && (
        <span role="alert" style={{ fontSize: 11, marginLeft: 6 }}>
          Sign-in failed — allow pop-ups and try again.
        </span>
      )}
    </>
  );
}
