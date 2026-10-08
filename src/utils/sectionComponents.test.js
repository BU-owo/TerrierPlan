// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSectionsByComponent } from './sectionComponents.js';

const CS132_NOTE = 'Students registering for CS132 must register for both a lecture section and a discussion section. Students in all CS132 sections must reserve Tuesday 6:30 - 7:45pm for exams during the semester.';
const sec = (id, component, notes) => ({ id, classSection: id, component, componentLabel: component, notes });
const lec = (groups) => groups.find((g) => g.key === 'LEC');

test('a note on every section of the group is hoisted to commonNotes', () => {
  const groups = groupSectionsByComponent([sec('A1', 'LEC', CS132_NOTE), sec('A2', 'LEC', CS132_NOTE)]);
  assert.equal(lec(groups).commonNotes, CS132_NOTE);
});

test('a note on only one section is not hoisted (CS132: A1 has it, A2 is blank)', () => {
  const groups = groupSectionsByComponent([
    sec('A1', 'LEC', CS132_NOTE),
    sec('A2', 'LEC', ''),
    sec('B1', 'DIS', ''),
  ]);
  assert.equal(lec(groups).commonNotes, null);
  assert.equal(groups.find((g) => g.key === 'DIS').commonNotes, null);
});

test('different notes are not hoisted; surrounding whitespace is ignored for the comparison', () => {
  assert.equal(lec(groupSectionsByComponent([sec('A1', 'LEC', 'x'), sec('A2', 'LEC', 'y')])).commonNotes, null);
  assert.equal(lec(groupSectionsByComponent([sec('A1', 'LEC', ' x '), sec('A2', 'LEC', 'x')])).commonNotes, 'x');
});

test('a group of blank notes has no commonNotes', () => {
  assert.equal(lec(groupSectionsByComponent([sec('A1', 'LEC', ''), sec('A2', 'LEC', undefined)])).commonNotes, null);
});
