// Run with: node --test src/utils/sectionVisibility.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import { isVisibleSection } from './sectionVisibility.js';

test('Cancelled and Stop Enrl sections are hidden', () => {
  assert.equal(isVisibleSection({ classStat: 'Cancelled' }), false);
  assert.equal(isVisibleSection({ classStat: 'Stop Enrl' }), false);
});

test('surrounding whitespace is ignored', () => {
  assert.equal(isVisibleSection({ classStat: ' Cancelled ' }), false);
  assert.equal(isVisibleSection({ classStat: 'Stop Enrl\t' }), false);
});

test('Active and Tentative sections are visible', () => {
  assert.equal(isVisibleSection({ classStat: 'Active' }), true);
  assert.equal(isVisibleSection({ classStat: 'Tentative' }), true);
});

test('a missing or blank classStat counts as visible', () => {
  assert.equal(isVisibleSection({}), true);
  assert.equal(isVisibleSection({ classStat: '' }), true);
  assert.equal(isVisibleSection({ classStat: null }), true);
  assert.equal(isVisibleSection(undefined), true);
});
