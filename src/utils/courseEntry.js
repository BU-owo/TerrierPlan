// A course entry in the main semester grid (or a per-year summer slot) is
// { courseKey, locked, source: 'manual' | 'transcript' }. Older plan docs —
// and any plan written before this field existed — store plain courseKey
// strings instead. Every read path normalizes through here so the rest of
// the app never has to branch on shape; there's no migration script, this
// is the "tolerant read."
//
// `locked`/`source` are legacy: whether a course is actually locked is now
// decided by the student-level `completedCourseKeys` list (see PlannerPage),
// not by anything stored per-entry, so these two fields are normalized for
// shape-compatibility only and otherwise ignored.
export function normalizeCourseEntry(entry) {
  if (typeof entry === 'string') {
    return { courseKey: entry, locked: false, source: 'manual' };
  }
  return {
    courseKey: entry.courseKey,
    locked: entry.locked ?? false,
    source: entry.source ?? 'manual',
  };
}

export function entryCourseKey(entry) {
  return typeof entry === 'string' ? entry : entry.courseKey;
}

export function normalizeSemesters(raw) {
  return (raw || []).map((sem) => (sem || []).map(normalizeCourseEntry));
}

// gridSummerTerms: { [year]: courseEntry[] } — a plain object keyed by
// 0-based year index, so it needs no array<->object Firestore conversion
// (unlike `semesters`, see semestersToFirestore/semestersFromFirestore).
// Key presence (even an empty array) means that year's Summer column is
// toggled on.
export function normalizeGridSummerTerms(raw) {
  const out = {};
  for (const [year, entries] of Object.entries(raw || {})) {
    out[year] = (entries || []).map(normalizeCourseEntry);
  }
  return out;
}

// A "target" identifies a semester slot: a plain number is a grid slot index
// (Fall/Spring), the string `summer:{year}` is that year's optional Summer
// slot. Shared by every add/move/remove/lock handler in PlannerPage, and by
// the current-semester tracking below, so both slot kinds go through one
// code path.
export function isSummerTarget(target) {
  return typeof target === 'string' && target.startsWith('summer:');
}

export function summerYearFromTarget(target) {
  return target.slice('summer:'.length);
}

// Chronological ordering value for a target, so a grid slot and a Summer
// slot can be compared on one timeline: Fall(y) < Spring(y) < Summer(y) <
// Fall(y+1) < ... (a year's Summer term comes after that year's Spring, not
// before its own Fall).
export function targetChronoValue(target) {
  if (isSummerTarget(target)) {
    return Number(summerYearFromTarget(target)) * 3 + 2;
  }
  const index = Number(target);
  return Math.floor(index / 2) * 3 + (index % 2);
}

// Where a semester slot sits relative to the student-designated "current"
// semester — 'past' | 'current' | 'upcoming', or null if no current
// semester has been set. Purely informational (drives the status badge in
// SemesterColumn) — a slot going 'past' also triggers a one-time auto-lock
// of its courses in PlannerPage's handleSetCurrentSemester, but the courses
// stay ordinary, individually-lockable cards after that.
export function getSemesterStatus(target, currentTarget) {
  if (currentTarget == null) return null;
  const value = targetChronoValue(target);
  const currentValue = targetChronoValue(currentTarget);
  if (value < currentValue) return 'past';
  if (value === currentValue) return 'current';
  return 'upcoming';
}
