import { sectionMeeting, DAY_ORDER } from './sectionTime';

// The section picker's one filter layer: a global time filter, applied to
// every course in the draft at once (see GlobalTimeFilter.jsx). Shared
// between DraftCourseCard (which sections to actually render) and
// SchedulerPage (the "why is Generate disabled" blocker list, which needs
// to tell "hidden by the filter" apart from "never picked" — see
// filterBlockDetail below) so the two never drift out of sync on what
// "passes the filter" means.
//
// There's deliberately no per-course filter right now (professor filtering
// is getting reworked separately) — a section outside the global filter
// isn't removed from the list, just dimmed (see DraftCourseCard), so
// overriding for one specific section is just a click away.

// A day's bounds: startMin/endMin are minutes-since-midnight (or null =
// unbounded on that side); activePreset records which TIME_PRESETS entry
// (if any) produced the current startMin/endMin, purely so that preset's
// chip can show as selected — it's not used for filtering.
export const EMPTY_DAY_BOUNDS = { startMin: null, endMin: null, activePreset: null };

// mode 'same' applies `global` to every day uniformly (the common case —
// this is what most students want and is all that's shown by default).
// mode 'custom' lets each weekday in `perDay` either inherit `global`
// (null) or override it with its own bounds — see GlobalTimeFilter.jsx.
export const EMPTY_GLOBAL_FILTERS = {
  mode: 'same',
  global: { ...EMPTY_DAY_BOUNDS },
  perDay: Object.fromEntries(DAY_ORDER.map((day) => [day, null])),
};

// One-click shortcuts for the most common boundary preferences — see
// GlobalTimeFilter.jsx's preset chip row. Times are boundaries ("starts at
// or after"/"starts at or before"), not exact slot matches, so they don't
// need to line up with BU's actual (irregular) class start times.
export const TIME_PRESETS = [
  { id: 'no-mornings', label: 'No mornings', startMin: 11 * 60, endMin: null },
  { id: 'no-evenings', label: 'No evenings', startMin: null, endMin: 17 * 60 },
  { id: 'afternoons-only', label: 'Afternoons only', startMin: 12 * 60, endMin: 17 * 60 },
];

function dayBoundsActive(bounds) {
  return Boolean(bounds && (bounds.startMin != null || bounds.endMin != null));
}

function passesBounds(section, startMin, endMin) {
  const meeting = sectionMeeting(section);
  if (!meeting) return false; // no determinable time — can't match a time bound
  if (startMin != null && meeting.startMin < startMin) return false;
  if (endMin != null && meeting.startMin > endMin) return false;
  return true;
}

// Which bounds actually govern a given weekday: its own override if one's
// set (custom mode), otherwise the same-every-day bounds.
function effectiveBoundsForDay(globalFilter, day) {
  if (globalFilter.mode === 'custom' && dayBoundsActive(globalFilter.perDay[day])) {
    return globalFilter.perDay[day];
  }
  return globalFilter.global;
}

export function isGlobalFilterActive(globalFilter) {
  if (dayBoundsActive(globalFilter.global)) return true;
  if (globalFilter.mode !== 'custom') return false;
  return DAY_ORDER.some((day) => dayBoundsActive(globalFilter.perDay[day]));
}

export function passesGlobalFilter(section, globalFilter) {
  if (!isGlobalFilterActive(globalFilter)) return true;
  const meeting = sectionMeeting(section);
  if (!meeting) return false;
  // A section only has to satisfy the bound(s) that govern the day(s) it
  // actually meets on — a day with nothing configured (and no same-every-
  // day fallback) never blocks it.
  return meeting.days.every((day) => {
    const bounds = effectiveBoundsForDay(globalFilter, day);
    if (!dayBoundsActive(bounds)) return true;
    return passesBounds(section, bounds.startMin, bounds.endMin);
  });
}

export function matchesFilters(section, globalFilter) {
  return passesGlobalFilter(section, globalFilter);
}

// Whether the global filter is the reason every section in a component
// group is currently hidden — 'global' or null (either something's still
// visible, or no filter is active at all, so a missing pick is genuinely
// just "never picked," not a filtering artifact). Used only for the
// blocker-list explanation; DraftCourseCard's own rendering just needs
// matchesFilters.
export function filterBlockDetail(groupSections, globalFilter) {
  if (!groupSections || groupSections.length === 0) return null;
  if (!isGlobalFilterActive(globalFilter)) return null;
  const anyVisible = groupSections.some((s) => passesGlobalFilter(s, globalFilter));
  return anyVisible ? null : 'global';
}
