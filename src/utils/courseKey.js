export function normalizeCourseKey(input) {
  return input.replace(/\s+/g, '').toUpperCase();
}

// courseKeys have no separator ("CASCS330", not "CAS CS 330") — subject is
// the leading letters, catalog number is the trailing digits. Canonical
// split used anywhere a course needs to be matched by subject/number range
// (requirementsEngine's COURSE_RANGE matching, the search panel's range
// filter) — don't reimplement this regex a second place.
export function parseCourseKey(courseKey) {
  const match = /^([A-Z]+)(\d+)$/.exec(courseKey);
  if (!match) return null;
  return { subject: match[1], number: Number(match[2]) };
}

// Search-sort only. Same split as parseCourseKey but also accepts a trailing
// letter suffix ("CASCH203P", "CASWR151E" → suffix "P"/"E"), so suffixed
// keys sort by their catalog number instead of falling to 0. Deliberately
// separate: requirements matching relies on parseCourseKey returning null
// for suffixed keys — don't use this for matching.
export function parseCourseKeyLoose(courseKey) {
  const match = /^([A-Z]+)(\d+)([A-Z]*)$/.exec(courseKey);
  if (!match) return null;
  return { subject: match[1], number: Number(match[2]), suffix: match[3] };
}

// Sort comparator for search results: catalog number ascending, then the
// unsuffixed key before its suffixed variants (CASWR151 before CASWR151E).
// Unparseable keys sort as number 0, same as before.
export function compareByCatalogNumber(a, b) {
  const pa = parseCourseKeyLoose(a.id);
  const pb = parseCourseKeyLoose(b.id);
  const diff = (pa?.number ?? 0) - (pb?.number ?? 0);
  if (diff !== 0) return diff;
  const sa = pa?.suffix ?? '';
  const sb = pb?.suffix ?? '';
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

// courseKey convention throughout the app is school+dept+number with no
// spaces (e.g. "CASMA123") — shared by ExternalCreditsPanel's display
// formatter and the manual-override / BU-equivalent format validation.
export const COURSE_KEY_PATTERN = /^([A-Z]{3})([A-Z]{2})(\d+)$/;

// Format-only check for a manually-entered or picked courseKey — it
// deliberately doesn't check the key is a *real* BU course, only that it
// looks like one (three-letter school + two-letter dept + course number).
export function isValidCourseKeyFormat(rawValue) {
  return COURSE_KEY_PATTERN.test(String(rawValue).replace(/\s+/g, '').toUpperCase());
}
