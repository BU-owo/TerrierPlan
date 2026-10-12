// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationSlots, generateSchedules, generateSchedulesAsync, pinInGroup, MAX_EXPLORED, MAX_RESULTS } from './scheduleCombos.js';
import { UNKNOWN_KEY } from './sectionComponents.js';
import { sectionsConflict } from './sectionTime.js';

const sec = (id, component, daysOfWeek, startTime, endTime) => ({
  id, courseKey: 'A', component, componentLabel: component, daysOfWeek, startTime, endTime,
});

// l0 and l1 overlap; l2 doesn't overlap either. One discussion, no overlap.
const sections = [
  sec('l0', 'LEC', 'Mon Wed', '10:10AM', '11:00AM'),
  sec('l1', 'LEC', 'Mon Wed', '10:30AM', '11:20AM'),
  sec('l2', 'LEC', 'Tue Thu', '10:10AM', '11:00AM'),
  sec('d0', 'DIS', 'Fri', '02:30PM', '03:20PM'),
  sec('o0', '', 'Mon', '05:00PM', '06:00PM'),
  sec('o1', '', 'Tue', '05:00PM', '06:00PM'),
];
const sectionsById = Object.fromEntries(sections.map((s) => [s.id, s]));
const sectionsByCourse = { A: sections };
const isLec = (id) => sectionsById[id].component === 'LEC';

test('pinning a second LEC replaces the first, which goes back to checked', () => {
  let course = { courseKey: 'A', considering: { LEC: ['l0', 'l1'], DIS: ['d0'] }, locked: [] };
  course = pinInGroup(course, 'LEC', 'l0', sectionsById);
  assert.deepEqual(course.locked, ['l0']);
  assert.deepEqual(course.considering.LEC, []);
  course = pinInGroup(course, 'LEC', 'l2', sectionsById);
  assert.deepEqual(course.locked, ['l2']);
  assert.deepEqual(course.considering.LEC, ['l0']);
  assert.deepEqual(course.considering.DIS, ['d0']);
});

test('pins in other components are kept', () => {
  let course = { courseKey: 'A', considering: {}, locked: ['d0', 'l0'] };
  course = pinInGroup(course, 'LEC', 'l1', sectionsById);
  assert.deepEqual(course.locked, ['d0', 'l1']);
});

test('two pins in the "Other" group both stay', () => {
  let course = { courseKey: 'A', considering: { [UNKNOWN_KEY]: ['o1'] }, locked: [] };
  course = pinInGroup(course, UNKNOWN_KEY, 'o0', sectionsById);
  course = pinInGroup(course, UNKNOWN_KEY, 'o1', sectionsById);
  assert.deepEqual(course.locked, ['o0', 'o1']);
  assert.deepEqual(course.considering[UNKNOWN_KEY], []);
});

test('two pinned LECs (old draft) generate schedules with exactly one LEC', () => {
  const draft = [{ courseKey: 'A', considering: { DIS: ['d0'], [UNKNOWN_KEY]: ['o0'] }, locked: ['l0', 'l2'] }];
  const slots = buildGenerationSlots(draft, sectionsByCourse, sectionsById);
  assert.deepEqual(slots.map((s) => s.options), [['l0', 'l2'], ['d0'], ['o0']]);
  const { schedules } = generateSchedules(slots, sectionsById);
  assert.equal(schedules.length, 2);
  for (const ids of schedules) assert.equal(ids.filter(isLec).length, 1);
});

test('overlapping pinned LECs still produce schedules', () => {
  const draft = [{ courseKey: 'A', considering: { DIS: ['d0'], [UNKNOWN_KEY]: ['o0'] }, locked: ['l0', 'l1'] }];
  const { schedules } = generateSchedules(buildGenerationSlots(draft, sectionsByCourse, sectionsById), sectionsById);
  assert.equal(schedules.length, 2);
  for (const ids of schedules) assert.equal(ids.filter(isLec).length, 1);
});

test('one pin stays forced; "Other" pins are each forced', () => {
  const draft = [{ courseKey: 'A', considering: { LEC: ['l1'], DIS: ['d0'] }, locked: ['l0', 'o0', 'o1'] }];
  const slots = buildGenerationSlots(draft, sectionsByCourse, sectionsById);
  assert.deepEqual(slots.map((s) => s.options), [['l0'], ['d0'], ['o0'], ['o1']]);
});

test('same picks in a different click order give identical ordered results', () => {
  const a = { courseKey: 'A', considering: { LEC: ['l0', 'l1', 'l2'], DIS: ['d0'] }, locked: ['o0', 'o1'] };
  const b = { courseKey: 'A', considering: { LEC: ['l2', 'l0', 'l1'], DIS: ['d0'] }, locked: ['o1', 'o0'] };
  const run = (course) => generateSchedules(buildGenerationSlots([course], sectionsByCourse, sectionsById), sectionsById);
  const first = run(a);
  assert.ok(first.schedules.length > 1);
  assert.deepEqual(run(b), first);
});

// The search generateSchedules used before fewest-options-first and forward
// checking, kept here only as a reference: slot by slot in the given order,
// each candidate checked against everything already picked.
function referenceSearch(slots, sectionsById, limit = MAX_RESULTS) {
  const lists = slots.filter((s) => s.options.length > 0).map((s) => s.options);
  const schedules = [];
  let explored = 0;
  let truncated = false;
  function backtrack(i, chosen) {
    if (i === lists.length) {
      schedules.push([...chosen]);
      if (schedules.length >= limit) truncated = true;
      return;
    }
    for (const sectionId of lists[i]) {
      if (truncated) return;
      explored++;
      if (explored > MAX_EXPLORED) {
        truncated = true;
        return;
      }
      const candidate = sectionsById[sectionId];
      if (!candidate) continue;
      if (chosen.some((id) => sectionsConflict(sectionsById[id], candidate))) continue;
      chosen.push(sectionId);
      backtrack(i + 1, chosen);
      chosen.pop();
    }
  }
  if (lists.length > 0) backtrack(0, []);
  return { schedules, truncated, explored };
}

const asSet = (schedules) => schedules.map((ids) => ids.join('|')).sort();

// Same set as the reference search, sorted by id tuple, and the async
// version returns exactly what the sync one does.
async function assertMatchesReference(slots, byId, yieldEvery = 3) {
  const expected = referenceSearch(slots, byId);
  const actual = generateSchedules(slots, byId);
  assert.equal(expected.truncated, false);
  assert.equal(actual.truncated, false);
  assert.deepEqual(asSet(actual.schedules), asSet(expected.schedules));
  const keys = actual.schedules.map((ids) => ids.join('|'));
  assert.deepEqual(keys, [...keys].sort());
  assert.deepEqual(await generateSchedulesAsync(slots, byId, { yieldEvery }), actual);
  return { expected, actual };
}

test('new search finds the same schedules: checked sections only', async () => {
  const draft = [{ courseKey: 'A', considering: { LEC: ['l2', 'l0', 'l1'], DIS: ['d0'], [UNKNOWN_KEY]: ['o1', 'o0'] }, locked: [] }];
  const { actual } = await assertMatchesReference(buildGenerationSlots(draft, sectionsByCourse, sectionsById), sectionsById);
  assert.ok(actual.schedules.length > 1);
});

test('new search finds the same schedules: locked sections', async () => {
  const draft = [{ courseKey: 'A', considering: { LEC: ['l1', 'l2'], DIS: ['d0'] }, locked: ['o0', 'o1'] }];
  const { actual } = await assertMatchesReference(buildGenerationSlots(draft, sectionsByCourse, sectionsById), sectionsById);
  for (const ids of actual.schedules) assert.ok(ids.includes('o0') && ids.includes('o1'));
});

test('new search finds the same schedules: pinned pick-one slot', async () => {
  const draft = [{ courseKey: 'A', considering: { DIS: ['d0'], [UNKNOWN_KEY]: ['o0'] }, locked: ['l1', 'l0', 'l2'] }];
  const slots = buildGenerationSlots(draft, sectionsByCourse, sectionsById);
  assert.deepEqual(slots[0].options, ['l0', 'l1', 'l2']);
  const { actual } = await assertMatchesReference(slots, sectionsById);
  assert.equal(actual.schedules.length, 3);
});

test('new search finds the same schedules: zero-option slot and a missing section', async () => {
  const slots = [{ options: ['l0', 'l2', 'gone'] }, { options: [] }, { options: ['d0'] }];
  const { actual } = await assertMatchesReference(slots, sectionsById);
  assert.deepEqual(actual.schedules, [['l0', 'd0'], ['l2', 'd0']]);
});

test('new search finds the same schedules: no schedule possible', async () => {
  // l0 and l1 overlap and each is the only option in its slot.
  const { actual } = await assertMatchesReference([{ options: ['d0'] }, { options: ['l0'] }, { options: ['l1'] }], sectionsById);
  assert.deepEqual(actual.schedules, []);
});

// 7 courses (4 LECs and 6 DISs each), sections spread over a few
// days and start times so lots of picks conflict. Deterministic, and sized
// so the reference search finishes under MAX_EXPLORED (~107k nodes).
function heavyFixture() {
  let seed = 12345;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const dayPatterns = ['Mon Wed', 'Tue Thu', 'Mon Wed Fri', 'Fri', 'Wed'];
  const clock = (min) => {
    const h = Math.floor(min / 60);
    return `${String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}${h >= 12 ? 'PM' : 'AM'}`;
  };
  const byId = {};
  const slots = [];
  for (let c = 0; c < 7; c++) {
    for (const [kind, count, length] of [['LEC', 4, 75], ['DIS', 6, 50]]) {
      const options = [];
      for (let s = 0; s < count; s++) {
        const id = `c${c}-${kind}-${s}`;
        const start = 8 * 60 + rand(7) * 60;
        byId[id] = { id, courseKey: `C${c}`, component: kind, daysOfWeek: dayPatterns[rand(dayPatterns.length)], startTime: clock(start), endTime: clock(start + length) };
        options.push(id);
      }
      slots.push({ options });
    }
  }
  return { slots, byId };
}

test('heavy draft: same schedules as the reference, visiting fewer nodes', async () => {
  const { slots, byId } = heavyFixture();
  const { expected, actual } = await assertMatchesReference(slots, byId, 500);
  assert.ok(actual.schedules.length > 0);
  assert.ok(actual.explored < expected.explored, `new ${actual.explored} vs reference ${expected.explored}`);
});
