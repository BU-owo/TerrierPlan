// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIncompleteCourseKeys, mergeIncompleteCourseKeys, pastTermsSeed } from './pastTerms.js';
import { getCourseStatus, createMarkerEntry, createNoteEntry } from './courseEntry.js';

const FALL_2024 = '2248';
const day = (y, m, d) => new Date(y, m - 1, d);
const TODAY = day(2026, 10, 20); // Fall 2026 = slot 4 for a Fall 2024 start

test('normalizeIncompleteCourseKeys: strings only, else []', () => {
  assert.deepEqual(normalizeIncompleteCourseKeys(['CASCS111', 3, null, '', 'CASMA123']), ['CASCS111', 'CASMA123']);
  assert.deepEqual(normalizeIncompleteCourseKeys(undefined), []);
  assert.deepEqual(normalizeIncompleteCourseKeys('CASCS111'), []);
  assert.deepEqual(normalizeIncompleteCourseKeys({ 0: 'CASCS111' }), []);
});

test('mergeIncompleteCourseKeys: union of account and guest, no duplicates', () => {
  assert.deepEqual(mergeIncompleteCourseKeys(['A', 'B'], ['B', 'C']), ['A', 'B', 'C']);
  assert.deepEqual(mergeIncompleteCourseKeys(undefined, ['C']), ['C']);
  assert.deepEqual(mergeIncompleteCourseKeys(['A'], undefined), ['A']);
  assert.deepEqual(mergeIncompleteCourseKeys(undefined, undefined), []);
  assert.deepEqual(mergeIncompleteCourseKeys([], []), []);
});

test('getCourseStatus: start term set — past slot completed, completedKeys anywhere', () => {
  const ctx = (completed = []) => ({
    startTerm: FALL_2024, currentSemesterTarget: null, today: TODAY, completedKeys: new Set(completed),
  });
  assert.deepEqual(getCourseStatus('A', 1, ctx()), { locked: false, semesterStatus: 'past' });
  assert.deepEqual(getCourseStatus('A', 4, ctx()), { locked: false, semesterStatus: 'current' });
  assert.deepEqual(getCourseStatus('A', 7, ctx(['A'])), { locked: true, semesterStatus: 'upcoming' });
  // extraTerms course: always past and locked.
  assert.deepEqual(getCourseStatus('A', null, ctx()), { locked: true, semesterStatus: 'past' });
});

test('getCourseStatus: legacy (no startTerm) — currentSemesterTarget fallback', () => {
  const ctx = { startTerm: null, currentSemesterTarget: 2, today: TODAY, completedKeys: new Set(['A']) };
  assert.deepEqual(getCourseStatus('A', 5, ctx), { locked: true, semesterStatus: 'upcoming' });
  assert.deepEqual(getCourseStatus('B', 1, ctx), { locked: false, semesterStatus: 'past' });
});

test('pastTermsSeed: copies past and current slots whole, empties future', () => {
  const marker = createMarkerEntry();
  const placeholder = createNoteEntry();
  const semesters = [
    [{ courseKey: 'Y1F' }],
    [{ courseKey: 'Y1S' }, placeholder],
    [marker, { courseKey: 'Y2F' }],
    [],
    [{ courseKey: 'Y3F' }], // current
    [{ courseKey: 'Y3S' }], // upcoming
    [], [],
  ];
  const seed = pastTermsSeed({ semesters, gridSummerTerms: {}, extraTerms: [] }, { startTerm: FALL_2024, today: TODAY });
  assert.equal(seed.semesters.length, 8);
  assert.deepEqual(seed.semesters.slice(0, 5), semesters.slice(0, 5));
  assert.deepEqual(seed.semesters.slice(5), [[], [], []]);
  assert.notEqual(seed.semesters[0], semesters[0]); // a copy, not the same array
});

test('pastTermsSeed: current Summer (no grid slot current) copies too', () => {
  const seed = pastTermsSeed({
    semesters: [[], [], [{ courseKey: 'Y2F' }], [], [], [], [], []],
    gridSummerTerms: { 0: [{ courseKey: 'S25' }] },
  }, { startTerm: FALL_2024, today: day(2025, 7, 1) });
  assert.deepEqual(seed.gridSummerTerms, { 0: [{ courseKey: 'S25' }] });
  assert.deepEqual(seed.semesters[2], []); // Fall 2025 is upcoming in July
});

test('pastTermsSeed: past non-empty Summers and past extraTerms only', () => {
  const seed = pastTermsSeed({
    semesters: [[], [], [], [], [], [], [], []],
    gridSummerTerms: { 0: [{ courseKey: 'S25' }], 1: [], 2: [{ courseKey: 'S27' }] },
    extraTerms: [
      { term: 'Summer 2023', season: 'summer', courseKeys: ['X1'], isPostDegree: false },
      { term: 'Winter 2026', season: 'winter', courseKeys: ['X2'], isPostDegree: false },
      { term: 'Fall 2026', season: 'fall', courseKeys: ['X3'], isPostDegree: true },
      { term: 'Who knows', season: 'summer', courseKeys: ['X4'], isPostDegree: false },
      { term: 'Summer 2022', season: 'summer', courseKeys: [], isPostDegree: false },
    ],
  }, { startTerm: FALL_2024, today: TODAY });
  assert.deepEqual(seed.gridSummerTerms, { 0: [{ courseKey: 'S25' }] });
  assert.deepEqual(seed.extraTerms.map((t) => t.term), ['Summer 2023', 'Who knows']);
});

test('pastTermsSeed: nothing past or current, or no startTerm → null', () => {
  const plan = { semesters: [[], [], [], [], [], [{ courseKey: 'Y3S' }], [], []], gridSummerTerms: {}, extraTerms: [] };
  assert.equal(pastTermsSeed(plan, { startTerm: FALL_2024, today: TODAY }), null);
  assert.equal(pastTermsSeed({ semesters: [[{ courseKey: 'A' }]] }, { startTerm: null, today: TODAY }), null);
  assert.equal(pastTermsSeed({}, { startTerm: FALL_2024, today: TODAY }), null);
});
