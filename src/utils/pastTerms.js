// Pure helpers for the start-term rules (see getSlotStatus in courseEntry.js):
// the reserved, unused incompleteCourseKeys profile field (load/merge only)
// and what a new plan copies from the open one.
import { getTermStatus } from './courseEntry.js';
import { termForDate } from './term.js';

// A stored incompleteCourseKeys list: its non-empty strings, else [].
export function normalizeIncompleteCourseKeys(value) {
  return Array.isArray(value) ? value.filter((key) => typeof key === 'string' && key !== '') : [];
}

// Guest → account profile merge: the union of both lists.
export function mergeIncompleteCourseKeys(accountValue, localValue) {
  return Array.from(new Set([
    ...normalizeIncompleteCourseKeys(accountValue),
    ...normalizeIncompleteCourseKeys(localValue),
  ]));
}

// Same within-year order as transcriptMapping's termSortKey.
const EXTRA_SEASON_ORDER = { spring: 0, summer: 1, fall: 2, winter: 3 };
const DATE_SEASON_ORDER = { 1: 0, 5: 1, 8: 2 };

// An extraTerms entry ({ term: "Fall 2020", ... }) is past when its term
// comes before today's. One whose label can't be read counts as past, the
// same as lockStatusMap treats every extraTerms course.
function extraTermIsPast(extraTerm, today) {
  const m = /^(Spring|Summer|Fall|Winter)\s+(\d{4})$/i.exec(String(extraTerm?.term ?? '').trim());
  const todayCode = termForDate(today);
  if (!m || !todayCode) return true;
  const value = Number(m[2]) * 4 + EXTRA_SEASON_ORDER[m[1].toLowerCase()];
  const todayValue = (2000 + Number(todayCode.slice(1, 3))) * 4 + DATE_SEASON_ORDER[todayCode[3]];
  return value < todayValue;
}

// What "New plan" copies from the open plan once a startTerm is set: every
// entry (courses, placeholders, Marine marker) of each derived-past or
// current slot, past/current non-empty Summer columns, and past extraTerms.
// Future slots start empty; the grid keeps the open plan's length. null
// when there is nothing to copy (or no valid startTerm).
export function pastTermsSeed({ semesters = [], gridSummerTerms = {}, extraTerms = [] }, { startTerm, today }) {
  const copySlot = (target) => {
    const status = getTermStatus(target, startTerm, today);
    return status === 'past' || status === 'current';
  };
  const seedSemesters = semesters.map((entries, i) => (copySlot(i) ? [...(entries || [])] : []));
  const seedGridSummerTerms = Object.fromEntries(
    Object.entries(gridSummerTerms)
      .filter(([year, entries]) => (entries || []).length > 0 && copySlot(`summer:${year}`))
      .map(([year, entries]) => [year, [...entries]]),
  );
  const seedExtraTerms = extraTerms
    .filter((term) => (term?.courseKeys || []).length > 0 && extraTermIsPast(term, today))
    .map((term) => ({ ...term, courseKeys: [...term.courseKeys] }));
  const hasAny = seedSemesters.some((entries) => entries.length > 0)
    || Object.keys(seedGridSummerTerms).length > 0
    || seedExtraTerms.length > 0;
  return hasAny ? { semesters: seedSemesters, gridSummerTerms: seedGridSummerTerms, extraTerms: seedExtraTerms } : null;
}
