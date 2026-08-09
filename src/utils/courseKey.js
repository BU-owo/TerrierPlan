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
