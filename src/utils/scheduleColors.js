// Per-course color for the weekly grid. Palette values live in scheduler.css
// (.sched-color-0..N-1) so light/dark theming stays in CSS; this file only
// decides which slot a course gets.
export const SCHED_COLOR_COUNT = 12;

// Fallback only: a course that's on screen but not in the draft (e.g. a
// bookmarked combination from before it was removed) has no assigned slot,
// so it gets a stable hash color rather than none.
export function courseColorIndex(courseKey) {
  let hash = 0;
  for (let i = 0; i < courseKey.length; i++) {
    hash = (hash * 31 + courseKey.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SCHED_COLOR_COUNT;
}

// Auto-assigned slots for the courses in the draft, as { [courseKey]: slot }.
// Each course without a manual override gets the first slot that no other
// draft course is using — an override counts as using its slot — in the
// order the courses were added. Once the palette is used up, a course gets
// the least-used slot (lowest index on ties).
//
// Stable on purpose: `prev` keeps whatever it already assigned to a course
// still in the draft, so removing or adding another course never reshuffles
// the rest. Entries for courses that left the draft are dropped (re-adding
// one assigns it afresh), and so are entries for courses that now have an
// override, so clearing the override ("Reset to auto") assigns anew. Returns
// `prev` itself when nothing changed, so callers can compare by identity.
export function nextAutoColors(prev, draftCourseKeys, overrides) {
  const kept = {};
  for (const key of draftCourseKeys) {
    if (overrides?.[key] == null && prev[key] != null) kept[key] = prev[key];
  }
  const useCount = new Array(SCHED_COLOR_COUNT).fill(0);
  for (const key of draftCourseKeys) {
    const slot = overrides?.[key] ?? kept[key];
    if (slot != null && slot < SCHED_COLOR_COUNT) useCount[slot] += 1;
  }
  for (const key of draftCourseKeys) {
    if (overrides?.[key] != null || kept[key] != null) continue;
    let slot = useCount.indexOf(0);
    if (slot === -1) slot = useCount.indexOf(Math.min(...useCount));
    kept[key] = slot;
    useCount[slot] += 1;
  }
  const sameAsPrev = Object.keys(kept).length === Object.keys(prev).length
    && Object.keys(kept).every((key) => prev[key] === kept[key]);
  return sameAsPrev ? prev : kept;
}

// `courseColors` is the resolved { [courseKey]: slot } map SchedulerPage
// builds (manual overrides win over auto-assigned slots); every
// color-consuming call site goes through this so none can skip the lookup.
export function resolvedCourseColorIndex(courseKey, courseColors) {
  const slot = courseColors?.[courseKey];
  return slot != null ? slot : courseColorIndex(courseKey);
}
