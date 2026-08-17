// Stable per-course color for the weekly grid — a pure hash of courseKey
// rather than assignment order, so the same course is always the same color
// across renders/reloads/generated-schedule switches without needing to
// persist a courseKey->color map anywhere. Palette values themselves live in
// scheduler.css (.sched-color-0..N) so light/dark theming stays in CSS.
export const SCHED_COLOR_COUNT = 10;

export function courseColorIndex(courseKey) {
  let hash = 0;
  for (let i = 0; i < courseKey.length; i++) {
    hash = (hash * 31 + courseKey.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SCHED_COLOR_COUNT;
}

// The hash above is just the default — a student can override it per course
// (see WeeklyGrid's legend + SchedulerPage's courseColorOverrides, persisted
// to localStorage). `overrides` is a plain { [courseKey]: paletteIndex }
// map; every color-consuming call site should go through this instead of
// calling courseColorIndex directly, so an override is never missed.
export function resolvedCourseColorIndex(courseKey, overrides) {
  const override = overrides?.[courseKey];
  return override != null ? override : courseColorIndex(courseKey);
}
