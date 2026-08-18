import { useEffect, useRef, useState } from 'react';
import {
  doc,
  runTransaction,
  setDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  collection,
  query,
  where,
  getCountFromServer,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

const VISITOR_ID_KEY = 'terrierplan_visitor_id';
const PRESENCE_HEARTBEAT_MS = 30_000;
const ONLINE_REFRESH_MS = 45_000;
const ONLINE_WINDOW_MS = 2 * 60_000; // a presence doc counts as "online" if newer than this
// How far out each heartbeat pushes presence/{id}.expiresAt — not enforced
// by any code here, it's written for a Firestore TTL policy (see
// SCHEMA.md) to eventually garbage-collect docs whose tab closed and
// stopped refreshing it. No such policy is configured yet — a known
// follow-up, not solved by this hook.
const PRESENCE_TTL_MS = 10 * 60_000;

function createVisitorId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `v_${crypto.randomUUID()}`;
  }
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Rough, approximate site-wide counters for the footer — NOT an exact
// unique-visitor count, by design (see the handoff task this shipped
// with). Three independent jobs bundled into one hook since they share
// the same per-browser visitor id:
//   1. Bootstrap: the first time this ever runs on a given browser
//      (whether that visit ends up signed in or stays guest), claim a
//      visitor id and increment siteStats/global.totalUsersEver exactly
//      once, ever, from that browser.
//   2. Presence: keep a presence/{sessionId} doc's lastSeen fresh every
//      ~30s while the tab is open, so "online now" can be approximated.
//   3. Read back both numbers for display.
export default function useSiteStats() {
  const { user } = useAuth();
  const [totalUsersEver, setTotalUsersEver] = useState(null);
  const [onlineNow, setOnlineNow] = useState(null);

  // Lazy initializer runs once, synchronously, on mount — reading
  // localStorage here is safe/idempotent even under StrictMode's dev-only
  // double-render. The actual localStorage WRITE (claiming a freshly
  // generated id) happens in the bootstrap effect below, not here.
  const [{ visitorId, isFirstEverVisit }] = useState(() => {
    const existing = localStorage.getItem(VISITOR_ID_KEY);
    if (existing) return { visitorId: existing, isFirstEverVisit: false };
    return { visitorId: createVisitorId(), isFirstEverVisit: true };
  });

  const hasBootstrappedRef = useRef(false);
  useEffect(() => {
    if (!isFirstEverVisit || hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;
    localStorage.setItem(VISITOR_ID_KEY, visitorId);

    const statsRef = doc(db, 'siteStats', 'global');
    runTransaction(db, async (tx) => {
      const snap = await tx.get(statsRef);
      if (!snap.exists()) {
        tx.set(statsRef, { totalUsersEver: 1 });
      } else {
        tx.update(statsRef, { totalUsersEver: (snap.data().totalUsersEver || 0) + 1 });
      }
    }).catch((err) => {
      console.error('[useSiteStats] totalUsersEver bootstrap increment failed', err);
    });
  }, [isFirstEverVisit, visitorId]);

  // Live totalUsersEver display — a single-doc listener, not polling.
  useEffect(() => {
    const statsRef = doc(db, 'siteStats', 'global');
    const unsub = onSnapshot(
      statsRef,
      (snap) => setTotalUsersEver(snap.exists() ? snap.data().totalUsersEver ?? 0 : 0),
      () => setTotalUsersEver(null),
    );
    return unsub;
  }, []);

  // Presence heartbeat, keyed by the signed-in uid when there is one
  // (otherwise the same per-browser visitor id used for the bootstrap
  // count above) — re-keys itself if auth state changes mid-session.
  useEffect(() => {
    const sessionId = user?.uid || visitorId;
    const presenceRef = doc(db, 'presence', sessionId);

    function heartbeat() {
      setDoc(presenceRef, {
        lastSeen: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + PRESENCE_TTL_MS),
      }).catch(() => {});
    }

    heartbeat();
    const interval = setInterval(heartbeat, PRESENCE_HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [user?.uid, visitorId]);

  // Online-now count — polled rather than a live listener, since the
  // "within the last 2 minutes" cutoff itself drifts every second; a
  // snapshot listener would still need re-querying on this same cadence.
  useEffect(() => {
    let cancelled = false;

    async function refreshOnlineCount() {
      try {
        const cutoff = Timestamp.fromMillis(Date.now() - ONLINE_WINDOW_MS);
        const onlineQuery = query(collection(db, 'presence'), where('lastSeen', '>', cutoff));
        const snap = await getCountFromServer(onlineQuery);
        if (!cancelled) setOnlineNow(snap.data().count);
      } catch {
        if (!cancelled) setOnlineNow(null);
      }
    }

    refreshOnlineCount();
    const interval = setInterval(refreshOnlineCount, ONLINE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { totalUsersEver, onlineNow };
}
