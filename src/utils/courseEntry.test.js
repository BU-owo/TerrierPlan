// Run with: node --test src/utils/
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
  createBlockEntry,
  entriesBlockCredits,
  exclusiveTermOf,
  targetSeason,
  planBlockTypes,
  canAddSpecialTerm,
  degradedSpecialTerm,
  splitBlockEntries,
} from './courseEntry.js';
import { SPECIAL_TERMS, getSpecialTerm, exclusiveTermMessage } from '../data/specialTerms.js';

const MARINE_BLOCK_CREDITS = SPECIAL_TERMS.marine.credits;
const MARINE_BLOCK_TEXT = SPECIAL_TERMS.marine.label;

// Firestore rejects a write with `undefined` anywhere in it.
function hasUndefined(value) {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefined);
  if (value && typeof value === 'object') return Object.values(value).some(hasUndefined);
  return false;
}

const marine = { kind: 'note', id: 'b1', text: 'Marine Semester', credits: 16, blockType: 'marine' };

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

test('a Marine block (a note with blockType) is preserved', () => {
  assert.deepEqual(normalizeCourseEntry(marine), marine);
});

test('a Marine block always reads "Marine Semester", 16 credits', () => {
  const out = normalizeCourseEntry({ ...marine, text: 'edited', credits: 4 });
  assert.equal(out.text, MARINE_BLOCK_TEXT);
  assert.equal(out.credits, MARINE_BLOCK_CREDITS);
  const bare = normalizeCourseEntry({ kind: 'note', blockType: 'marine' });
  assert.equal(bare.text, MARINE_BLOCK_TEXT);
  assert.equal(typeof bare.id, 'string');
  assert.ok(bare.id.length > 0);
  assert.ok(!hasUndefined(bare));
});

test('an unknown blockType is kept, with the note text and credits as stored', () => {
  const out = normalizeCourseEntry({ kind: 'note', id: 'f', text: 'Field camp', credits: 12, blockType: 'field' });
  assert.deepEqual(out, { kind: 'note', id: 'f', text: 'Field camp', credits: 12, blockType: 'field' });
  assert.equal(isBlockEntry(out), true);
});

test('an empty or non-string blockType is a plain placeholder', () => {
  for (const blockType of ['', 5, null, undefined]) {
    const out = normalizeCourseEntry({ kind: 'note', id: 'n', text: 'x', credits: 4, blockType });
    assert.deepEqual(out, { kind: 'note', id: 'n', text: 'x', credits: 4 });
    assert.equal(isPlainNoteEntry(out), true);
  }
});

test('a degraded block (old tab dropped blockType) stays a plain placeholder', () => {
  const out = normalizeCourseEntry({ kind: 'note', id: 'b1', text: 'Marine Semester', credits: 16 });
  assert.equal(isBlockEntry(out), false);
  assert.equal(isPlainNoteEntry(out), true);
});

test("step 1's { kind: 'block' } shape converts to the note shape", () => {
  assert.deepEqual(
    normalizeCourseEntry({ kind: 'block', blockType: 'marine', id: 'b1', credits: 16 }),
    marine,
  );
  assert.deepEqual(
    normalizeCourseEntry({ kind: 'block', blockType: 'field', id: 'f', credits: 12 }),
    { kind: 'note', id: 'f', text: 'Special term', credits: 12, blockType: 'field' },
  );
  const noType = normalizeCourseEntry({ kind: 'block', id: 'x', credits: 'bad' });
  assert.deepEqual(noType, { kind: 'note', id: 'x', text: 'Special term', credits: 0 });
  const noId = normalizeCourseEntry({ kind: 'block', blockType: 'marine' });
  assert.equal(typeof noId.id, 'string');
  assert.ok(!hasUndefined(noId));
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
  assert.equal(isCourseEntry(marine), false);
  assert.equal(isCourseEntry(note), false);
  assert.equal(isCourseEntry(other), false);
  assert.equal(isCourseEntry(null), false);
  assert.equal(isBlockEntry(marine), true);
  assert.equal(isBlockEntry(note), false);
  assert.equal(isBlockEntry('CASCS111'), false);
  assert.equal(isNoteEntry(marine), true);
  assert.equal(isPlainNoteEntry(marine), false);
  assert.equal(isPlainNoteEntry(note), true);
  assert.equal(blockEntryLabel(marine), 'Marine Semester');
  assert.equal(blockEntryLabel({ ...marine, blockType: 'field' }), 'Special term');
  assert.equal(blockEntryLabel(other), 'Special term');
});

test('blocks and unknown kinds have no courseKey; block credits stay out of placeholder credits', () => {
  const entries = [
    'CASCS111',
    marine,
    { kind: 'other', courseKey: 'CASCS999' },
    { kind: 'note', id: 'n', text: '', credits: 4 },
  ];
  assert.deepEqual(entries.map(entryCourseKey), ['CASCS111', null, null, null]);
  assert.deepEqual(entriesCourseKeys(entries), ['CASCS111']);
  assert.equal(entriesNoteCredits(entries), 4);
});

test('semesters and Summer slots carry a block through with no undefined anywhere', () => {
  const raw = [
    [marine],
    ['CASCS111', { kind: 'unknown-thing', id: 'u' }],
  ];
  const semesters = normalizeSemesters(raw);
  assert.deepEqual(semesters[0], [marine]);
  assert.deepEqual(semesters[1][1], { kind: 'unknown-thing', id: 'u' });
  assert.ok(!hasUndefined(semesters));
  // A second pass (e.g. load after save) changes nothing.
  assert.deepEqual(normalizeSemesters(JSON.parse(JSON.stringify(semesters))), semesters);
  const summers = normalizeGridSummerTerms({ 0: [{ kind: 'block', blockType: 'marine', id: 's' }] });
  assert.deepEqual(summers['0'][0], { ...marine, id: 's' });
});

// ── Special terms (src/data/specialTerms.js) ────────────────────────────────

test('registry: the Marine Semester entry, unknown types are null', () => {
  assert.deepEqual(SPECIAL_TERMS.marine, {
    id: 'marine',
    label: 'Marine Semester',
    seasons: ['fall'],
    credits: 16,
    courseCount: 4,
    exclusive: true,
    maxPerPlan: 1,
    helperText: "BU Marine Program places you in four month-long courses, so there's nothing to pick here.",
    admissionNote: 'Requires admission to the Marine Semester.',
  });
  for (const [key, term] of Object.entries(SPECIAL_TERMS)) assert.equal(term.id, key);
  assert.equal(getSpecialTerm('marine'), SPECIAL_TERMS.marine);
  assert.equal(getSpecialTerm('field'), null);
  assert.equal(getSpecialTerm('toString'), null);
  assert.equal(getSpecialTerm(undefined), null);
  assert.equal(exclusiveTermMessage(SPECIAL_TERMS.marine), 'The Marine Semester fills the whole term.');
});

test('createBlockEntry: registry text and credits, fresh id', () => {
  const a = createBlockEntry('marine');
  const b = createBlockEntry('marine');
  assert.deepEqual({ ...a, id: 'x' }, { kind: 'note', id: 'x', text: 'Marine Semester', credits: 16, blockType: 'marine' });
  assert.notEqual(a.id, b.id);
});

test('exclusiveTermOf: only a known exclusive block makes a term refuse adds', () => {
  assert.equal(exclusiveTermOf([marine]), SPECIAL_TERMS.marine);
  assert.equal(exclusiveTermOf(['CASCS111', marine]), SPECIAL_TERMS.marine);
  assert.equal(exclusiveTermOf([{ kind: 'note', id: 'f', text: 'x', credits: 4, blockType: 'field' }]), null);
  assert.equal(exclusiveTermOf([{ kind: 'note', id: 'n', text: 'Marine Semester', credits: 16 }]), null);
  assert.equal(exclusiveTermOf([]), null);
  assert.equal(exclusiveTermOf(undefined), null);
});

test('targetSeason and planBlockTypes', () => {
  assert.deepEqual([0, 1, 2, 3, 'summer:0'].map(targetSeason), ['fall', 'spring', 'fall', 'spring', 'summer']);
  assert.deepEqual(planBlockTypes([[], [], [marine], ['CASCS111']], { 0: [{ ...marine, blockType: 'field' }] }), ['marine', 'field']);
  assert.deepEqual(planBlockTypes([[], []], {}), []);
});

test('canAddSpecialTerm: an empty Fall, under maxPerPlan, never by major', () => {
  assert.equal(canAddSpecialTerm('marine', 0, [], []), true);
  assert.equal(canAddSpecialTerm('marine', 4, [], []), true);
  assert.equal(canAddSpecialTerm('marine', 1, [], []), false, 'Spring');
  assert.equal(canAddSpecialTerm('marine', 'summer:0', [], []), false, 'Summer');
  assert.equal(canAddSpecialTerm('marine', 0, ['CASCS111'], []), false, 'non-empty');
  assert.equal(canAddSpecialTerm('marine', 0, [{ kind: 'note', id: 'n', text: '', credits: 4 }], []), false, 'placeholder');
  assert.equal(canAddSpecialTerm('marine', 2, [], ['marine']), false, 'maxPerPlan');
  assert.equal(canAddSpecialTerm('field', 0, [], []), false, 'unknown type');
});

test('degradedSpecialTerm: exactly the label and credits, alone, right season, no block yet', () => {
  const degraded = { kind: 'note', id: 'n', text: 'Marine Semester', credits: 16 };
  assert.equal(degradedSpecialTerm(degraded, 2, [degraded], []), SPECIAL_TERMS.marine);
  assert.equal(degradedSpecialTerm(degraded, 3, [degraded], []), null, 'Spring');
  assert.equal(degradedSpecialTerm(degraded, 2, [degraded, 'CASCS111'], []), null, 'not alone');
  assert.equal(degradedSpecialTerm(degraded, 2, [degraded], ['marine']), null, 'plan already has one');
  assert.equal(degradedSpecialTerm({ ...degraded, credits: 4 }, 2, [{ ...degraded, credits: 4 }], []), null, 'credits');
  assert.equal(degradedSpecialTerm({ ...degraded, text: 'marine semester' }, 2, [{ ...degraded, text: 'marine semester' }], []), null, 'text');
  assert.equal(degradedSpecialTerm(marine, 2, [marine], []), null, 'already a block');
});

test('credits: placeholders and blocks are each counted once', () => {
  const entries = [
    marine,
    { kind: 'note', id: 'n', text: 'Elective', credits: 4 },
    { kind: 'note', id: 'f', text: 'Field camp', credits: 8, blockType: 'field' },
    'CASCS111',
  ];
  assert.equal(entriesNoteCredits(entries), 4);
  assert.equal(entriesBlockCredits(entries), 24);
  // A stored Marine block with edited credits still counts the registry's 16.
  assert.equal(entriesBlockCredits([{ ...marine, credits: 4 }]), 16);
  assert.equal(entriesNoteCredits([marine]) + entriesBlockCredits([marine]), 16);
});

test('splitBlockEntries: a block next to other entries hides nothing', () => {
  const others = ['CASCS111', { kind: 'note', id: 'n', text: 'x', credits: 4 }, { kind: 'future', id: 'u' }];
  const entries = [others[0], marine, others[1], others[2]];
  const { blocks, others: rest } = splitBlockEntries(entries);
  assert.deepEqual(blocks, [marine]);
  assert.deepEqual(rest, others);
  assert.equal(blocks.length + rest.length, entries.length);
});
