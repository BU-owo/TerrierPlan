import { matchesFilters } from './sectionFilters';

// Why a section-swap candidate isn't part of the student's normal picks —
// the swap UI shows every section, and these only label/style the ones that
// wouldn't otherwise be in play. `poolIds` is the draft's checked-or-locked
// ids for the slot. Eliminating a section just removes it from that pool
// (there's no separate "eliminated" state), so "not selected" covers both an
// unchecked section and an eliminated one. A candidate can have both reasons.
export function swapGhostReasons(section, poolIds, globalTimeFilter) {
  const reasons = [];
  if (!poolIds.has(section.id)) {
    reasons.push({ key: 'unpicked', label: 'Not selected', text: 'Not selected (unchecked or eliminated)' });
  }
  if (!matchesFilters(section, globalTimeFilter)) {
    reasons.push({ key: 'filtered', label: 'Outside time filter', text: 'Outside time filter' });
  }
  return reasons;
}
