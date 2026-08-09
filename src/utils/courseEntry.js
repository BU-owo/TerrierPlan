// A course entry in the main semester grid (or a per-year summer slot) is
// { courseKey, locked, source: 'manual' | 'transcript' }. Older plan docs —
// and any plan written before this field existed — store plain courseKey
// strings instead. Every read path normalizes through here so the rest of
// the app never has to branch on shape; there's no migration script, this
// is the "tolerant read."
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
