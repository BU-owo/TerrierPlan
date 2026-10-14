// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { placedOverlaps, overlapTagText } from './manualOverlaps.js';

const m = (daysOfWeek, startTime, endTime, kind) => ({
  daysOfWeek, startTime, endTime, facilId: 'X 1', meetingStartDate: '01/19/2027', meetingEndDate: '04/29/2027', ...(kind ? { kind } : {}),
});
const sec = (id, courseKey, component, meetings) => ({ id, classSection: id, courseKey, component, meetings });

const cs132Lec = sec('cs132-A1', 'CS132', 'LEC', [m('Mon Wed', '09:00AM', '10:15AM')]);
const wr151Lec = sec('wr151-A1', 'WR151', 'LEC', [m('Mon Wed', '09:30AM', '10:45AM')]);

test('overlap with a placed section in another course', () => {
  const ch110 = sec('ch110-A1', 'CH110', 'LEC', [m('Mon', '10:00AM', '10:50AM')]);
  assert.deepEqual(placedOverlaps(ch110, [cs132Lec]), [cs132Lec]);
});

test('no overlap: different days or back to back', () => {
  assert.deepEqual(placedOverlaps(sec('a', 'CH110', 'LEC', [m('Tue Thu', '09:00AM', '10:15AM')]), [cs132Lec]), []);
  assert.deepEqual(placedOverlaps(sec('b', 'CH110', 'LEC', [m('Mon Wed', '10:15AM', '11:00AM')]), [cs132Lec]), []);
});

test('nothing placed: nothing overlaps', () => {
  assert.deepEqual(placedOverlaps(cs132Lec, []), []);
});

test('its own group is excluded: a sibling lecture does not tag, and a placed section does not tag itself', () => {
  const sibling = sec('cs132-A2', 'CS132', 'LEC', [m('Mon Wed', '09:00AM', '10:15AM')]);
  assert.deepEqual(placedOverlaps(sibling, [cs132Lec]), []);
  assert.deepEqual(placedOverlaps(cs132Lec, [cs132Lec]), []);
});

test('same component in a different course is a different group', () => {
  assert.deepEqual(placedOverlaps(wr151Lec, [cs132Lec]), [cs132Lec]);
});

test('same course, different component still counts (CS132 discussion vs CS132 lecture)', () => {
  const dis = sec('cs132-B1', 'CS132', 'DIS', [m('Mon', '09:30AM', '10:00AM')]);
  assert.deepEqual(placedOverlaps(dis, [cs132Lec]), [cs132Lec]);
});

test('sections with no meetings never overlap, either way round', () => {
  const none = sec('ch110-P1', 'CH110', 'PLB', []);
  assert.deepEqual(placedOverlaps(none, [cs132Lec]), []);
  assert.deepEqual(placedOverlaps(wr151Lec, [none]), []);
});

test('exam meetings never overlap', () => {
  const exam = sec('ch110-A2', 'CH110', 'LEC', [m('Mon', '09:00AM', '10:00AM', 'exam')]);
  assert.deepEqual(placedOverlaps(exam, [cs132Lec]), []);
});

test('several overlaps come back in placed order', () => {
  const cand = sec('x', 'CH110', 'LEC', [m('Mon', '09:00AM', '11:00AM')]);
  assert.deepEqual(placedOverlaps(cand, [wr151Lec, cs132Lec]), [wr151Lec, cs132Lec]);
});

test('tag text names the first and adds +N', () => {
  const nameOf = (s) => s.courseKey;
  assert.equal(overlapTagText([], nameOf), '');
  assert.equal(overlapTagText([cs132Lec], nameOf), 'CS132');
  assert.equal(overlapTagText([cs132Lec, wr151Lec], nameOf), 'CS132 +1');
});
