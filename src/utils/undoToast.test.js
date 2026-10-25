// Run with: node --test src/utils/undoToast.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUndo, planEditChanged, restoreSemesters, snapshotSemesters, stepUndo,
} from './undoToast.js';
import { createMarineTerm, isMarineTerm, placeCourse, removeCourse } from './courseEntry.js';

const FALL = 0;
const course = (courseKey) => ({ courseKey, locked: false, source: 'manual' });

// What PlannerPage's handlers do, on plain arrays.
function addCourse(semesters, key, slot) {
  return semesters.map((entries, i) => (i === slot ? placeCourse(entries, key, slot).entries : entries));
}
function moveCourse(semesters, key, from, to) {
  const entry = semesters[from].find((e) => e.courseKey === key);
  return semesters.map((entries, i) => {
    if (i === from) return removeCourse(entries, key, from);
    if (i === to) return placeCourse(entries, entry, to).entries;
    return entries;
  });
}

test('undo of an add that started a Marine Semester restores exactly the previous semesters', () => {
  const before = [[], [course('CASCS111')], [{ kind: 'note', id: 'n', text: 'Elective', credits: 4 }], []];
  const undo = createUndo(1, before);
  const after = addCourse(before, 'CASBI511', 2);
  assert.equal(isMarineTerm(after[2], 2), true);
  assert.notDeepEqual(after, before);
  assert.deepEqual(restoreSemesters(undo.snapshot), before, 'the replaced placeholder is back');
});

test('undo of a move from another term restores BOTH terms', () => {
  // A stray ONLY course in a Spring moves into an empty Fall (starting a Marine Semester there).
  const before = [[], [course('CASBI511'), { kind: 'note', id: 'n', text: 'x', credits: 4 }], [], []];
  const undo = createUndo(2, before);
  const after = moveCourse(before, 'CASBI511', 1, 0);
  assert.equal(isMarineTerm(after[0], 0), true);
  assert.equal(after[1].some((e) => e.courseKey === 'CASBI511'), false);
  assert.deepEqual(restoreSemesters(undo.snapshot), before);
});

test('the snapshot is independent of later edits and of the restored copy', () => {
  const semesters = [[course('CASCS111')], []];
  const snapshot = snapshotSemesters(semesters);
  semesters[0].push(course('CASMA123'));
  semesters[1] = ['x'];
  assert.deepEqual(snapshot, [[course('CASCS111')], []], 'later mutation does not leak in');
  const restored = restoreSemesters(snapshot);
  restored[0].push('y');
  assert.deepEqual(snapshot, [[course('CASCS111')], []], 'the restored copy does not alias the snapshot');
  assert.deepEqual(snapshotSemesters(undefined), []);
  assert.deepEqual(snapshotSemesters([undefined]), [[]]);
});

test('snapshots never contain undefined', () => {
  const snapshot = snapshotSemesters([createMarineTerm(), []]);
  assert.ok(JSON.stringify(snapshot).indexOf('undefined') === -1);
  assert.equal(JSON.parse(JSON.stringify(snapshot)).length, 2);
});

const state = (extra = {}) => ({
  semesters: [[]], gridSummerTerms: {}, extraTerms: [], stash: [], requirementOverrides: {}, planName: 'My Plan', ...extra,
});

test('planEditChanged: identity per key; no baseline counts as unchanged', () => {
  const base = state();
  assert.equal(planEditChanged(null, base), false);
  assert.equal(planEditChanged(base, { ...base }), false, 'same references');
  assert.equal(planEditChanged(base, { ...base, stash: [] }), true, 'a new stash array');
  assert.equal(planEditChanged(base, { ...base, planName: 'Other' }), true);
  assert.equal(planEditChanged(base, { ...base, extra: 1 }), true, 'a new key');
  assert.equal(planEditChanged(base, { ...base, semesters: undefined }), true);
});

test('dismiss-on-edit: the first step arms the baseline, only a later edit dismisses', () => {
  const afterChange = state({ semesters: [[course('CASBI511')]] });
  let undo = createUndo(5, [[]]);
  // First render after the change: arms, no dismissal.
  let step = stepUndo(undo, afterChange);
  assert.equal(step.dismiss, false);
  assert.equal(step.undo.baseline, afterChange);
  undo = step.undo;
  // Re-renders with the same state never dismiss.
  assert.equal(stepUndo(undo, { ...afterChange }).dismiss, false);
  // ANY other plan edit does: semesters, stash, summer terms, requirements, name…
  for (const edit of [
    { semesters: [[course('CASBI511'), course('CASCS111')]] },
    { stash: ['CASCS111'] },
    { gridSummerTerms: { 0: [] } },
    { extraTerms: [{ term: 'Summer 2027' }] },
    { requirementOverrides: { a: {} } },
    { planName: 'Renamed' },
    { majorBulletinUrl: 'x' },
  ]) {
    assert.equal(stepUndo(undo, { ...afterChange, ...edit }).dismiss, true, JSON.stringify(Object.keys(edit)));
  }
});

test('stepUndo with no undo does nothing; the undo object is not mutated', () => {
  assert.deepEqual(stepUndo(null, state()), { undo: null, dismiss: false });
  const undo = createUndo(1, [[]]);
  stepUndo(undo, state());
  assert.equal(undo.baseline, null);
});

test('Undo can never overwrite later changes: after an edit the step says dismiss, so the toast (and Undo) is gone', () => {
  const before = [[]];
  const after = addCourse([[]], 'CASBI511', 0);
  let undo = stepUndo(createUndo(9, before), state({ semesters: after })).undo;
  const later = addCourse(after, 'CASBI569', 0);
  assert.equal(stepUndo(undo, state({ semesters: later })).dismiss, true);
});
