// The undo behind the "… is now your Marine Semester" toast.
//
// The placement happens immediately; the toast offers "Undo". Undo restores a
// snapshot of `semesters` taken BEFORE the change (so a move from another
// term restores both terms), and it must never overwrite later work: the
// toast dismisses itself on ANY other plan edit. PlannerPage keeps a
// "baseline" of the plan's editable state as it was right after the change
// (armUndoBaseline) and dismisses when planEditChanged says anything differs.

// Copy of `semesters` that later edits can't touch (entries are replaced, never
// mutated, but the arrays around them are copied anyway).
export function snapshotSemesters(semesters) {
  return (semesters || []).map((entries) => [...(entries || [])]);
}

// A fresh copy of the snapshot to put back (so Undo itself can't alias it).
export function restoreSemesters(snapshot) {
  return snapshotSemesters(snapshot);
}

// Whether any value of `current` differs (by identity) from `baseline` — both
// are plain objects of the plan's editable state (see PlannerPage). A missing
// baseline counts as unchanged: it is captured on the first render after the
// change.
export function planEditChanged(baseline, current) {
  if (!baseline) return false;
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current || {})]);
  for (const key of keys) {
    if (!Object.is(baseline[key], current?.[key])) return true;
  }
  return false;
}

// The undo state: { toastId, snapshot, stash, baseline }. `baseline` is filled
// in by armUndoBaseline on the first render after the change. `stash` (optional)
// is the Paw-tential Courses list from before the change, for changes that
// touch it too (the standard-plan fill); null leaves the stash alone on Undo.
export function createUndo(toastId, snapshot, stash = null) {
  return { toastId, snapshot: snapshotSemesters(snapshot), stash: Array.isArray(stash) ? [...stash] : null, baseline: null };
}

// One step of the dismiss-on-edit check, run whenever plan state may have
// changed. Returns { undo, dismiss }: the first call arms the baseline, later
// calls report `dismiss` once anything differs from it.
export function stepUndo(undo, current) {
  if (!undo) return { undo: null, dismiss: false };
  if (!undo.baseline) return { undo: { ...undo, baseline: current }, dismiss: false };
  return { undo, dismiss: planEditChanged(undo.baseline, current) };
}
