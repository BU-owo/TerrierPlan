// "Done vs only planned" for the trackers: which plan courses count as
// completed, and from that whether a satisfied requirement is fully done or
// still leans on planned/current courses. Reads the same per-course status
// the chips use (lockStatusMap, see getCourseStatus / describeLockStatus).
import { entryCourseKey } from './courseEntry.js';
import { normalizeStartTerm } from './term.js';

// A lockStatusMap entry ({ locked, semesterStatus }) counts as completed
// when it's locked or in a past slot.
export function isCompletedStatus(lockStatus) {
  return Boolean(lockStatus && (lockStatus.locked || lockStatus.semesterStatus === 'past'));
}

// 'completed' | 'current' | 'planned' for one plan course — what chips,
// pool cards and describeLockStatus show. No entry means the course isn't
// in a term at all (AP/IB/transfer equivalents): earned, so completed.
export function lockStatusVariant(lockStatus) {
  if (!lockStatus || isCompletedStatus(lockStatus)) return 'completed';
  if (lockStatus.semesterStatus === 'current') return 'current';
  return 'planned';
}

// Whether the done-vs-planned split applies at all. A legacy student with
// no start term, no current semester and nothing locked has no way to have
// completed anything, so the split would mark everything "planned" — off.
export function planSplitEnabled({ startTerm, currentSemesterTarget, completedCourseKeys }) {
  return Boolean(normalizeStartTerm(startTerm))
    || currentSemesterTarget != null
    || (completedCourseKeys || []).length > 0;
}

// Whether a course counts as done for the split. Keys the map doesn't know
// (AP/IB/transfer equivalents, never placed in a term) are earned credit,
// and no map at all means no split (everything reads as done, as before).
export function isKeyDone(lockStatusMap, key) {
  if (!lockStatusMap) return true;
  const status = lockStatusMap[key];
  return status == null || isCompletedStatus(status);
}

// 'done' | 'planned' for a satisfied requirement (null when it isn't): done
// when every course counting toward it is done, planned when any is only
// planned or current.
export function completionState(satisfied, countedKeys, lockStatusMap) {
  if (!satisfied) return null;
  return (countedKeys || []).every((key) => isKeyDone(lockStatusMap, key)) ? 'done' : 'planned';
}

// How many of a node's `doneCount` counted courses are completed: the
// count minus the counted courses that aren't done yet (never below 0 or
// above doneCount). `rawCount` is the uncapped count doneCount came from.
// Drives the solid share of the small requirement ring.
export function completedCountOf(doneCount, rawCount, countedKeys, lockStatusMap) {
  const notDone = (countedKeys || []).filter((key) => !isKeyDone(lockStatusMap, key)).length;
  return Math.max(0, Math.min(doneCount, rawCount - notDone));
}

// What the Requirements header, progress bar and banner show, from the
// engine's totals and the course tally's `planned` (always 0 with the split
// off, so the legacy look is unchanged). banner: 'celebrate' ("All
// requirements satisfied!") only when satisfied with nothing still planned,
// 'covered' when satisfied but some counted courses are only planned or in
// progress, null otherwise. The bar's done + planned shares add up to the
// counted share.
export function requirementsProgressView({ satisfied, claimed, required, planned }) {
  const pct = (n) => (required > 0 ? Math.min(100, Math.round((n / required) * 100)) : 0);
  const countedPercent = pct(claimed);
  const plannedPercent = Math.min(countedPercent, pct(planned));
  return {
    banner: !satisfied ? null : planned > 0 ? 'covered' : 'complete',
    countedPercent,
    donePercent: countedPercent - plannedPercent,
    plannedPercent,
  };
}

// Requirements header text with the split on (courseTally numbers):
// "6 of 15 courses done · 9 planned", "· N to add" only when something is
// still missing, "· 0 planned" left out. `compact` (sidebar) drops "courses".
export function progressHeaderText({ done, planned, toGo, required }, { compact = false } = {}) {
  return `${done} of ${required} ${compact ? '' : 'courses '}done`
    + (planned > 0 ? ` · ${planned} planned` : '')
    + (toGo > 0 ? ` · ${toGo} to add` : '');
}

// The summary line beside All / Still to do / Done (split on), in the
// header's units: "6 done · 9 planned · 0 to go", advisor items last.
export function progressSummaryText({ done, planned, toGo, toCheck = 0 }) {
  return `${done} done · ${planned} planned · ${toGo} to go`
    + (toCheck > 0 ? ` · ${toCheck} to check with advisor` : '');
}

// The "Requirements covered" popup: it celebrates whenever the plan covers
// every requirement; `variant` picks honest copy — 'covered' while some
// counted courses are only planned, 'complete' when none are (always the
// case with the split off). null variant = nothing to celebrate.
export function requirementsCelebrationReady(satisfied, plannedCount) {
  const celebrate = Boolean(satisfied);
  return { celebrate, variant: !celebrate ? null : plannedCount > 0 ? 'covered' : 'complete' };
}

// HUB banners and popup: celebrate whenever the plan covers every unit;
// `variant` 'covered' (+ how many units lean on planned courses) while some
// do, 'complete' when completed courses alone cover them. With the split
// off, completedFulfilled === fulfilled, so it's always 'complete'.
export function hubBannerState({ allFulfilled, fulfilled, completedFulfilled }) {
  if (!allFulfilled) return { celebrate: false, variant: null, plannedUnits: 0 };
  const plannedUnits = Math.max(0, fulfilled - completedFulfilled);
  return { celebrate: true, variant: plannedUnits > 0 ? 'covered' : 'complete', plannedUnits };
}

// HUB progress wording that never says "complete" while units only count
// because of planned courses: "21 of 26 HUB units done · 5 planned" then,
// else the original "26 of 26 HUB units complete". `completedFulfilled` is
// the completed-only count (equals `fulfilled` with the split off, so the
// wording is unchanged there). `hubWord: false` drops "HUB" (toolbar pill).
export function hubProgressText({ fulfilled, completedFulfilled, total }, { hubWord = true } = {}) {
  const units = hubWord ? 'HUB units' : 'units';
  const planned = Math.max(0, fulfilled - (completedFulfilled ?? fulfilled));
  return planned > 0
    ? `${fulfilled - planned} of ${total} ${units} done · ${planned} planned`
    : `${fulfilled} of ${total} ${units} complete`;
}

// Whether a requirement row starts collapsed (before any manual toggle):
// only when it's fully done. Planned rows (or ones with in-progress
// courses) start open. `compactTopLevel` (sidebar cards, always one line
// until opened) is kept as is. With the split off, a satisfied row's state
// is 'done', so legacy behavior is unchanged.
export function startsCollapsed(state, { compactTopLevel = false } = {}) {
  return compactTopLevel || state === 'done';
}

// Requirements full view filter ('all' | 'todo' | 'done') for one node, from
// its own state ('done' | 'planned' | 'todo') and, for a container, whether
// any child is shown. "Still to do" hides done nodes (and everything in
// them); "Done" shows done nodes plus any parent that holds one.
export function isNodeShown(filter, ownState, anyChildShown = false) {
  if (filter === 'todo') return ownState !== 'done';
  if (filter === 'done') return ownState === 'done' || anyChildShown;
  return true;
}

// The Requirements full view's course summary, in the same units as its
// "X of Y courses counted" header: `planned` = counted courses not done yet,
// `done` = the rest of what's counted, `toGo` = what's still missing.
// `toCheck` (UNRESOLVED "check with advisor" items) is reported on its own
// and never adds to toGo — the engine counts those as 0 courses.
// The counted total never shows above the required one ("36 of 35"), and
// planned never above what's counted.
export function courseTally({ claimedTotal, requiredTotal, countedKeys, statusMap, toCheck = 0 }) {
  const claimed = Math.min(claimedTotal || 0, requiredTotal || 0);
  const planned = Math.min(claimed, [...new Set(countedKeys || [])].filter((key) => !isKeyDone(statusMap, key)).length);
  return {
    done: Math.max(0, claimed - planned),
    planned,
    toGo: Math.max(0, (requiredTotal || 0) - claimed),
    toCheck,
  };
}

// UNRESOLVED nodes still waiting on an advisor ('needs_review') along the
// branch that counts: a ONE_OF follows its active child, the same as the
// engine's totals. Works on the evaluated tree's plain node shape.
export function countNeedsReview(node) {
  if (!node) return 0;
  if (node.type === 'UNRESOLVED') return node.status === 'needs_review' ? 1 : 0;
  if (!Array.isArray(node.children) || node.waived) return 0;
  if (node.type === 'ONE_OF') return countNeedsReview(node.children[node.activeChildIndex ?? 0]);
  return node.children.reduce((sum, child) => sum + countNeedsReview(child), 0);
}

// Count suffix for a satisfied requirement: '' when every counted course is
// done, ' · planned' when none is, ' · N planned' when it's mixed.
export function plannedSuffix(countedKeys, statusMap) {
  const keys = [...new Set(countedKeys || [])];
  const notDone = keys.filter((key) => !isKeyDone(statusMap, key)).length;
  if (notDone === 0) return '';
  return notDone === keys.length ? ' · planned' : ` · ${notDone} planned`;
}

// The HUB inputs with only the done courses, for a second useHubProgress
// call that gives completed-only progress (the solid part of each ring).
// Placeholders and other keyless entries stay; HUB ignores them anyway.
export function completedHubInputs(semesters, extraCourseKeys, lockStatusMap) {
  return {
    semesters: (semesters || []).map((entries) => (entries || []).filter((entry) => {
      const key = entryCourseKey(entry);
      return key == null || isKeyDone(lockStatusMap, key);
    })),
    extraCourseKeys: (extraCourseKeys || []).filter((key) => isKeyDone(lockStatusMap, key)),
  };
}

// The HUB inputs for "does the student still need this unit": completed
// courses plus the current semester's (AP/IB credit is added by the hook).
// Future planned courses are dropped. Same shape and no-map behavior as
// completedHubInputs (no map = no split, everything stays).
export function satisfiedHubInputs(semesters, extraCourseKeys, lockStatusMap) {
  const counts = (key) => key == null
    || isKeyDone(lockStatusMap, key)
    || lockStatusMap?.[key]?.semesterStatus === 'current';
  return {
    semesters: (semesters || []).map((entries) => (entries || []).filter((entry) => counts(entryCourseKey(entry)))),
    extraCourseKeys: (extraCourseKeys || []).filter(counts),
  };
}
