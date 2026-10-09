import { useSyncExternalStore } from 'react';

// Which one-time hint may be on screen right now. Every hint that currently
// wants to show registers its key with a priority (lower = earlier); only the
// best one is "active", so a page never shows two at once. See
// useOneTimeHint's { priority, when } options. Module-level on purpose: the
// hints of one page live in different components.
const wanting = new Map(); // key -> priority
const listeners = new Set();
let active = null;
// After the active hint is dismissed, nothing is active for a moment so the
// next hint doesn't pop in the instant the last one goes.
const DISMISS_GAP_MS = 1500;
let holdUntil = 0;
let holdTimer = null;

function recompute() {
  let best = null;
  let bestPriority = Infinity;
  const held = Date.now() < holdUntil;
  for (const [key, priority] of (held ? [] : wanting)) {
    if (priority < bestPriority) {
      best = key;
      bestPriority = priority;
    }
  }
  if (best !== active) {
    active = best;
    listeners.forEach((listener) => listener());
  }
}

// Called when a hint is dismissed; only holds the queue if it was the one on
// screen (dismissing a hint that never showed doesn't hide the current one).
export function noteHintDismissed(key) {
  if (key !== active) return;
  holdUntil = Date.now() + DISMISS_GAP_MS;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdUntil = 0;
    recompute();
  }, DISMISS_GAP_MS);
  recompute();
}

export function setHintWanted(key, priority, wanted) {
  if (wanted) wanting.set(key, priority);
  else wanting.delete(key);
  recompute();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveHint() {
  return useSyncExternalStore(subscribe, () => active);
}
