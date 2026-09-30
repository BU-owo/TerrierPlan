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
//
// The same arrays can also hold a free-text planning placeholder — a "note"
// entry, { kind: 'note', id, text, credits } (e.g. "Economics Elective" or
// "MA123 or MA121"). A note is NOT a course: it has no courseKey, so
// entryCourseKey returns null for it and every key-collecting path must skip
// that null. Its credits count toward column/plan credit totals only — never
// HUB, requirements, or offering warnings. Entries without a `kind` are
// courses, unchanged.
export const DEFAULT_NOTE_CREDITS = 4;

export function isNoteEntry(entry) {
  return entry != null && typeof entry === 'object' && entry.kind === 'note';
}

export function createNoteEntry() {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { kind: 'note', id, text: '', credits: DEFAULT_NOTE_CREDITS };
}

function normalizeNoteCredits(credits) {
  const value = Number(credits);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_NOTE_CREDITS;
}

export function normalizeCourseEntry(entry) {
  if (typeof entry === 'string') {
    return { courseKey: entry, locked: false, source: 'manual' };
  }
  if (isNoteEntry(entry)) {
    return {
      kind: 'note',
      id: entry.id != null ? String(entry.id) : createNoteEntry().id,
      text: typeof entry.text === 'string' ? entry.text : '',
      credits: normalizeNoteCredits(entry.credits),
    };
  }
  return {
    courseKey: entry.courseKey,
    locked: entry.locked ?? false,
    source: entry.source ?? 'manual',
  };
}

// null for note entries — callers collecting keys must filter it out.
export function entryCourseKey(entry) {
  if (typeof entry === 'string') return entry;
  if (isNoteEntry(entry)) return null;
  return entry.courseKey;
}

// Every non-null courseKey in a list of entries (notes skipped).
export function entriesCourseKeys(entries) {
  return (entries || []).map(entryCourseKey).filter((key) => key != null);
}

// Sum of the note entries' own credits in a list of entries.
export function entriesNoteCredits(entries) {
  return (entries || []).reduce(
    (sum, entry) => (isNoteEntry(entry) ? sum + normalizeNoteCredits(entry.credits) : sum),
    0,
  );
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
