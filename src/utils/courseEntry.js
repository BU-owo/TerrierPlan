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
// A "block" — a whole term placed by a program (blockType 'marine' = the
// Marine Semester) — is stored as a placeholder plus a `blockType`:
// { kind: 'note', id, text, credits, blockType }. That shape is on purpose:
// app versions that predate blocks read it as an ordinary placeholder
// (dropping blockType on their next save) instead of mangling it. Nothing
// creates a block yet; this file only reads and preserves it. Unknown
// blockTypes are kept. Step 1's earlier { kind: 'block', ... } shape is
// converted on read. Any other object with an unknown `kind` (written by a
// newer version of the app) is kept as-is, never turned into a course.
// None of these has a courseKey (entryCourseKey returns null). What a known
// blockType means (label, credits, seasons, exclusive...) lives in
// src/data/specialTerms.js.
import { SPECIAL_TERMS, getSpecialTerm } from '../data/specialTerms.js';

export const DEFAULT_NOTE_CREDITS = 4;

function hasBlockType(entry) {
  return typeof entry.blockType === 'string' && entry.blockType !== '';
}

export function isNoteEntry(entry) {
  return entry != null && typeof entry === 'object' && entry.kind === 'note';
}

// A note with a blockType (known or unknown).
export function isBlockEntry(entry) {
  return isNoteEntry(entry) && hasBlockType(entry);
}

// A placeholder the student typed: a note without a blockType.
export function isPlainNoteEntry(entry) {
  return isNoteEntry(entry) && !hasBlockType(entry);
}

// The registry entry for a block of a known type, else null.
export function blockSpecialTerm(entry) {
  return isBlockEntry(entry) ? getSpecialTerm(entry.blockType) : null;
}

// Display name for a block or unknown-kind entry (special-term cards, plan PDF).
export function blockEntryLabel(entry) {
  return blockSpecialTerm(entry)?.label ?? 'Special term';
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
  // A known block always reads as its registry label and credits (e.g.
  // "Marine Semester", 16) — also what an older app version shows for it.
  const term = getSpecialTerm(entry.blockType);
  if (term) return { ...note, text: term.label, credits: term.credits, blockType: term.id };
  return { ...note, blockType: entry.blockType };
}

// A new block of a known type (fresh id, registry text and credits).
export function createBlockEntry(blockType) {
  return normalizeNote({ blockType });
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

// null for anything that isn't a course (notes, blocks, unknown kinds) —
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

// Sum of the plain placeholders' own credits in a list of entries. Blocks
// are summed separately by entriesBlockCredits, so nothing is counted twice.
export function entriesNoteCredits(entries) {
  return (entries || []).reduce(
    (sum, entry) => (isPlainNoteEntry(entry) ? sum + normalizeNoteCredits(entry.credits) : sum),
    0,
  );
}

// Sum of the block entries' credits (known types: the registry's credits;
// unknown types: their stored credits).
export function entriesBlockCredits(entries) {
  return (entries || []).reduce((sum, entry) => {
    if (!isBlockEntry(entry)) return sum;
    return sum + (getSpecialTerm(entry.blockType)?.credits ?? normalizeNoteCredits(entry.credits));
  }, 0);
}

// A slot's entries for display: its blocks first, then everything else, in
// their own order. Nothing is dropped — a block next to other entries
// (added by an older app version) leaves them all visible.
export function splitBlockEntries(entries) {
  const list = entries || [];
  return { blocks: list.filter(isBlockEntry), others: list.filter((entry) => !isBlockEntry(entry)) };
}

// The first block in a list of entries, or null.
export function findBlockEntry(entries) {
  return (entries || []).find(isBlockEntry) ?? null;
}

// The special term that makes this slot refuse new adds and drops (a block
// of a known, exclusive type), or null. Unknown blockTypes don't block.
export function exclusiveTermOf(entries) {
  for (const entry of entries || []) {
    const term = blockSpecialTerm(entry);
    if (term?.exclusive) return term;
  }
  return null;
}

// 'fall' | 'spring' | 'summer' for a slot target (see isSummerTarget).
export function targetSeason(target) {
  if (isSummerTarget(target)) return 'summer';
  return Number(target) % 2 === 0 ? 'fall' : 'spring';
}

// Every blockType in a plan's grid and Summer slots, one per block (for the
// requirements engine's options.blocks and per-plan limits).
export function planBlockTypes(semesters, gridSummerTerms = {}) {
  return [...(semesters || []), ...Object.values(gridSummerTerms || {})]
    .flatMap((entries) => (entries || []).filter(isBlockEntry).map((entry) => entry.blockType));
}

// Whether a block of `blockType` may be added to the slot `target` holding
// `entries`: a known type, the right season, an empty slot, and under the
// type's per-plan limit (`planTypes` from planBlockTypes).
export function canAddSpecialTerm(blockType, target, entries, planTypes) {
  const term = getSpecialTerm(blockType);
  if (!term) return false;
  if (!term.seasons.includes(targetSeason(target))) return false;
  if ((entries || []).length > 0) return false;
  return planTypes.filter((type) => type === blockType).length < term.maxPerPlan;
}

// A block an older app version turned into a plain placeholder (it dropped
// blockType on save): a plain note whose text and credits are exactly a
// special term's, alone in a slot of the right season. Returns that term so
// the UI can offer an opt-in upgrade; never upgraded automatically.
export function degradedSpecialTerm(entry, target, entries, planTypes) {
  if (!isPlainNoteEntry(entry) || (entries || []).length !== 1) return null;
  for (const term of Object.values(SPECIAL_TERMS)) {
    if (entry.text === term.label && Number(entry.credits) === term.credits
      && term.seasons.includes(targetSeason(target))
      && planTypes.filter((type) => type === term.id).length < term.maxPerPlan) {
      return term;
    }
  }
  return null;
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
