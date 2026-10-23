// Run with: node --test src/utils/transcriptMapping.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
// applyImport's append-or-replace step is placeImportedCourse (transcriptMapping.js
// itself uses bundler-style imports, so node tests exercise the helper).
import { createMarineTerm, entriesNoteCredits, entryCourseKey, isMarineTerm, marineSlotCounts, placeImportedCourse } from './courseEntry.js';

const empty = () => Array.from({ length: 8 }, () => []);
// What applyImport does for one slot: each course in order, locked, tagged transcript.
function run(keys, semesters, slot = 0) {
  const out = semesters.map((entries) => [...entries]);
  for (const key of keys) {
    out[slot] = placeImportedCourse(out[slot], { courseKey: key, locked: true, source: 'transcript' }, slot);
  }
  return out;
}
const course = (key) => key;

test('imported Marine courses consume the placeholders of a planned Marine Semester', () => {
  const semesters = empty();
  semesters[0] = createMarineTerm();
  const out = run([course('CASBI511'), course('CASBI569')], semesters);
  assert.deepEqual(marineSlotCounts(out[0]), { courses: 2, placeholders: 2 });
  assert.equal(entriesNoteCredits(out[0]), 8, 'the two replaced placeholders no longer count');
  assert.equal(isMarineTerm(out[0], 0), true);
  // Imported courses are locked and tagged transcript, as before.
  assert.deepEqual(out[0].find((e) => entryCourseKey(e) === 'CASBI511'), { courseKey: 'CASBI511', locked: true, source: 'transcript' });
});

test('with no Marine term yet, Marine courses just land in the Fall and the term derives as Marine', () => {
  const out = run([course('CASBI511'), course('CASEE542')], empty());
  assert.deepEqual(out[0].map(entryCourseKey), ['CASBI511', 'CASEE542']);
  assert.equal(isMarineTerm(out[0], 0), true);
  assert.equal(out[0].length, 2, 'no placeholders invented');
});

test('nothing is ever dropped or skipped: untagged courses and a fifth Marine course still land', () => {
  const semesters = empty();
  semesters[0] = createMarineTerm();
  const out = run(
    [course('CASBI511'), course('CASBI569'), course('CASEE542'), course('CASMR533'), course('CASBI593'), course('CASCS111')],
    semesters,
  );
  const keys = out[0].map(entryCourseKey).filter(Boolean);
  assert.deepEqual(keys.sort(), ['CASBI511', 'CASBI569', 'CASBI593', 'CASCS111', 'CASEE542', 'CASMR533']);
  assert.equal(entriesNoteCredits(out[0]), 0);
});

test('a plain Fall imports as before (appended, locked), and the input is not mutated', () => {
  const semesters = empty();
  semesters[0] = ['CASMA123'];
  const before = JSON.stringify(semesters);
  const out = run([course('CASCS111')], semesters);
  assert.equal(JSON.stringify(semesters), before);
  assert.deepEqual(out[0].map(entryCourseKey), ['CASMA123', 'CASCS111']);
});
