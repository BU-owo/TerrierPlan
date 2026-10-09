import { useState, useCallback, useEffect, useRef } from 'react';
import { isReturningUser } from '../utils/firstTimer';
import { noteHintDismissed, setHintWanted, useActiveHint } from '../utils/hintQueue';

// "Show this hint once" state, remembered in localStorage as
// terrierplan_hint_<key>. Returns [visible, dismiss, markSeen, dismissOnAction].
//  - `dismiss` hides the hint now and for good.
//  - `dismissOnAction` is `dismiss` for "the person did the thing": ignored for
//    the first few seconds after the hint comes on screen (so it can be read),
//    but still dismisses a hint that hasn't shown yet.
//  - `markSeen` records it as seen without hiding it: pass it to OneTimeHint as
//    onSeen, which calls it when the hint is first actually on screen — so it
//    stays up for that visit but never comes back after a reload.
// Options: { priority, when }. With a `priority` the hint joins the page's
// queue (see hintQueue.js): `visible` is true only while `when` holds AND it is
// the first unseen hint in line, so one hint shows at a time. Without options
// `visible` is just "not seen yet" and the caller adds its own conditions.
// Returning users (see firstTimer.js) start with every hint already seen. With
// storage blocked the hint just shows again next visit.
const PREFIX = 'terrierplan_hint_';
const READ_GRACE_MS = 3000;

function readSeen(key) {
  try {
    return localStorage.getItem(PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function writeSeen(key) {
  try {
    localStorage.setItem(PREFIX + key, '1');
  } catch {
    // storage blocked/full: hidden for this visit only
  }
}

export default function useOneTimeHint(key, { priority, when = true } = {}) {
  const [seen, setSeen] = useState(() => isReturningUser() || readSeen(key));
  const queued = priority !== undefined;
  const wanted = queued && !seen && Boolean(when);

  useEffect(() => {
    if (!queued) return undefined;
    setHintWanted(key, priority, wanted);
    return () => setHintWanted(key, priority, false);
  }, [key, priority, queued, wanted]);

  const active = useActiveHint();
  const seenAtRef = useRef(null);

  const dismiss = useCallback(() => {
    noteHintDismissed(key);
    setSeen(true);
    writeSeen(key);
  }, [key]);

  const markSeen = useCallback(() => {
    seenAtRef.current = Date.now();
    writeSeen(key);
  }, [key]);

  const dismissOnAction = useCallback(() => {
    if (seenAtRef.current !== null && Date.now() - seenAtRef.current < READ_GRACE_MS) return;
    dismiss();
  }, [dismiss]);

  return [queued ? wanted && active === key : !seen, dismiss, markSeen, dismissOnAction];
}
