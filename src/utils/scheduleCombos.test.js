// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationSlots, generateSchedules, pinInGroup } from './scheduleCombos.js';
import { UNKNOWN_KEY } from './sectionComponents.js';

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
