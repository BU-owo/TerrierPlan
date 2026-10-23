// Run with: node --test src/utils/courseEntry.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCourseEntry,
  normalizeSemesters,
  normalizeGridSummerTerms,
  entryCourseKey,
  entriesCourseKeys,
  entriesNoteCredits,
  isBlockEntry,
  isCourseEntry,
  isNoteEntry,
  isPlainNoteEntry,
  blockEntryLabel,
  isMarker,
  isMarineTerm,
  hasMisplacedMarker,
  createMarineTerm,
  createMarkerEntry,
  placeCourse,
  removeCourse,
  marineSlotCounts,
  marineTrackerSlots,
  marinePlaceholderCredits,
  targetSeason,
  startMarineTerm,
  dropLoneMarker,
  removeMarineSemester,
  isMixedMarineTerm,
  isOnlyCourseOutsideMarine,
} from './courseEntry.js';
import { SPECIAL_TERMS, getSpecialTerm, placementMessage, CONFIRMATION_REASONS } from '../data/specialTerms.js';
import { matchesMarineQuery, marinePoolRows } from '../data/marineSemester.js';

// Firestore rejects a write with `undefined` anywhere in it.
function hasUndefined(value) {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefined);
  if (value && typeof value === 'object') return Object.values(value).some(hasUndefined);
  return false;
}

const marker = { kind: 'note', id: 'm1', text: 'Marine Semester', credits: 0, blockType: 'marine' };
const ph = (id = 'p', text = 'Marine Semester course', credits = 4) => ({ kind: 'note', id, text, credits });
const course = (courseKey) => ({ courseKey, locked: false, source: 'manual' });
// Fall slots are even indexes, Spring odd.
const FALL = 0;
const SPRING = 1;

test('courses and placeholders normalize as before', () => {
  assert.deepEqual(normalizeCourseEntry('CASCS111'), { courseKey: 'CASCS111', locked: false, source: 'manual' });
  assert.deepEqual(
    normalizeCourseEntry({ courseKey: 'CASCS111', locked: true, source: 'transcript' }),
    { courseKey: 'CASCS111', locked: true, source: 'transcript' },
  );
  assert.deepEqual(
    normalizeCourseEntry({ kind: 'note', id: 'n1', text: 'Elective', credits: 2 }),
    { kind: 'note', id: 'n1', text: 'Elective', credits: 2 },
  );
});

test('the Marine marker is preserved and always reads "Marine Semester", 0 credits', () => {
  assert.deepEqual(normalizeCourseEntry(marker), marker);
  const out = normalizeCourseEntry({ ...marker, text: 'edited', credits: 16 });
  assert.equal(out.text, 'Marine Semester');
  assert.equal(out.credits, 0);
  const bare = normalizeCourseEntry({ kind: 'note', blockType: 'marine' });
  assert.equal(bare.credits, 0);
  assert.equal(typeof bare.id, 'string');
  assert.ok(bare.id.length > 0);
  assert.ok(!hasUndefined(bare));
  assert.equal(isBlockEntry(out), true);
  assert.equal(isMarker(out), true);
});

test('an unknown blockType is kept, with the note text and credits as stored', () => {
  const out = normalizeCourseEntry({ kind: 'note', id: 'f', text: 'Field camp', credits: 12, blockType: 'field' });
  assert.deepEqual(out, { kind: 'note', id: 'f', text: 'Field camp', credits: 12, blockType: 'field' });
  assert.equal(isBlockEntry(out), true);
  assert.equal(isMarker(out), false);
  assert.equal(blockEntryLabel(out), 'Special term');
  assert.equal(blockEntryLabel({ kind: 'future' }), 'Special term');
  // Its credits still count (once), like a placeholder's.
  assert.equal(entriesNoteCredits([out]), 12);
});

test('an empty or non-string blockType is a plain placeholder', () => {
  for (const blockType of ['', 5, null, undefined]) {
    const out = normalizeCourseEntry({ kind: 'note', id: 'n', text: 'x', credits: 4, blockType });
    assert.deepEqual(out, { kind: 'note', id: 'n', text: 'x', credits: 4 });
    assert.equal(isPlainNoteEntry(out), true);
  }
});

test('an unknown kind is kept as-is, never turned into a course', () => {
  const future = { kind: 'study-abroad', id: 'x', term: 'Fall 2027', nested: { a: 1 } };
  const out = normalizeCourseEntry(future);
  assert.deepEqual(out, future);
  assert.ok(!('courseKey' in out));
  assert.ok(!('locked' in out));
  assert.deepEqual(normalizeCourseEntry({ kind: 'x', drop: undefined }), { kind: 'x' });
});

test('a course object without a courseKey gets no undefined courseKey', () => {
  const out = normalizeCourseEntry({ locked: false, source: 'manual' });
  assert.ok(!('courseKey' in out));
  assert.ok(!hasUndefined(out));
  assert.equal(entryCourseKey(out), null);
});

test('type checks', () => {
  const note = { kind: 'note', id: 'n', text: '', credits: 4 };
  const other = { kind: 'other' };
  assert.equal(isCourseEntry('CASCS111'), true);
  assert.equal(isCourseEntry({ courseKey: 'CASCS111' }), true);
  assert.equal(isCourseEntry(marker), false);
  assert.equal(isCourseEntry(note), false);
  assert.equal(isCourseEntry(other), false);
  assert.equal(isCourseEntry(null), false);
  assert.equal(isBlockEntry(marker), true);
  assert.equal(isBlockEntry(note), false);
  assert.equal(isBlockEntry('CASCS111'), false);
  assert.equal(isNoteEntry(marker), true);
  assert.equal(isPlainNoteEntry(marker), false);
  assert.equal(isPlainNoteEntry(note), true);
  assert.equal(blockEntryLabel(marker), 'Marine Semester');
  assert.equal(blockEntryLabel(other), 'Special term');
});

test('markers, unknown kinds and notes have no courseKey; the marker adds no credits', () => {
  const entries = [
    'CASCS111',
    marker,
    { kind: 'other', courseKey: 'CASCS999' },
    { kind: 'note', id: 'n', text: '', credits: 4 },
  ];
  assert.deepEqual(entries.map(entryCourseKey), ['CASCS111', null, null, null]);
  assert.deepEqual(entriesCourseKeys(entries), ['CASCS111']);
  assert.equal(entriesNoteCredits(entries), 4);
  // Even an unnormalized marker still carrying 16 never adds credits.
  assert.equal(entriesNoteCredits([{ ...marker, credits: 16 }]), 0);
});

test('semesters and Summer slots carry a marker through with no undefined anywhere', () => {
  const raw = [
    [marker, ph()],
    ['CASCS111', { kind: 'unknown-thing', id: 'u' }],
  ];
  const semesters = normalizeSemesters(raw);
  assert.deepEqual(semesters[0], [marker, ph()]);
  assert.deepEqual(semesters[1][1], { kind: 'unknown-thing', id: 'u' });
  assert.ok(!hasUndefined(semesters));
  // A second pass (e.g. load after save) changes nothing.
  assert.deepEqual(normalizeSemesters(JSON.parse(JSON.stringify(semesters))), semesters);
});

// ── Registry and messages (src/data/specialTerms.js) ────────────────────────

test('registry: the Marine Semester entry, unknown types are null', () => {
  assert.deepEqual(SPECIAL_TERMS.marine, {
    id: 'marine',
    label: 'Marine Semester',
    placeholderLabel: 'Marine Semester course',
    placeholderCredits: 4,
    slots: 4,
    seasons: ['fall'],
  });
  for (const [key, term] of Object.entries(SPECIAL_TERMS)) assert.equal(term.id, key);
  assert.equal(getSpecialTerm('marine'), SPECIAL_TERMS.marine);
  assert.equal(getSpecialTerm('field'), null);
  assert.equal(getSpecialTerm('toString'), null);
  assert.equal(getSpecialTerm(undefined), null);
});

test('toast messages: the four refusals and the two confirmations', () => {
  assert.equal(placementMessage('not-fall'), 'Marine Semester courses are only offered in the fall.');
  assert.equal(
    placementMessage('non-empty-fall'),
    'This term already has other courses. The Marine Semester fills the whole term, so use an empty Fall.',
  );
  assert.equal(placementMessage('untagged-in-marine'), 'The Marine Semester fills the whole term.');
  assert.equal(typeof placementMessage('full'), 'string');
  assert.equal(placementMessage('added'), 'Added to your Marine Semester');
  assert.equal(placementMessage('created', 'Year 2 – Fall'), 'Marine Semester created in Year 2 – Fall');
  assert.equal(placementMessage('created', 'Year 2 – Fall', 0), 'Marine Semester created in Year 2 – Fall');
  assert.equal(placementMessage('created', 'Year 2 – Fall', 1), 'Marine Semester created in Year 2 – Fall; replaced 1 placeholder');
  assert.equal(placementMessage('created', 'Year 2 – Fall', 3), 'Marine Semester created in Year 2 – Fall; replaced 3 placeholders');
  assert.deepEqual(CONFIRMATION_REASONS, ['added', 'created']);
  assert.equal(placementMessage('toString'), null);
  assert.equal(placementMessage('nope'), null);
});

// ── Marine Semester terms ───────────────────────────────────────────────────

test('targetSeason', () => {
  assert.deepEqual([0, 1, 2, 3, 'summer:0'].map(targetSeason), ['fall', 'spring', 'fall', 'spring', 'summer']);
});

test('createMarineTerm: a marker plus four 4-credit placeholders, fresh ids', () => {
  const term = createMarineTerm();
  assert.equal(term.length, 5);
  assert.ok(isMarker(term[0]));
  assert.equal(term[0].credits, 0);
  assert.deepEqual(term.slice(1).map((e) => [e.text, e.credits, isPlainNoteEntry(e)]), Array(4).fill(['Marine Semester course', 4, true]));
  assert.equal(new Set(term.map((e) => e.id)).size, 5);
  assert.ok(!hasUndefined(term));
  assert.equal(entriesNoteCredits(term), 16);
  assert.notEqual(createMarkerEntry().id, createMarkerEntry().id);
});

test('isMarineTerm: Fall only; a marker or an ONLY course makes one', () => {
  assert.equal(isMarineTerm([marker, ph()], FALL), true);
  assert.equal(isMarineTerm([course('CASBI511')], FALL), true, 'ONLY course');
  assert.equal(isMarineTerm(['CASBI511'], 2), true, 'plain key string');
  assert.equal(isMarineTerm([marker, ph()], SPRING), false);
  assert.equal(isMarineTerm([course('CASBI511')], SPRING), false);
  assert.equal(isMarineTerm([marker, ph()], 'summer:0'), false);
  assert.equal(isMarineTerm([course('CASEE557'), course('CASCS111')], FALL), false, 'ALSO course');
  assert.equal(isMarineTerm([ph()], FALL), false, 'placeholders alone');
  assert.equal(isMarineTerm([], FALL), false);
  assert.equal(isMarineTerm(undefined, FALL), false);
});

test('a degraded marker (old tab dropped blockType) still counts, in a Fall', () => {
  const degraded = { kind: 'note', id: 'd', text: 'Marine Semester', credits: 0 };
  assert.equal(isMarker(degraded), true);
  assert.equal(isMarineTerm([degraded, ph()], FALL), true);
  assert.equal(isMarineTerm([degraded], SPRING), false);
  // Not a degraded marker: wrong credits or wrong text.
  assert.equal(isMarker({ ...degraded, credits: 4 }), false);
  assert.equal(isMarker({ ...degraded, text: 'marine semester' }), false);
  assert.equal(isMarker({ kind: 'note', id: 'x', text: 'Elective', credits: 0 }), false);
  // It is not counted as a placeholder slot.
  assert.deepEqual(marineSlotCounts([degraded, ph()]), { courses: 0, placeholders: 1 });
});

test('a marker outside a Fall slot is ignored for term purposes and flagged', () => {
  assert.equal(hasMisplacedMarker([marker], SPRING), true);
  assert.equal(hasMisplacedMarker([marker], 'summer:1'), true);
  assert.equal(hasMisplacedMarker([marker], FALL), false);
  assert.equal(hasMisplacedMarker([ph()], SPRING), false);
  assert.equal(isMarineTerm([marker, course('CASCS111')], SPRING), false);
});

// ── Legacy shapes are converted on read ─────────────────────────────────────

const markerPlusFour = (term) => {
  assert.equal(term.length, 5);
  assert.ok(isMarker(term[0]) && isBlockEntry(term[0]));
  assert.equal(term[0].credits, 0);
  for (const entry of term.slice(1)) {
    assert.deepEqual([entry.text, entry.credits, isPlainNoteEntry(entry)], ['Marine Semester course', 4, true]);
  }
};

test("step 1's { kind: 'block', blockType: 'marine' } expands to a marker plus four placeholders", () => {
  const semesters = normalizeSemesters([[{ kind: 'block', blockType: 'marine', id: 'b1', credits: 16 }]]);
  markerPlusFour(semesters[0]);
  assert.equal(semesters[0][0].id, 'b1');
  assert.equal(entriesNoteCredits(semesters[0]), 16, 'never double counted');
  assert.ok(!hasUndefined(semesters));
  // Missing id and bad credits still convert.
  markerPlusFour(normalizeSemesters([[{ kind: 'block', blockType: 'marine', credits: 'bad' }]])[0]);
});

test('the 16-credit WIP note expands to a marker plus four placeholders; credits count once', () => {
  const legacy = { kind: 'note', id: 'w1', text: 'Marine Semester', credits: 16, blockType: 'marine' };
  const term = normalizeSemesters([[legacy]])[0];
  markerPlusFour(term);
  assert.equal(entriesNoteCredits(term), 16);
  assert.equal(marinePlaceholderCredits(term, FALL), 16);
  // Normalizing again changes nothing (no second expansion).
  assert.deepEqual(normalizeSemesters([JSON.parse(JSON.stringify(term))])[0], term);
  // Summer slots expand too.
  markerPlusFour(normalizeGridSummerTerms({ 0: [legacy] })['0']);
});

test('legacy block beside courses: placeholders fill only the free slots, nothing dropped', () => {
  const legacy = { kind: 'note', id: 'w1', text: 'Marine Semester', credits: 16, blockType: 'marine' };
  const term = normalizeSemesters([[legacy, 'CASBI511', 'CASCS111']])[0];
  assert.equal(term.filter(isPlainNoteEntry).length, 3);
  assert.deepEqual(entriesCourseKeys(term), ['CASBI511', 'CASCS111']);
});

test('a stale WIP tab rewriting a current marker with 16 credits does not add more placeholders', () => {
  const rewritten = { ...marker, credits: 16 };
  const term = normalizeSemesters([[rewritten, ph('a'), ph('b')]])[0];
  assert.equal(term.length, 3);
  assert.equal(term[0].credits, 0);
  assert.equal(entriesNoteCredits(term), 8);
});

test('duplicate legacy blocks collapse to one marker term', () => {
  const legacy = { kind: 'note', id: 'w1', text: 'Marine Semester', credits: 16, blockType: 'marine' };
  const term = normalizeSemesters([[legacy, { ...legacy, id: 'w2' }, { kind: 'block', blockType: 'marine', id: 'w3' }]])[0];
  markerPlusFour(term);
});

// ── placeCourse / removeCourse ──────────────────────────────────────────────

test('an ONLY course into an empty Fall starts a Marine Semester: marker + course + 3 placeholders', () => {
  const r = placeCourse([], 'CASBI511', FALL);
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.deepEqual(r.entries.map((e) => (isMarker(e) ? 'marker' : entryCourseKey(e) ?? e.text)), [
    'marker', 'CASBI511', 'Marine Semester course', 'Marine Semester course', 'Marine Semester course',
  ]);
  assert.equal(isMarineTerm(r.entries, FALL), true);
  assert.deepEqual(marineSlotCounts(r.entries), { courses: 1, placeholders: 3 });
});

test('"empty Fall" = no courses: its plain placeholders are replaced, other entries kept', () => {
  const future = { kind: 'future', id: 'u' };
  const r = placeCourse([ph('a', 'Elective'), future, ph('b', 'Another')], 'CASBI511', FALL);
  assert.equal(r.ok, true);
  assert.equal(r.entries.some((e) => e.text === 'Elective' || e.text === 'Another'), false);
  assert.ok(r.entries.includes(future));
  assert.deepEqual(marineSlotCounts(r.entries), { courses: 1, placeholders: 3 });
});

test('an ONLY course into a Fall that has courses is refused', () => {
  assert.deepEqual(placeCourse(['CASCS111'], 'CASBI511', FALL), { ok: false, reason: 'non-empty-fall' });
  assert.deepEqual(placeCourse([course('CASEE557')], 'CASBI511', FALL), { ok: false, reason: 'non-empty-fall' });
});

test('an ONLY course anywhere but a Fall is refused', () => {
  assert.deepEqual(placeCourse([], 'CASBI511', SPRING), { ok: false, reason: 'not-fall' });
  assert.deepEqual(placeCourse([], 'CASBI511', 'summer:0'), { ok: false, reason: 'not-fall' });
  // Even in a Spring that somehow holds a marker.
  assert.deepEqual(placeCourse([marker], 'CASBI511', SPRING), { ok: false, reason: 'not-fall' });
});

test('an ONLY course replaces a placeholder in a Marine term, in place', () => {
  const term = [marker, ph('a'), ph('b'), ph('c'), ph('d')];
  const r = placeCourse(term, 'CASBI511', FALL);
  assert.equal(r.ok, true);
  assert.equal(r.created, false);
  assert.deepEqual(r.entries.map((e) => e.id ?? e.courseKey), ['m1', 'CASBI511', 'b', 'c', 'd']);
  assert.deepEqual(marineSlotCounts(r.entries), { courses: 1, placeholders: 3 });
});

test('replacement prefers the default placeholder over one the student renamed', () => {
  const term = [marker, ph('a', 'My note'), ph('b')];
  const r = placeCourse(term, 'CASBI511', FALL);
  assert.deepEqual(r.entries.map((e) => e.id ?? e.courseKey), ['m1', 'a', 'CASBI511']);
});

test('at four real courses the term is full and a fifth is refused', () => {
  let entries = createMarineTerm();
  for (const key of ['CASBI511', 'CASBI569', 'CASEE542', 'CASMR533']) {
    const r = placeCourse(entries, key, FALL);
    assert.equal(r.ok, true, key);
    entries = r.entries;
  }
  assert.deepEqual(marineSlotCounts(entries), { courses: 4, placeholders: 0 });
  assert.deepEqual(placeCourse(entries, 'CASBI593', FALL), { ok: false, reason: 'full' });
  // Never exceeds 4 slots while filling.
  assert.equal(entries.length, 5);
});

test('a research course and a pool ALSO course fill a slot in a Marine term', () => {
  for (const key of ['CASMR391', 'CASEE557', 'CASMR500']) {
    const r = placeCourse(createMarineTerm(), key, FALL);
    assert.equal(r.ok, true, key);
    assert.deepEqual(marineSlotCounts(r.entries), { courses: 1, placeholders: 3 }, key);
  }
});

test('a course with no tag cannot go into a Marine term; ALSO-only courses have no rule', () => {
  assert.deepEqual(placeCourse([marker, ph()], 'CASCS111', FALL), { ok: false, reason: 'untagged-in-marine' });
  // BI 423 is ALSO but not a pool course: allowed, and does not use a slot.
  const r = placeCourse(createMarineTerm(), 'CASBI423', FALL);
  assert.equal(r.ok, true);
  assert.deepEqual(marineSlotCounts(r.entries), { courses: 0, placeholders: 4 });
  // Anywhere else an untagged course just lands.
  assert.equal(placeCourse(['CASCS111'], 'CASMA123', FALL).ok, true);
  assert.equal(placeCourse([], 'CASCS111', SPRING).ok, true);
  assert.equal(placeCourse([], 'CASEE557', SPRING).ok, true, 'ALSO, Spring');
  assert.equal(placeCourse([], 'CASMR391', 'summer:0').ok, true, 'research, Summer');
});

test('a moved entry keeps its own fields', () => {
  const entry = { courseKey: 'CASBI511', locked: true, source: 'transcript' };
  const r = placeCourse(createMarineTerm(), entry, FALL);
  assert.ok(r.entries.includes(entry));
});

test('placeCourse never mutates its input', () => {
  const term = createMarineTerm();
  const copy = JSON.parse(JSON.stringify(term));
  placeCourse(term, 'CASBI511', FALL);
  assert.deepEqual(term, copy);
});

test('removing a real course restores a placeholder where it was; never more than four slots', () => {
  let entries = placeCourse(createMarineTerm(), 'CASBI511', FALL).entries;
  const index = entries.findIndex((e) => entryCourseKey(e) === 'CASBI511');
  const after = removeCourse(entries, 'CASBI511', FALL);
  assert.deepEqual(marineSlotCounts(after), { courses: 0, placeholders: 4 });
  assert.equal(isPlainNoteEntry(after[index]), true);
  assert.equal(after[index].text, 'Marine Semester course');
  assert.equal(after[index].credits, 4);
  // A student who deleted a placeholder: still 4 slots after the course leaves.
  entries = placeCourse([marker, ph('a'), ph('b')], 'CASBI511', FALL).entries; // 1 course + 1 placeholder
  assert.deepEqual(marineSlotCounts(removeCourse(entries, 'CASBI511', FALL)), { courses: 0, placeholders: 2 });
  // Already four slots without it (5 placeholders + course): no restore.
  const crowded = [marker, ph('a'), ph('b'), ph('c'), ph('d'), course('CASBI511')];
  assert.equal(removeCourse(crowded, 'CASBI511', FALL).length, 5);
});

test('removing a course that is not a slot course, or in a non-Marine term, adds nothing', () => {
  const term = [marker, ph('a'), course('CASBI423')];
  assert.deepEqual(removeCourse(term, 'CASBI423', FALL).map((e) => e.id ?? e.courseKey), ['m1', 'a']);
  assert.deepEqual(removeCourse(['CASCS111', 'CASMA123'], 'CASCS111', FALL), ['CASMA123']);
  assert.deepEqual(removeCourse(['CASCS111'], 'CASZZ999', FALL), ['CASCS111']);
  // The last ONLY course leaving an un-marked term makes it plain again: no placeholder.
  assert.deepEqual(removeCourse([course('CASBI511')], 'CASBI511', FALL), []);
});

test('moving in and out: add to a Marine term, remove from it, add again', () => {
  let term = createMarineTerm();
  term = placeCourse(term, 'CASBI511', FALL).entries;
  term = removeCourse(term, 'CASBI511', FALL);
  term = placeCourse(term, 'CASBI511', FALL).entries;
  assert.deepEqual(marineSlotCounts(term), { courses: 1, placeholders: 3 });
  assert.equal(term.length, 5);
});

// ── Credits ─────────────────────────────────────────────────────────────────

test('credits: a Marine term counts its placeholders once, the marker 0', () => {
  const term = createMarineTerm();
  assert.equal(entriesNoteCredits(term), 16);
  const withCourse = placeCourse(term, 'CASBI511', FALL).entries;
  assert.equal(entriesNoteCredits(withCourse), 12, 'the real course takes a placeholder with it');
});

test('marinePlaceholderCredits: only a Marine term\'s placeholders (the completed part of a past term)', () => {
  assert.equal(marinePlaceholderCredits(createMarineTerm(), FALL), 16);
  assert.equal(marinePlaceholderCredits(createMarineTerm(), SPRING), 0, 'not a Fall');
  assert.equal(marinePlaceholderCredits([ph('a', 'Elective'), ph('b')], FALL), 0, 'not a Marine term');
  assert.equal(marinePlaceholderCredits([course('CASBI511'), ph('a'), ph('b', 'x', 2)], FALL), 6);
});

test('marineTrackerSlots: placeholders plus research-in-lieu courses, Marine terms only', () => {
  assert.equal(marineTrackerSlots(createMarineTerm(), FALL), 4);
  assert.equal(marineTrackerSlots(placeCourse(createMarineTerm(), 'CASMR391', FALL).entries, FALL), 4);
  assert.equal(marineTrackerSlots(placeCourse(createMarineTerm(), 'CASBI511', FALL).entries, FALL), 3);
  assert.equal(marineTrackerSlots(createMarineTerm(), SPRING), 0);
  assert.equal(marineTrackerSlots([ph()], FALL), 0);
});

// ── Part 2: placement rules in full ─────────────────────────────────────────

test('creating a Marine Semester reports how many plain placeholders it replaced', () => {
  const r = placeCourse([ph('a', 'Elective'), ph('b', 'Other')], 'CASBI511', FALL);
  assert.equal(r.created, true);
  assert.equal(r.replaced, 2);
  assert.equal(r.intoMarine, false);
  assert.equal(placeCourse([], 'CASBI511', FALL).replaced, 0);
  // Adding to an existing Marine term is "intoMarine", not "created".
  const next = placeCourse(r.entries, 'CASBI569', FALL);
  assert.deepEqual([next.created, next.intoMarine, next.replaced], [false, true, 0]);
  // A plain course elsewhere is neither.
  const plain = placeCourse([], 'CASCS111', SPRING);
  assert.deepEqual([plain.created, plain.intoMarine], [false, false]);
});

test('startMarineTerm: only a Fall with no courses; unknown kinds are kept', () => {
  const future = { kind: 'future', id: 'u' };
  const r = startMarineTerm([ph('a'), future]);
  assert.equal(r.replaced, 1);
  assert.equal(r.entries.length, 6);
  assert.ok(r.entries.includes(future));
  assert.equal(isMarineTerm(r.entries, FALL), true);
  assert.equal(startMarineTerm(['CASCS111']), null);
  assert.equal(startMarineTerm([ph()]).entries.filter(isPlainNoteEntry).length, 4);
});

test('a refusal changes nothing and returns no entries', () => {
  const term = createMarineTerm();
  for (const [entries, key, slot] of [[['CASCS111'], 'CASBI511', FALL], [[], 'CASBI511', SPRING], [term, 'CASCS111', FALL]]) {
    const before = JSON.stringify(entries);
    const r = placeCourse(entries, key, slot);
    assert.equal(r.ok, false);
    assert.ok(!('entries' in r));
    assert.equal(JSON.stringify(entries), before);
  }
});

test('ALSO and research courses go anywhere, including a Marine term', () => {
  for (const key of ['CASEE557', 'CASMR500', 'CASBI423', 'CASEE623', 'CASMR391', 'CASMR492']) {
    for (const [entries, slot] of [[[], FALL], [['CASCS111'], FALL], [[], SPRING], [['CASCS111'], SPRING], [[], 'summer:1'], [createMarineTerm(), FALL]]) {
      assert.equal(placeCourse(entries, key, slot).ok, true, `${key} in ${JSON.stringify(slot)}`);
    }
  }
  // Research and pool ALSO fill a slot; BI/EE 423 and EE 623 do not.
  assert.deepEqual(marineSlotCounts(placeCourse(createMarineTerm(), 'CASMR492', FALL).entries), { courses: 1, placeholders: 3 });
  assert.deepEqual(marineSlotCounts(placeCourse(createMarineTerm(), 'CASEE623', FALL).entries), { courses: 0, placeholders: 4 });
});

test('four real courses fill the term; research counts toward the four; a fifth is refused', () => {
  let entries = createMarineTerm();
  for (const key of ['CASBI511', 'CASMR391', 'CASEE557', 'CASEE542']) entries = placeCourse(entries, key, FALL).entries;
  assert.deepEqual(marineSlotCounts(entries), { courses: 4, placeholders: 0 });
  for (const key of ['CASBI593', 'CASMR492', 'CASMR500']) {
    assert.deepEqual(placeCourse(entries, key, FALL), { ok: false, reason: 'full' }, key);
  }
  // A course with no slot (BI 423) still lands beyond the four.
  assert.equal(placeCourse(entries, 'CASBI423', FALL).ok, true);
});

test('twins count once: the second twin takes no slot and no placeholder', () => {
  let entries = placeCourse(createMarineTerm(), 'CASBI523', FALL).entries;
  const twin = placeCourse(entries, 'CASEE523', FALL);
  assert.equal(twin.ok, true);
  assert.deepEqual(marineSlotCounts(twin.entries), { courses: 1, placeholders: 3 });
  assert.equal(twin.entries.length, 6, 'appended beyond the four slots');
  // Removing the duplicate gives nothing back; removing the last twin does.
  const noDup = removeCourse(twin.entries, 'CASEE523', FALL);
  assert.deepEqual(marineSlotCounts(noDup), { courses: 1, placeholders: 3 });
  assert.equal(noDup.length, 5);
  const bothGone = removeCourse(removeCourse(twin.entries, 'CASBI523', FALL), 'CASEE523', FALL);
  assert.deepEqual(marineSlotCounts(bothGone), { courses: 0, placeholders: 4 });
  // Four distinct courses, one of them a twin pair, plus the pair's other half: still not "full" at 3.
  entries = createMarineTerm();
  for (const key of ['CASBI523', 'CASEE523', 'CASBI511', 'CASBI569']) entries = placeCourse(entries, key, FALL).entries;
  assert.deepEqual(marineSlotCounts(entries), { courses: 3, placeholders: 1 });
  assert.equal(placeCourse(entries, 'CASEE542', FALL).ok, true);
});

test('mixed terms are tolerated and flagged: an untagged course in a Marine term', () => {
  const mixed = [marker, ph('a'), 'CASCS111', course('CASBI511')];
  assert.equal(isMarineTerm(mixed, FALL), true);
  assert.equal(isMixedMarineTerm(mixed, FALL), true);
  assert.equal(isMixedMarineTerm(createMarineTerm(), FALL), false);
  assert.equal(isMixedMarineTerm([marker, 'CASEE557', 'CASBI423'], FALL), false, 'ALSO courses belong');
  assert.equal(isMixedMarineTerm(['CASCS111'], FALL), false, 'not a Marine term');
  assert.equal(isMixedMarineTerm([marker, 'CASCS111'], SPRING), false, 'not a Fall');
  // Existing entries survive further placements and removals untouched.
  const added = placeCourse(mixed, 'CASBI569', FALL).entries;
  assert.ok(added.includes('CASCS111'));
  assert.equal(removeCourse(added, 'CASBI569', FALL).includes('CASCS111'), true);
  assert.equal(placeCourse(mixed, 'CASMA123', FALL).ok, false, 'a second untagged course is still refused');
});

test('an ONLY course outside a Marine term is flagged; in a Marine term it is not', () => {
  assert.equal(isOnlyCourseOutsideMarine('CASBI511', ['CASBI511'], SPRING), true);
  assert.equal(isOnlyCourseOutsideMarine('CASBI511', ['CASBI511'], 'summer:0'), true);
  assert.equal(isOnlyCourseOutsideMarine('CASBI511', ['CASBI511'], FALL), false, 'tag makes the Fall a Marine term');
  assert.equal(isOnlyCourseOutsideMarine('CASEE557', ['CASEE557'], SPRING), false, 'ALSO is never flagged');
  assert.equal(isOnlyCourseOutsideMarine('CASCS111', ['CASCS111'], SPRING), false);
});

test('removeMarineSemester: marker and placeholders go, real courses and other entries stay', () => {
  const future = { kind: 'future', id: 'u' };
  const term = [marker, ph('a'), ph('b'), course('CASBI511'), 'CASCS111', future];
  const r = removeMarineSemester(term, FALL);
  assert.deepEqual(r.entries, [course('CASBI511'), 'CASCS111', future]);
  assert.equal(r.courses, 2);
  assert.deepEqual(removeMarineSemester(createMarineTerm(), FALL), { entries: [], courses: 0 });
  // A stray marker in a Spring: only the marker goes, the student's placeholders stay.
  assert.deepEqual(removeMarineSemester([marker, ph('a', 'Elective')], SPRING).entries, [ph('a', 'Elective')]);
  // A degraded marker (plain note) is removed too.
  const degraded = { kind: 'note', id: 'd', text: 'Marine Semester', credits: 0 };
  assert.deepEqual(removeMarineSemester([degraded, ph('a')], FALL).entries, []);
});

test('removal then the ONLY course still derives a Marine term (no marker needed)', () => {
  const after = removeMarineSemester([marker, ph('a'), course('CASBI511')], FALL).entries;
  assert.equal(isMarineTerm(after, FALL), true);
  assert.equal(isOnlyCourseOutsideMarine('CASBI511', after, FALL), false);
});

test('a stale-tab degraded marker still derives as a Marine term and accepts Marine courses', () => {
  const degraded = { kind: 'note', id: 'd', text: 'Marine Semester', credits: 0 };
  const term = [degraded, ph('a'), ph('b')];
  assert.equal(isMarineTerm(term, FALL), true);
  const r = placeCourse(term, 'CASBI511', FALL);
  assert.equal(r.ok, true);
  assert.equal(r.intoMarine, true);
  assert.equal(entriesNoteCredits(r.entries), 4, 'one placeholder left, the marker adds nothing');
  assert.deepEqual(placeCourse(term, 'CASCS111', FALL), { ok: false, reason: 'untagged-in-marine' });
});

test('no marker, placeholder or term shape is ever written with undefined', () => {
  const results = [
    createMarineTerm(),
    placeCourse([], 'CASBI511', FALL).entries,
    placeCourse([ph('a')], 'CASBI511', FALL).entries,
    placeCourse(createMarineTerm(), 'CASMR391', FALL).entries,
    placeCourse(createMarineTerm(), { courseKey: 'CASBI511', locked: true, source: 'transcript' }, FALL).entries,
    removeCourse(placeCourse(createMarineTerm(), 'CASBI511', FALL).entries, 'CASBI511', FALL),
    startMarineTerm([ph('a')]).entries,
    removeMarineSemester(createMarineTerm(), FALL).entries,
    normalizeSemesters([[{ kind: 'block', blockType: 'marine' }], [{ kind: 'note', blockType: 'marine', credits: 16 }]]),
    normalizeGridSummerTerms({ 0: [{ kind: 'block', blockType: 'marine' }] }),
  ];
  for (const value of results) assert.ok(!hasUndefined(value));
});

test('the pinned search row: the RAW trimmed query contains "marine"', () => {
  for (const query of ['marine', 'Marine', '  MARINE  ', 'marine semester', 'marine bio', 'the marine semester please', 'submarine']) {
    assert.equal(matchesMarineQuery(query), true, query);
  }
  for (const query of ['', '   ', 'mar', 'mari ne', 'ocean', 'CS 111', 'MR 500']) {
    assert.equal(matchesMarineQuery(query), false, query);
  }
  assert.equal(matchesMarineQuery(undefined), false);
  assert.equal(matchesMarineQuery(null), false);
  // The normalized course-key form ("MARINESEMESTER") is not what is tested: spaces are kept.
  assert.equal(matchesMarineQuery('ma rine'), false);
});

test('the Marine card rows: twins as one row, offered flag from the Fall list', () => {
  const rows = marinePoolRows();
  const row = (key) => rows.find((r) => r.keys.includes(key));
  assert.deepEqual(row('CASBI523').keys, ['CASBI523', 'CASEE523']);
  assert.equal(row('CASEE523'), row('CASBI523'));
  assert.equal(row('CASBI523').key, 'CASBI523');
  assert.equal(row('CASBI511').offered, true);
  assert.equal(row('CASBI578').offered, true);
  assert.equal(row('CASEE578').offered, true, 'twin');
  assert.equal(row('CASBI541').offered, false, 'not in the latest list');
  assert.equal(row('CASBI521').offered, false, 'cancelled');
  assert.ok(row('CASEE557') && row('CASMR500'));
  assert.equal(rows.some((r) => r.keys.includes('CASBI423')), false);
  assert.equal(new Set(rows.flatMap((r) => r.keys)).size, rows.flatMap((r) => r.keys).length);
});

// ── A lone marker dissolves ─────────────────────────────────────────────────

test('a Fall whose only entry is the marker is not a Marine term', () => {
  assert.equal(isMarineTerm([marker], FALL), false);
  assert.equal(isMarineTerm([{ kind: 'note', id: 'd', text: 'Marine Semester', credits: 0 }], FALL), false, 'degraded marker');
  assert.equal(isMarineTerm([marker, marker], FALL), false, 'only markers');
  // The marker plus anything else keeps it: a placeholder, a course, an unknown kind.
  assert.equal(isMarineTerm([marker, ph()], FALL), true);
  assert.equal(isMarineTerm([marker, 'CASCS111'], FALL), true);
  assert.equal(isMarineTerm([marker, { kind: 'future', id: 'u' }], FALL), true);
});

test('deleting a Marine term\'s placeholders one by one: it stays until the marker is alone, then dissolves', () => {
  let entries = createMarineTerm();
  const ids = entries.slice(1).map((e) => e.id);
  const states = [];
  for (const id of ids) {
    entries = dropLoneMarker(entries.filter((e) => e.id !== id), FALL);
    states.push([entries.length, isMarineTerm(entries, FALL)]);
  }
  assert.deepEqual(states, [[4, true], [3, true], [2, true], [0, false]]);
  assert.ok(!hasUndefined(entries));
});

test('dropLoneMarker: only a lone marker goes', () => {
  assert.deepEqual(dropLoneMarker([marker], FALL), []);
  assert.deepEqual(dropLoneMarker([marker], SPRING), [], 'a real marker anywhere');
  assert.deepEqual(dropLoneMarker([marker, ph()], FALL), [marker, ph()]);
  assert.deepEqual(dropLoneMarker(['CASCS111'], FALL), ['CASCS111']);
  assert.deepEqual(dropLoneMarker([], FALL), []);
  const degraded = { kind: 'note', id: 'd', text: 'Marine Semester', credits: 0 };
  assert.deepEqual(dropLoneMarker([degraded], FALL), [], 'degraded marker in a Fall');
  assert.deepEqual(dropLoneMarker([degraded], SPRING), [degraded], 'just a note in a Spring');
  assert.deepEqual(dropLoneMarker([{ kind: 'note', id: 'n', text: 'Elective', credits: 0 }], FALL).length, 1);
});

test('normalizing drops a lone marker on read, so it disappears on the next save', () => {
  const degraded = { kind: 'note', id: 'd', text: 'Marine Semester', credits: 0 };
  const out = normalizeSemesters([[marker], [degraded], [degraded], [marker, ph()], [], ['CASCS111']]);
  assert.deepEqual(out[0], [], 'lone marker, Fall');
  assert.deepEqual(out[1], [degraded], 'a lone degraded note in a Spring is just a note');
  assert.deepEqual(out[2], [], 'a lone degraded marker in a Fall');
  assert.equal(out[3].length, 2, 'marker + placeholder stays');
  const summers = normalizeGridSummerTerms({ 0: [marker], 1: [marker, ph()] });
  assert.deepEqual(summers['0'], []);
  assert.equal(summers['1'].length, 2);
  // A second pass changes nothing.
  assert.deepEqual(normalizeSemesters(JSON.parse(JSON.stringify(out))), out);
});

test('legacy shapes still expand (never a lone marker); a stale tab rewriting a lone marker dissolves it', () => {
  markerPlusFour(normalizeSemesters([[{ kind: 'block', blockType: 'marine', id: 'b1' }]])[0]);
  markerPlusFour(normalizeSemesters([[{ kind: 'note', id: 'w', text: 'Marine Semester', credits: 16, blockType: 'marine' }]])[0]);
  // A current marker rewritten with 16 credits by a stale WIP tab, nothing else beside it: gone.
  assert.deepEqual(normalizeSemesters([[{ ...marker, credits: 16 }, ph('a')]])[0].length, 2);
});

test('removing the last course from a marker-only remainder dissolves the term; placeCourse can then start a fresh one', () => {
  assert.deepEqual(removeCourse([marker, course('CASBI511')], 'CASBI511', FALL), []);
  const r = placeCourse([marker], 'CASBI511', FALL);
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.entries.filter(isMarker).length, 1, 'no duplicate marker');
  assert.deepEqual(marineSlotCounts(r.entries), { courses: 1, placeholders: 3 });
});
