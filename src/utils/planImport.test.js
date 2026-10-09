// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePlanBlob, MAX_SLOTS, MIN_SLOTS } from './planImport.js';

const URL_CS = 'https://www.bu.edu/academics/cas/programs/computer-science/ba/';
const catalogIds = new Set([
  'CASCS111', 'CASCS112', 'CASMA123', 'CASWR120', 'CASWR151', 'CASAA240E', 'CASCS330', 'CASEC101',
]);
const programs = {
  urls: new Set([URL_CS, 'https://www.bu.edu/academics/cas/programs/other/ba/']),
  requirements: [
    {
      bulletinUrl: URL_CS,
      tree: {
        id: 'cs-ba-root',
        children: [{ id: 'cs-ba-group-a' }, { id: 'cs-ba-group-b', children: [{ id: 'cs-ba-deep' }] }],
      },
    },
  ],
};
const ctx = { catalogIds, programs };

function validBlob(extra = {}) {
  return {
    format: 'terrierplan-plan',
    version: 1,
    exportedAt: '2026-10-09T00:00:00.000Z',
    name: 'My Plan',
    majorBulletinUrl: URL_CS,
    isTransfer: false,
    semesters: {
      0: [{ courseKey: 'CASCS111', locked: false, source: 'manual' }, { courseKey: 'CASMA123' }],
      1: ['CASCS112'],
    },
    gridSummerTerms: { 0: [], 1: [{ courseKey: 'CASEC101' }] },
    extraTerms: [{ term: 'Summer 2021', season: 'summer', courseKeys: ['CASWR120'], isPostDegree: false }],
    stash: ['CASCS330'],
    requirementOverrides: {},
    student: { completedCourseKeys: ['CASCS111'], externalCredits: [{ id: 'x' }] },
    ...extra,
  };
}

const droppedWhat = (r) => r.dropped.map((d) => d.what);

test('valid blob imports cleanly', () => {
  const r = sanitizePlanBlob(validBlob(), ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.dropped.length, 0);
  assert.equal(r.plan.name, 'My Plan');
  assert.equal(r.plan.majorBulletinUrl, URL_CS);
  assert.equal(r.plan.semesters.length, MIN_SLOTS);
  assert.deepEqual(r.plan.semesters[0].map((e) => e.courseKey), ['CASCS111', 'CASMA123']);
  assert.deepEqual(r.plan.semesters[0][0], { courseKey: 'CASCS111', locked: false, source: 'manual' });
  assert.deepEqual(r.plan.gridSummerTerms['0'], []);
  assert.equal(r.plan.gridSummerTerms['1'][0].courseKey, 'CASEC101');
  assert.deepEqual(r.plan.extraTerms, [{ term: 'Summer 2021', season: 'summer', courseKeys: ['CASWR120'], isPostDegree: false }]);
  assert.deepEqual(r.plan.stash, ['CASCS330']);
  assert.equal(r.summary.courseCount, 5);
  assert.equal(r.summary.years, 4);
});

test('wrong format is rejected', () => {
  for (const bad of [null, 'x', [], {}, validBlob({ format: 'other' }), validBlob({ format: undefined })]) {
    const r = sanitizePlanBlob(bad, ctx);
    assert.equal(r.plan, null);
    assert.equal(r.errors[0].code, 'wrong-format');
  }
});

test('version 2 is rejected as newer; bad versions as wrong format', () => {
  const r = sanitizePlanBlob(validBlob({ version: 2 }), ctx);
  assert.equal(r.plan, null);
  assert.equal(r.errors[0].code, 'newer-version');
  assert.match(r.errors[0].message, /newer version/);
  for (const v of [0, -1, 1.5, '1', null, undefined]) {
    assert.equal(sanitizePlanBlob(validBlob({ version: v }), ctx).errors[0].code, 'wrong-format');
  }
});

test('missing semesters is rejected', () => {
  for (const s of [undefined, null, 'x', 5]) {
    const r = sanitizePlanBlob(validBlob({ semesters: s }), ctx);
    assert.equal(r.plan, null);
    assert.equal(r.errors[0].code, 'missing-semesters');
  }
});

test('unknown, invalid and duplicate course keys are dropped and listed', () => {
  const r = sanitizePlanBlob(validBlob({
    semesters: {
      0: [{ courseKey: 'CASCS111' }, { courseKey: 'ZZZZZ999' }, { courseKey: 'not a key!!' }, { courseKey: 42 }, null, 'CASCS111'],
      1: [{ courseKey: 'CASCS111' }, { courseKey: 'CASCS112' }],
    },
    gridSummerTerms: {},
    extraTerms: [],
    stash: [],
  }), ctx);
  assert.deepEqual(r.plan.semesters[0].map((e) => e.courseKey), ['CASCS111']);
  assert.deepEqual(r.plan.semesters[1].map((e) => e.courseKey), ['CASCS112']);
  const reasons = Object.fromEntries(r.dropped.map((d) => [d.what, d.reason]));
  assert.equal(reasons.ZZZZZ999, 'not in the course catalog');
  assert.equal(reasons['not a key!!'], 'not a course code');
  assert.equal(reasons['(number)'], 'not a course code');
  assert.equal(reasons['(blank)'], 'not a course code');
  assert.equal(r.dropped.filter((d) => d.reason === 'already in the plan').length, 2);
});

test('...S session keys normalize to the catalog key; E keys that exist are kept', () => {
  const r = sanitizePlanBlob(validBlob({
    semesters: { 0: [{ courseKey: 'CASWR151S' }, { courseKey: 'casaa240e' }, { courseKey: 'CAS CS 111' }] },
    gridSummerTerms: {}, extraTerms: [], stash: [],
  }), ctx);
  assert.deepEqual(r.plan.semesters[0].map((e) => e.courseKey), ['CASWR151', 'CASAA240E', 'CASCS111']);
  assert.equal(r.dropped.length, 0);
});

test('__proto__, __x__ and empty keys are rejected everywhere', () => {
  const blob = JSON.parse(`{
    "format":"terrierplan-plan","version":1,"name":"x",
    "majorBulletinUrl":"${URL_CS}",
    "semesters":{"__proto__":[{"courseKey":"CASCS111"}],"__x__":[],"":[],"0":["CASCS112"]},
    "gridSummerTerms":{"__proto__":[],"__x__":[],"":[],"0":[]},
    "requirementOverrides":{"__proto__":{"type":"waive","createdAt":"2026-01-01T00:00:00Z"},"__x__":{"type":"waive","createdAt":"2026-01-01T00:00:00Z"},"":{"type":"waive","createdAt":"2026-01-01T00:00:00Z"},"cs-ba-group-a":{"type":"waive","createdAt":"2026-01-01T00:00:00Z"}}
  }`);
  const r = sanitizePlanBlob(blob, ctx);
  assert.deepEqual(r.plan.semesters[0].map((e) => e.courseKey), ['CASCS112']);
  assert.deepEqual(Object.keys(r.plan.gridSummerTerms), ['0']);
  assert.deepEqual(Object.keys(r.plan.requirementOverrides), ['cs-ba-group-a']);
  assert.equal(Object.getPrototypeOf(r.plan.semesters), Array.prototype);
  assert.equal(({}).polluted, undefined);
  assert.ok(r.dropped.length >= 6);
});

test('more than 16 slots are capped; fewer are padded to 8', () => {
  const semesters = {};
  for (let i = 0; i < 24; i++) semesters[i] = i === 20 ? ['CASCS330'] : [];
  semesters[15] = ['CASCS111'];
  const r = sanitizePlanBlob(validBlob({ semesters, gridSummerTerms: {}, extraTerms: [], stash: [] }), ctx);
  assert.equal(r.plan.semesters.length, MAX_SLOTS);
  assert.equal(r.plan.semesters[15][0].courseKey, 'CASCS111');
  assert.ok(r.dropped.some((d) => d.where === 'Slot 21' && /entries/.test(d.what)));

  const small = sanitizePlanBlob(validBlob({ semesters: { 0: ['CASCS111'] }, gridSummerTerms: {}, extraTerms: [], stash: [] }), ctx);
  assert.equal(small.plan.semesters.length, MIN_SLOTS);

  const odd = sanitizePlanBlob(validBlob({ semesters: { 8: ['CASCS111'] }, gridSummerTerms: {}, extraTerms: [], stash: [] }), ctx);
  assert.equal(odd.plan.semesters.length, 10);
});

test('an array of semesters is tolerated', () => {
  const r = sanitizePlanBlob(validBlob({ semesters: [['CASCS111'], ['CASCS112']] }), ctx);
  assert.deepEqual(r.plan.semesters[1].map((e) => e.courseKey), ['CASCS112']);
});

test('gridSummerTerms years outside 0-7 are dropped; empty arrays are kept', () => {
  const r = sanitizePlanBlob(validBlob({
    gridSummerTerms: { 0: [], 3: [], 7: [{ courseKey: 'CASEC101' }], 8: [], 99: [], '-1': [], x: [] },
  }), ctx);
  assert.deepEqual(Object.keys(r.plan.gridSummerTerms).sort(), ['0', '3', '7']);
  assert.deepEqual(r.plan.gridSummerTerms['0'], []);
  assert.deepEqual(r.plan.gridSummerTerms['3'], []);
  assert.equal(r.dropped.filter((d) => d.where === 'Summer').length, 4);
  // A year-7 Summer needs the grid to reach year 8.
  assert.equal(r.plan.semesters.length, 16);
});

test('placeholder credits are clamped, NaN defaults, text is capped, ids are fresh', () => {
  const note = (credits, text = 'x', id = 'same') => ({ kind: 'note', id, text, credits });
  const r = sanitizePlanBlob(validBlob({
    semesters: {
      0: [note(999), note(-5), note('abc'), note(NaN), note(null), note(2.5, 'a'.repeat(500)), note(4, 'tab\there\u0001 bad')],
    },
    gridSummerTerms: {}, extraTerms: [], stash: [],
  }), ctx);
  const notes = r.plan.semesters[0];
  assert.deepEqual(notes.map((n) => n.credits), [16, 0, 4, 4, 0, 2.5, 4]);
  assert.equal(notes[5].text.length, 100);
  assert.equal(notes[6].text, 'tab here bad');
  assert.equal(new Set(notes.map((n) => n.id)).size, notes.length);
  assert.ok(notes.every((n) => n.id !== 'same' && n.kind === 'note'));
  assert.equal(r.summary.placeholderCount, 7);
});

test('bad extraTerms seasons and shapes are dropped', () => {
  const r = sanitizePlanBlob(validBlob({
    extraTerms: [
      { term: 'Summer 2021', season: 'Summer', courseKeys: ['CASWR120'] },
      { term: 'Monsoon 2021', season: 'monsoon', courseKeys: ['CASCS330'] },
      { term: 'Fall 2022', season: 'fall', courseKeys: ['ZZZZZ999'] },
      { term: '', season: 'winter', courseKeys: ['CASEC101'] },
      'junk',
    ],
    stash: [],
  }), ctx);
  assert.deepEqual(r.plan.extraTerms.map((t) => t.term), ['Summer 2021']);
  assert.equal(r.plan.extraTerms[0].season, 'summer');
  assert.ok(r.dropped.length >= 4);
});

test('extraTerms is capped at 8 terms', () => {
  const terms = Array.from({ length: 12 }, (_, i) => ({ term: `Summer ${2000 + i}`, season: 'summer', courseKeys: [] }));
  const r = sanitizePlanBlob(validBlob({ extraTerms: terms }), ctx);
  assert.equal(r.plan.extraTerms.length, 0);
  assert.ok(r.dropped.some((d) => /4 more terms/.test(d.what)));
});

test('stash is capped, deduped and filtered', () => {
  const stash = Array.from({ length: 150 }, () => 'CASCS330');
  const r = sanitizePlanBlob(validBlob({ stash: ['ZZZZZ999', ...stash] }), ctx);
  assert.deepEqual(r.plan.stash, ['CASCS330']);
  assert.ok(r.dropped.some((d) => /more courses/.test(d.what)));
  assert.ok(r.dropped.some((d) => d.reason === 'listed twice'));
});

test('requirementOverrides need a known program and real node ids', () => {
  const override = { type: 'waive', note: 'n', createdAt: '2026-03-01T00:00:00.000Z' };
  const good = sanitizePlanBlob(validBlob({
    requirementOverrides: {
      'cs-ba-group-a': override,
      'cs-ba-deep': { type: 'substitute', courseKey: 'CASMA123', note: 'y'.repeat(500), createdAt: '2026-03-01' },
      'not-a-node': override,
      'cs-ba-group-b': { type: 'nuke', createdAt: '2026-03-01' },
      'cs-ba-root': { type: 'waive', createdAt: 'yesterday' },
    },
  }), ctx);
  assert.deepEqual(Object.keys(good.plan.requirementOverrides).sort(), ['cs-ba-deep', 'cs-ba-group-a']);
  assert.equal(good.plan.requirementOverrides['cs-ba-deep'].courseKey, 'CASMA123');
  assert.equal(good.plan.requirementOverrides['cs-ba-deep'].note.length, 200);
  assert.equal(good.plan.requirementOverrides['cs-ba-group-a'].type, 'waive');
  assert.equal('courseKey' in good.plan.requirementOverrides['cs-ba-group-a'], false);
  assert.equal(good.dropped.length, 3);

  // Known program (in bu-programs) but no requirement data for it.
  const noData = sanitizePlanBlob(validBlob({
    majorBulletinUrl: 'https://www.bu.edu/academics/cas/programs/other/ba/',
    requirementOverrides: { 'cs-ba-group-a': override },
  }), ctx);
  assert.deepEqual(noData.plan.requirementOverrides, {});
  assert.equal(noData.plan.majorBulletinUrl, 'https://www.bu.edu/academics/cas/programs/other/ba/');

  // Unknown program: major nulled, overrides dropped.
  const unknown = sanitizePlanBlob(validBlob({
    majorBulletinUrl: 'https://evil.example/x',
    requirementOverrides: { 'cs-ba-group-a': override },
  }), ctx);
  assert.equal(unknown.plan.majorBulletinUrl, null);
  assert.deepEqual(unknown.plan.requirementOverrides, {});
  assert.ok(unknown.dropped.some((d) => d.where === 'Major'));

  // Substitute with a bad course.
  const badSub = sanitizePlanBlob(validBlob({
    requirementOverrides: { 'cs-ba-group-a': { type: 'substitute', courseKey: 'ZZZZZ999', createdAt: '2026-03-01' } },
  }), ctx);
  assert.deepEqual(badSub.plan.requirementOverrides, {});
});

test('isTransfer must be exactly true', () => {
  for (const [input, expected] of [[true, true], [false, false], ['true', false], [1, false], [null, false], [undefined, false], [{}, false]]) {
    assert.equal(sanitizePlanBlob(validBlob({ isTransfer: input }), ctx).plan.isTransfer, expected);
  }
});

test('name: empty, huge and non-string values', () => {
  assert.equal(sanitizePlanBlob(validBlob({ name: '' }), ctx).plan.name, 'Imported Plan');
  assert.equal(sanitizePlanBlob(validBlob({ name: '   ' }), ctx).plan.name, 'Imported Plan');
  assert.equal(sanitizePlanBlob(validBlob({ name: 12345 }), ctx).plan.name, 'Imported Plan');
  assert.equal(sanitizePlanBlob(validBlob({ name: { a: 1 } }), ctx).plan.name, 'Imported Plan');
  assert.equal(sanitizePlanBlob(validBlob({ name: 'n'.repeat(5000) }), ctx).plan.name.length, 60);
  assert.equal(sanitizePlanBlob(validBlob({ name: 'a\n\tb\u0000c' }), ctx).plan.name, 'a bc');
});

test('the student field and unknown fields are ignored', () => {
  const r = sanitizePlanBlob(validBlob({ uid: 'abc', email: 'a@b.c', extra: { x: 1 } }), ctx);
  const text = JSON.stringify(r);
  assert.equal(text.includes('abc'), false);
  assert.equal(text.includes('a@b.c'), false);
  assert.equal(text.includes('completedCourseKeys'), false);
  assert.deepEqual(Object.keys(r.plan).sort(), [
    'extraTerms', 'gridSummerTerms', 'isTransfer', 'majorBulletinUrl', 'name', 'requirementOverrides', 'semesters', 'stash',
  ]);
});

test('no valid courses or placeholders: not importable, dropped list kept', () => {
  const r = sanitizePlanBlob(validBlob({
    semesters: { 0: ['ZZZZZ999'] }, gridSummerTerms: {}, extraTerms: [], stash: ['CASCS330'],
  }), ctx);
  assert.equal(r.plan, null);
  assert.equal(r.errors[0].code, 'no-courses');
  assert.equal(r.errors[0].message, 'No valid courses found.');
  assert.deepEqual(droppedWhat(r), ['ZZZZZ999']);

  const onlyNote = sanitizePlanBlob(validBlob({
    semesters: { 0: [{ kind: 'note', text: 'elective', credits: 4 }] }, gridSummerTerms: {}, extraTerms: [], stash: [],
  }), ctx);
  assert.ok(onlyNote.plan);
  assert.equal(onlyNote.summary.placeholderCount, 1);
});

test('never throws on hostile input', () => {
  const evil = { format: 'terrierplan-plan', version: 1, semesters: { get 0() { throw new Error('boom'); } } };
  const r = sanitizePlanBlob(evil, ctx);
  assert.equal(r.plan, null);
  assert.equal(r.errors.length, 1);
  assert.doesNotThrow(() => sanitizePlanBlob(undefined));
  assert.doesNotThrow(() => sanitizePlanBlob(validBlob(), {}));
  assert.doesNotThrow(() => sanitizePlanBlob(validBlob(), { catalogIds: 'nope', programs: 5 }));
});
