// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionTypeLabel, describeTypeAndSection, describeSectionName, shortCourseCode, describeInstructors } from './sectionType.js';

// Every (component, componentLabel) pair in the Spring 2027 schedule export, and
// what the helper should say for it.
const SPRING_2027 = [
  ['APP', 'Applied Art', 'APP'],
  ['CAP', 'Applied/Performance Instruction', 'CAP'],
  ['CLN', 'CLN', 'CLN'],
  ['DID', 'DID', 'DID'],
  ['DIS', 'Discussion Section', 'DIS'],
  ['DRS', 'Directed Study', 'DRS'],
  ['EXP', 'Clinical Experience', 'EXP'],
  ['IND', 'Independent Course', 'IND'],
  ['LAB', 'Laboratory', 'LAB'],
  ['LEC', 'Lecture', 'LEC'],
  ['LRG', 'LRG', 'LRG'],
  ['MUE', 'Music Ensemble (Small)', 'MUE'],
  ['MUO', 'Music Ensemble (Large)', 'MUO'],
  ['OTH', 'Other', 'OTH'],
  ['PCL', 'PCL', 'PCL'],
  ['PLB', 'Pre-lab Section', 'PRE'],
  ['PLC', 'Placement', 'PLC'],
  ['RSC', 'RSC', 'RSC'],
  ['SML', 'SML', 'SEM'],
  ['', '', 'OTH'],
];

test('every component value in the Spring 2027 data gets a 3-letter code and its picker label', () => {
  for (const [component, componentLabel, abbr] of SPRING_2027) {
    const t = sectionTypeLabel({ component, componentLabel });
    assert.equal(t.abbr, abbr, `${component || '(blank)'}`);
    assert.match(t.abbr, /^[A-Z]{3}$/);
    assert.equal(t.full, component ? (componentLabel || component) : 'Other');
  }
});

test('a component that is not short falls back to a label map, then to the first 3 letters', () => {
  assert.equal(sectionTypeLabel({ component: 'SEMINAR', componentLabel: 'Seminar' }).abbr, 'SEM');
  assert.equal(sectionTypeLabel({ component: 'RECIT', componentLabel: 'Recitation' }).abbr, 'REC');
  assert.equal(sectionTypeLabel({ component: 'STUDIO', componentLabel: 'Studio' }).abbr, 'STU');
  assert.equal(sectionTypeLabel({ component: 'WORKSHOP', componentLabel: 'Workshop' }).abbr, 'WOR');
  assert.equal(sectionTypeLabel({ component: 'WORKSHOP' }).full, 'WORKSHOP');
});

test('names for lists and tooltips', () => {
  const a1 = { component: 'LEC', componentLabel: 'Lecture', classSection: 'A1' };
  assert.equal(describeTypeAndSection(a1), 'LEC A1');
  assert.equal(describeSectionName(a1, 'CAS CH 110'), 'CAS CH 110 LEC A1');
  assert.equal(shortCourseCode('CAS CH 110'), 'CH 110');
  assert.equal(shortCourseCode('CH 110'), 'CH 110');
  assert.equal(describeInstructors({ instructors: [{ first: 'Kate', last: 'Bravaya' }, { last: 'Staff' }] }), 'K. Bravaya, Staff');
  assert.equal(describeInstructors({}), '');
});
