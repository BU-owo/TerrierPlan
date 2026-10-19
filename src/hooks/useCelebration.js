import { useEffect, useRef, useState } from 'react';

const KEY_PREFIX = 'terrierplan_celebrated_';

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Storage blocked: the card can show again next session, that's fine.
  }
}

function clearFlag(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// Shows a celebration once when a milestone flips from not-complete to
// complete during this session. The first ready value for a plan (and for a
// major, for "reqs") only seeds the previous value, so opening or switching to
// an already-complete plan never fires. While `ready` is false nothing fires
// and the previous value is held, so a course whose data is still loading
// can't swallow or fake a transition. A localStorage flag stops repeats across
// reloads; it's cleared when the milestone goes back to incomplete.
export function useCelebration({ milestoneKey, isComplete, ready, planId, majorBulletinUrl }) {
  const storageKey = `${KEY_PREFIX}${planId || 'guest'}_${milestoneKey}${
    milestoneKey === 'reqs' && majorBulletinUrl ? `_${majorBulletinUrl}` : ''
  }`;
  const seededForRef = useRef(null);
  const prevRef = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (seededForRef.current !== storageKey) {
      seededForRef.current = storageKey;
      prevRef.current = null;
      setShow(false);
    }
    if (!ready) return;

    const prev = prevRef.current;
    prevRef.current = isComplete;
    if (!isComplete) {
      clearFlag(storageKey);
      setShow(false);
      return;
    }
    if (prev === false && !readFlag(storageKey)) {
      writeFlag(storageKey);
      setShow(true);
    }
  }, [storageKey, ready, isComplete]);

  return [show, () => setShow(false)];
}
