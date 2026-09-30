import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

const DEBUG_LOAD_TIMING = import.meta.env.DEV; // TEMP-TIMING

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      // Fires once per useAuth() instance (App, PlannerPage, AppHeader, ...). // TEMP-TIMING
      if (DEBUG_LOAD_TIMING) console.log(`[load] auth resolved @${Math.round(performance.now())}ms signedIn=${!!u}`); // TEMP-TIMING
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { user, loading };
}
