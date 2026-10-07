// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { combinationProduct, SLOW_GENERATION_PRODUCT } from './selectionEstimate.js';

const sec = (id, component) => ({ id, component, componentLabel: component });
const many = (prefix, component, n) => Array.from({ length: n }, (_, i) => sec(`${prefix}${i}`, component));

test('multiplies the checked options per component, across complete courses', () => {
  const sectionsByCourse = { A: [...many('a', 'LEC', 3), ...many('ad', 'DIS', 4)], B: many('b', 'LEC', 5) };
  const draft = [
    { courseKey: 'A', considering: { LEC: ['a0', 'a1'], DIS: ['ad0'] }, locked: [] },
    { courseKey: 'B', considering: { LEC: ['b0', 'b1', 'b2'] }, locked: [] },
  ];
  assert.equal(combinationProduct(draft, sectionsByCourse), 2 * 1 * 3);
});

test('an incomplete course is not generated, so it adds nothing', () => {
  const sectionsByCourse = { A: [...many('a', 'LEC', 3), ...many('ad', 'DIS', 4)] };
  const draft = [{ courseKey: 'A', considering: { LEC: ['a0'] }, locked: [] }];
  assert.equal(combinationProduct(draft, sectionsByCourse), 1);
});

test('selectAllFor counts every section of that course; pinned groups count once', () => {
  const sectionsByCourse = { A: [...many('a', 'LEC', 3), ...many('ad', 'DIS', 4)], B: many('b', 'LEC', 5) };
  const draft = [
    { courseKey: 'A', considering: {}, locked: [] },
    { courseKey: 'B', considering: { LEC: ['b0', 'b1'] }, locked: [] },
  ];
  assert.equal(combinationProduct(draft, sectionsByCourse, 'A'), 3 * 4 * 2);
  const pinned = [{ courseKey: 'A', considering: {}, locked: ['a0'] }];
  assert.equal(combinationProduct(pinned, sectionsByCourse, 'A'), 4);
});

test('a big course trips the slow-generation threshold', () => {
  const sectionsByCourse = { A: [...many('l', 'LEC', 20), ...many('d', 'DIS', 20), ...many('b', 'LAB', 30), ...many('p', 'PLB', 20)] };
  const draft = [{ courseKey: 'A', considering: {}, locked: [] }];
  assert.equal(combinationProduct(draft, sectionsByCourse, 'A'), 20 * 20 * 30 * 20);
  assert.ok(combinationProduct(draft, sectionsByCourse, 'A') > SLOW_GENERATION_PRODUCT);
});

test('with a filter, only sections that pass count (checked ones and select-all alike)', () => {
  const sectionsByCourse = { A: [...many('a', 'LEC', 4), ...many('d', 'DIS', 6)] };
  const passes = (s) => !s.id.endsWith('0') && !s.id.endsWith('1'); // 2 of each group fail
  const checked = [{ courseKey: 'A', considering: { LEC: ['a0', 'a1', 'a2', 'a3'], DIS: ['d0', 'd2', 'd3'] }, locked: [] }];
  assert.equal(combinationProduct(checked, sectionsByCourse, null, passes), 2 * 2);
  assert.equal(combinationProduct(checked, sectionsByCourse), 4 * 3);
  const none = [{ courseKey: 'A', considering: {}, locked: [] }];
  assert.equal(combinationProduct(none, sectionsByCourse, 'A', passes), 2 * 4);
  // A group with nothing left that passes makes the course incomplete: it adds nothing.
  assert.equal(combinationProduct(checked, sectionsByCourse, null, () => false), 1);
});
