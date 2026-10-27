import { useMemo, useSyncExternalStore } from 'react';

// The student's picks in the Requirements view — a hoisted track tab and a
// `selection: "student"` ONE_OF (BSBA concentration) — as { [ONE_OF id]:
// childIndex } per major (bulletin URL). Browser-only (localStorage, one key
// for every plan); never part of the plan, so nothing else saves it. The
// sidebar and the full view share it, so a pick in one shows in the other.

const STORAGE_KEY = 'terrierplan_requirement_picks';
const CHANGE_EVENT = 'terrierplan:requirement-picks';

// Set on every write, so picks still work this session if storage is blocked.
let memoryRaw = null;

function readRaw() {
  if (memoryRaw !== null) return memoryRaw;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseAll(raw) {
  try {
    const all = JSON.parse(raw);
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

// Only non-negative integers survive; the engine ignores out-of-range ones.
function picksFor(raw, url) {
  const picks = parseAll(raw)[url];
  if (!picks || typeof picks !== 'object') return {};
  return Object.fromEntries(Object.entries(picks).filter(([, index]) => Number.isInteger(index) && index >= 0));
}

function subscribe(onChange) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export default function useRequirementPicks(url) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const picks = useMemo(() => (url ? picksFor(raw, url) : {}), [raw, url]);

  // index null clears the pick (track: back to the engine's best match;
  // concentration: none picked).
  function setPick(id, index) {
    if (!url) return;
    const all = parseAll(readRaw());
    const next = { ...picksFor(readRaw(), url) };
    if (index == null) delete next[id];
    else next[id] = index;
    all[url] = next;
    memoryRaw = JSON.stringify(all);
    try {
      localStorage.setItem(STORAGE_KEY, memoryRaw);
    } catch {
      // Storage blocked: kept in memory for this session.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return [picks, setPick];
}
