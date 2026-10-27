// Run with: node --test src/utils/courseTitle.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import { displayCourseTitle } from './courseTitle.js';

test('ALL CAPS titles are title-cased word by word', () => {
  assert.equal(displayCourseTitle('DATA MANAGEMENT'), 'Data Management');
  assert.equal(displayCourseTitle('URBAN POLITICS'), 'Urban Politics');
  assert.equal(displayCourseTitle('INTERNATNL CRSE'), 'Internatnl Crse');
  assert.equal(displayCourseTitle('T:CINEMA&MEDIA'), 'T:Cinema&Media');
});

test('short tokens (3 letters or fewer) and roman numerals are left alone', () => {
  assert.equal(displayCourseTitle('INTRO TO AI'), 'Intro TO AI');
  assert.equal(displayCourseTitle('HUB SEMINAR II'), 'HUB Seminar II');
  assert.equal(displayCourseTitle('DS: ART HISTORY'), 'DS: ART History');
  assert.equal(displayCourseTitle('FRENCH VIII'), 'French VIII');
  assert.equal(displayCourseTitle('CIVIL RIGHTS'), 'Civil Rights'); // only letters I/V/X/L/C, but not a numeral
  assert.equal(displayCourseTitle('SEM 20C ARCHIT'), 'SEM 20C Archit');
});

test("apostrophes stay inside the word", () => {
  assert.equal(displayCourseTitle("WOMEN'S HISTORY"), "Women's History");
});

test('titles with any lowercase letter, and non-strings, are unchanged', () => {
  assert.equal(displayCourseTitle('Managing Data Resources'), 'Managing Data Resources');
  assert.equal(displayCourseTitle('Intro to AI for BUSINESS'), 'Intro to AI for BUSINESS');
  assert.equal(displayCourseTitle(''), '');
  assert.equal(displayCourseTitle(undefined), undefined);
  assert.equal(displayCourseTitle(null), null);
});
