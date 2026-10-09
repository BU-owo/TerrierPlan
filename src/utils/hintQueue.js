import { useSyncExternalStore } from 'react';

// Which one-time hint may be on screen right now. Every hint that currently
// wants to show registers its key with a priority (lower = earlier); only the
// best one is "active", so a page never shows two at once. See
// useOneTimeHint's { priority, when } options. Module-level on purpose: the
// hints of one page live in different components.
const wanting = new Map(); // key -> priority
const listeners = new Set();
let active = null;

function recompute() {
  let best = null;
  let bestPriority = Infinity;
  for (const [key, priority] of wanting) {
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
