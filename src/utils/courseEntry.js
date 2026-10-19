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
//
// A Marine Semester term (see src/data/specialTerms.js and
// src/data/marineSemester.js) is made of ordinary entries: a zero-credit
// MARKER note { kind: 'note', id, text: 'Marine Semester', credits: 0,
// blockType: 'marine' } plus plain placeholders ("Marine Semester course",
// 4 credits each), and a real course replaces one placeholder. A Fall term
// is a Marine Semester term when it holds a marker or any course tagged
// ONLY. The marker keeps the note shape on purpose: app versions that
// predate it read it as an ordinary 0-credit placeholder (dropping
// blockType on their next save). Unknown blockTypes are kept as stored. Any
// other object with an unknown `kind` (written by a newer version of the
// app) is kept as-is, never turned into a course. None of these has a
// courseKey (entryCourseKey returns null).
//
// Older shapes are converted on read, at the term level (normalizeSemesters /
// normalizeGridSummerTerms, via normalizeTermEntries): the never-deployed
// { kind: 'block', blockType: 'marine' } and the 16-credit note
// { kind: 'note', blockType: 'marine', credits: 16 } both become a marker
// plus placeholders.
import { getSpecialTerm, SPECIAL_TERMS } from '../data/specialTerms.js';
import { fillsMarineSlot, isMarineResearch, marineKind, twinGroup } from '../data/marineSemester.js';

export const DEFAULT_NOTE_CREDITS = 4;
export const MARINE_BLOCK_TYPE = 'marine';

const MARINE = SPECIAL_TERMS[MARINE_BLOCK_TYPE];

function hasBlockType(entry) {
  return typeof entry.blockType === 'string' && entry.blockType !== '';
}

export function isNoteEntry(entry) {
  return entry != null && typeof entry === 'object' && entry.kind === 'note';
}

// A note with a blockType (the Marine marker, or an unknown type).
export function isBlockEntry(entry) {
  return isNoteEntry(entry) && hasBlockType(entry);
}

// A placeholder the student typed: a note without a blockType.
export function isPlainNoteEntry(entry) {
  return isNoteEntry(entry) && !hasBlockType(entry);
}

// Display name for a block or unknown-kind entry (plan PDF, TermBlockCard).
export function blockEntryLabel(entry) {
  return (isBlockEntry(entry) ? getSpecialTerm(entry.blockType)?.label : null) ?? 'Special term';
}

// A course: a plain courseKey string, or an object with no `kind`.
export function isCourseEntry(entry) {
  if (typeof entry === 'string') return true;
  return entry != null && typeof entry === 'object' && entry.kind == null;
}

function newEntryId(prefix) {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Shallow copy without undefined values (Firestore rejects a write that
// contains `undefined` anywhere).
function withoutUndefinedFields(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

export function createNoteEntry() {
  return { kind: 'note', id: newEntryId('note'), text: '', credits: DEFAULT_NOTE_CREDITS };
}

function normalizeNoteCredits(credits) {
  const value = Number(credits);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_NOTE_CREDITS;
}

function normalizeNote(entry) {
  const note = {
    kind: 'note',
    id: entry.id != null ? String(entry.id) : createNoteEntry().id,
    text: typeof entry.text === 'string' ? entry.text : '',
    credits: normalizeNoteCredits(entry.credits),
  };
  if (!hasBlockType(entry)) return note;
  // The Marine marker always reads "Marine Semester", 0 credits: whatever
  // credits it was stored with (the 16-credit WIP shape, an old tab's edit)
  // are ignored, so it can never add to a total.
  if (entry.blockType === MARINE_BLOCK_TYPE) {
    return { ...note, text: MARINE.label, credits: 0, blockType: MARINE_BLOCK_TYPE };
  }
  return { ...note, blockType: entry.blockType };
}

// A new Marine marker (fresh id).
export function createMarkerEntry() {
  return normalizeNote({ blockType: MARINE_BLOCK_TYPE });
}

// A new plain placeholder for a Marine Semester course slot.
function createMarinePlaceholder() {
  return { ...createNoteEntry(), text: MARINE.placeholderLabel, credits: MARINE.placeholderCredits };
}

export function normalizeCourseEntry(entry) {
  if (typeof entry === 'string') {
    return { courseKey: entry, locked: false, source: 'manual' };
  }
  if (isNoteEntry(entry)) return normalizeNote(entry);
  // Step 1's { kind: 'block', blockType, id, credits } -> the note shape.
  if (entry != null && typeof entry === 'object' && entry.kind === 'block') {
    const credits = Number(entry.credits);
    return normalizeNote({
      id: entry.id,
      text: 'Special term',
      credits: Number.isFinite(credits) && credits >= 0 ? credits : 0,
      blockType: entry.blockType,
    });
  }
  if (!isCourseEntry(entry)) return withoutUndefinedFields(entry);
  return {
    // Omitted rather than undefined when missing (see entryCourseKey).
    ...(entry.courseKey !== undefined ? { courseKey: entry.courseKey } : {}),
    locked: entry.locked ?? false,
    source: entry.source ?? 'manual',
  };
}

// null for anything that isn't a course (notes, markers, unknown kinds) —
// callers collecting keys must filter it out.
export function entryCourseKey(entry) {
  if (typeof entry === 'string') return entry;
  if (!isCourseEntry(entry)) return null;
  return entry.courseKey ?? null;
}

// Every non-null courseKey in a list of entries (notes skipped).
export function entriesCourseKeys(entries) {
  return (entries || []).map(entryCourseKey).filter((key) => key != null);
}

// ── Marine Semester terms ───────────────────────────────────────────────────

// The Marine marker, shape only (not season): a note with blockType 'marine',
// or a degraded one — an old tab dropped blockType, leaving a plain note
// reading exactly "Marine Semester" with 0 credits.
export function isMarker(entry) {
  if (!isNoteEntry(entry)) return false;
  if (hasBlockType(entry)) return entry.blockType === MARINE_BLOCK_TYPE;
  return entry.text === MARINE.label && Number(entry.credits) === 0;
}

// A placeholder that stands for a Marine course slot: a plain note that
// isn't the marker.
function isMarinePlaceholder(entry) {
  return isPlainNoteEntry(entry) && !isMarker(entry);
}

// 'fall' | 'spring' | 'summer' for a slot target (see isSummerTarget).
export function targetSeason(target) {
  if (isSummerTarget(target)) return 'summer';
  return Number(target) % 2 === 0 ? 'fall' : 'spring';
}

// Whether the entries of slot `slotIndex` make it a Marine Semester term:
// Fall slots only, holding a marker or any course tagged ONLY.
export function isMarineTerm(entries, slotIndex) {
  if (targetSeason(slotIndex) !== 'fall') return false;
  const list = entries || [];
  // A marker counts only with something else beside it: a Fall whose only
  // entry is the marker (the student deleted everything else) is just an
  // empty Fall. Deleted placeholders alone never end a Marine Semester.
  const markerCounts = list.some(isMarker) && list.some((entry) => !isMarker(entry));
  return markerCounts || list.some((entry) => marineKind(entryCourseKey(entry)) === 'only');
}

// A slot whose only entry is the Marine marker (a real one, or in a Fall a
// degraded one) holds nothing: returns [] for it, else the entries as they
// are. Used on read (normalizeTermEntries) and after a deletion, so the
// marker disappears on the next save.
export function dropLoneMarker(entries, slotIndex) {
  const list = entries || [];
  if (list.length !== 1 || !isMarker(list[0])) return list;
  const real = hasBlockType(list[0]);
  return real || (slotIndex !== undefined && targetSeason(slotIndex) === 'fall') ? [] : list;
}

// A marker outside a Fall slot: ignored for term purposes, flagged so the UI
// can show a warning badge.
export function hasMisplacedMarker(entries, slotIndex) {
  return targetSeason(slotIndex) !== 'fall' && (entries || []).some(isMarker);
}

// { courses, placeholders }: the term's filled course slots (pool or research
// courses; cross-listed twins fill one slot between them, matching how the
// tracker counts them) and its remaining placeholder slots.
export function marineSlotCounts(entries) {
  const list = entries || [];
  const groups = new Set(
    list
      .map((entry) => entryCourseKey(entry))
      .filter((key) => key != null && fillsMarineSlot(key))
      .map((key) => twinGroup(key)[0]),
  );
  return { courses: groups.size, placeholders: list.filter(isMarinePlaceholder).length };
}

// True when a course of `courseKey` would fill a slot of the term holding
// `entries`: a slot course whose twin isn't already in it.
function takesMarineSlot(entries, courseKey) {
  return fillsMarineSlot(courseKey)
    && !twinGroup(courseKey).some((twin) => twin !== courseKey && (entries || []).some((e) => entryCourseKey(e) === twin));
}

// A Marine Semester term holding a course that doesn't belong in it (no
// Marine tag: a mixed term, from an import, a PDF or an old tab). Shown with
// a plain inline warning; nothing is hidden, moved or removed.
export function isMixedMarineTerm(entries, slotIndex) {
  return isMarineTerm(entries, slotIndex)
    && (entries || []).some((entry) => {
      const key = entryCourseKey(entry);
      return key != null && marineKind(key) === null;
    });
}

// A course tagged ONLY that sits outside a Marine Semester term (a Spring or
// Summer, from an import or an old tab): gets a small warning badge.
export function isOnlyCourseOutsideMarine(courseKey, entries, slotIndex) {
  return marineKind(courseKey) === 'only' && !isMarineTerm(entries, slotIndex);
}

// Remaining slots for the requirements tracker: the term's placeholders plus
// its research-in-lieu courses (a pool course counts through the pool).
// 0 for anything that isn't a Marine Semester term.
export function marineTrackerSlots(entries, slotIndex) {
  if (!isMarineTerm(entries, slotIndex)) return 0;
  const list = entries || [];
  return list.filter(isMarinePlaceholder).length
    + list.filter((entry) => isMarineResearch(entryCourseKey(entry))).length;
}

// Credits of a Marine term's placeholders (0 when the slot isn't a Marine
// term) — the part of a past term that counts as completed.
export function marinePlaceholderCredits(entries, slotIndex) {
  if (!isMarineTerm(entries, slotIndex)) return 0;
  return (entries || []).reduce(
    (sum, entry) => (isMarinePlaceholder(entry) ? sum + normalizeNoteCredits(entry.credits) : sum),
    0,
  );
}

// A fresh Marine Semester term: the marker plus placeholders.
export function createMarineTerm() {
  return [createMarkerEntry(), ...Array.from({ length: MARINE.slots }, createMarinePlaceholder)];
}

// Adds the placeholders a converted legacy marker needs: right after the
// first marker, MARINE.slots minus the courses already filling slots — but
// none when the term already has placeholders (an old tab rewrote a new
// marker). Returns a new list.
export function withMarinePlaceholders(entries) {
  const list = entries || [];
  const markerIndex = list.findIndex(isMarker);
  if (markerIndex === -1 || list.some(isMarinePlaceholder)) return [...list];
  const need = Math.max(0, MARINE.slots - marineSlotCounts(list).courses);
  const placeholders = Array.from({ length: need }, createMarinePlaceholder);
  return [...list.slice(0, markerIndex + 1), ...placeholders, ...list.slice(markerIndex + 1)];
}

// A pre-redesign Marine block in raw (unnormalized) stored form: Step 1's
// { kind: 'block' } or the 16-credit note.
function isLegacyMarineBlock(raw) {
  if (raw == null || typeof raw !== 'object') return false;
  if (raw.kind === 'block') return raw.blockType === MARINE_BLOCK_TYPE;
  return raw.kind === 'note' && raw.blockType === MARINE_BLOCK_TYPE && Number(raw.credits) > 0;
}

// One slot's raw stored entries -> normalized entries, converting a legacy
// Marine block into a marker plus placeholders. A second legacy block in the
// same slot, or one beside an already-current marker, is dropped (it holds
// no student content).
export function normalizeTermEntries(raw, slotIndex) {
  const list = raw || [];
  const hasCurrentMarker = list.some((entry) => isNoteEntry(entry) && entry.blockType === MARINE_BLOCK_TYPE && !isLegacyMarineBlock(entry));
  let sawLegacy = false;
  const entries = [];
  for (const entry of list) {
    if (isLegacyMarineBlock(entry)) {
      if (sawLegacy || hasCurrentMarker) continue;
      sawLegacy = true;
    }
    entries.push(normalizeCourseEntry(entry));
  }
  return dropLoneMarker(sawLegacy ? withMarinePlaceholders(entries) : entries, slotIndex);
}

// Sum of the notes' own credits in a list of entries: plain placeholders and
// unknown-blockType notes, as stored. The Marine marker never adds credits
// (even if an unnormalized one still carries 16). Courses are not counted.
export function entriesNoteCredits(entries) {
  return (entries || []).reduce(
    (sum, entry) => (isNoteEntry(entry) && !(hasBlockType(entry) && isMarker(entry))
      ? sum + normalizeNoteCredits(entry.credits)
      : sum),
    0,
  );
}

// Starts a Marine Semester in a Fall slot with no courses: its plain
// placeholders are replaced by the new term (marker + placeholders); other
// entries (unknown kinds) are kept after it. Returns { entries, replaced }
// (`replaced`: how many plain placeholders it replaced), or null when the
// slot has a course.
export function startMarineTerm(entries) {
  const list = entries || [];
  if (list.some((entry) => entryCourseKey(entry) != null)) return null;
  const kept = list.filter((entry) => !isPlainNoteEntry(entry) && !isMarker(entry));
  return { entries: [...createMarineTerm(), ...kept], replaced: list.length - kept.length };
}

// Places a course in slot `slotIndex` holding `entries`. `course` is a
// courseKey or an existing course entry (a move keeps it as it is). Returns
//   { ok: true, entries, created, replaced, intoMarine }
//       created: a Marine Semester was started (replaced: how many plain
//       placeholders it replaced); intoMarine: the course went into an
//       existing Marine term
//   { ok: false, reason }   — 'not-fall' | 'non-empty-fall' | 'full' |
//                             'untagged-in-marine' (see MARINE_MESSAGES)
// Rules: a course tagged ONLY goes only into an empty Fall (no courses) or a
// Marine term with room, otherwise it is refused; a course with no tag can't
// go into a Marine term; ALSO and research courses have no rule. A pool or
// research course in a Marine term replaces a placeholder (appended when none
// is left), up to the term's four slots; its cross-listed twin takes no second
// slot. Nothing already in the slot is dropped, except the plain placeholders
// a new Marine Semester replaces.
export function placeCourse(entries, course, slotIndex) {
  const list = entries || [];
  const entry = typeof course === 'string' ? normalizeCourseEntry(course) : course;
  const key = entryCourseKey(entry);
  const kind = marineKind(key);
  const fall = targetSeason(slotIndex) === 'fall';
  const done = (next, extra = {}) => ({ ok: true, entries: next, created: false, replaced: 0, intoMarine: false, ...extra });

  if (kind === 'only' && !fall) return { ok: false, reason: 'not-fall' };

  if (fall && isMarineTerm(list, slotIndex)) {
    if (kind === null) return { ok: false, reason: 'untagged-in-marine' };
    if (!takesMarineSlot(list, key)) return done([...list, entry], { intoMarine: true });
    if (marineSlotCounts(list).courses >= MARINE.slots) return { ok: false, reason: 'full' };
    const preferred = list.findIndex((e) => isMarinePlaceholder(e) && e.text === MARINE.placeholderLabel);
    const fillAt = preferred !== -1 ? preferred : list.findIndex(isMarinePlaceholder);
    if (fillAt === -1) return done([...list, entry], { intoMarine: true });
    return done(list.map((e, i) => (i === fillAt ? entry : e)), { intoMarine: true });
  }

  if (kind === 'only') {
    const started = startMarineTerm(list);
    if (!started) return { ok: false, reason: 'non-empty-fall' };
    // Marker, the course in the first placeholder's place, then the rest.
    const [marker, ...rest] = started.entries;
    const [, ...placeholders] = rest.filter(isMarinePlaceholder);
    const others = rest.filter((e) => !isMarinePlaceholder(e));
    return done([marker, entry, ...placeholders, ...others], { created: true, replaced: started.replaced });
  }

  return done([...list, entry]);
}

// Transcript import: adds one imported course entry to slot `slotIndex`. In
// a Marine Semester term the student already planned it replaces a
// placeholder (placeCourse), so credits never double count; anywhere else —
// no Marine term yet, or placeCourse would refuse — it is simply appended: an
// import never drops, skips or moves a course, and a Fall that gets Marine
// courses derives as a Marine Semester from their tags. Returns a new list.
export function placeImportedCourse(entries, entry, slotIndex) {
  const list = entries || [];
  if (isMarineTerm(list, slotIndex)) {
    const placed = placeCourse(list, entry, slotIndex);
    if (placed.ok) return placed.entries;
  }
  return [...list, entry];
}

// "Remove Marine Semester": drops the marker and the plain placeholders; real
// courses and any other entries stay exactly as they are. In a slot that
// isn't a Marine term (a stray marker in a Spring), only the marker goes —
// that slot's placeholders are the student's own. Returns { entries, courses }
// (`courses`: how many real courses stay).
export function removeMarineSemester(entries, slotIndex) {
  const list = entries || [];
  const placeholdersToo = slotIndex === undefined || isMarineTerm(list, slotIndex);
  const next = list.filter((entry) => !isMarker(entry) && !(placeholdersToo && isPlainNoteEntry(entry)));
  return { entries: next, courses: next.filter((entry) => entryCourseKey(entry) != null).length };
}

// Removes a course (by courseKey) from slot `slotIndex`. In a Marine term,
// a slot-filling course that leaves gives its place back as a placeholder
// when the term would otherwise drop below four slots (and is still a
// Marine term). Everything else is untouched.
export function removeCourse(entries, courseKey, slotIndex) {
  const list = entries || [];
  const index = list.findIndex((entry) => entryCourseKey(entry) === courseKey);
  if (index === -1) return [...list];
  const wasMarine = isMarineTerm(list, slotIndex);
  const next = dropLoneMarker(list.filter((_, i) => i !== index), slotIndex);
  if (!wasMarine || !fillsMarineSlot(courseKey) || !isMarineTerm(next, slotIndex)) return next;
  // Its twin still holds the slot: nothing to give back.
  if (twinGroup(courseKey).some((twin) => twin !== courseKey && next.some((e) => entryCourseKey(e) === twin))) return next;
  const { courses, placeholders } = marineSlotCounts(next);
  if (courses + placeholders >= MARINE.slots) return next;
  return [...next.slice(0, index), createMarinePlaceholder(), ...next.slice(index)];
}

// Every read path normalizes a slot through normalizeTermEntries, so a legacy
// Marine block expands to a marker plus placeholders here and nowhere else.
export function normalizeSemesters(raw) {
  return (raw || []).map((sem, i) => normalizeTermEntries(sem, i));
}

// gridSummerTerms: { [year]: courseEntry[] } — a plain object keyed by
// 0-based year index, so it needs no array<->object Firestore conversion
// (unlike `semesters`, see semestersToFirestore/semestersFromFirestore).
// Key presence (even an empty array) means that year's Summer column is
// toggled on.
export function normalizeGridSummerTerms(raw) {
  const out = {};
  for (const [year, entries] of Object.entries(raw || {})) {
    out[year] = normalizeTermEntries(entries, `summer:${year}`);
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
