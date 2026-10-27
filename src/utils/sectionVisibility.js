// Sections students never see: cancelled ones, and ones BU has stopped
// enrolling. One rule for the scheduler, the course info panel and the static
// catalog export. scripts/export-catalog.cjs keeps its own copy of this set
// (it can't import an ES module), so keep the two in sync.
export const HIDDEN_CLASS_STATS = new Set(['Cancelled', 'Stop Enrl']);

export function isVisibleSection(section) {
  return !HIDDEN_CLASS_STATS.has(String(section?.classStat ?? '').trim());
}
