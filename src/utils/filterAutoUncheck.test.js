// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilterToPicks } from './filterAutoUncheck.js';

const sec = (id, courseKey, component, early = false) => ({ id, courseKey, component, early });
const sections = {
  a1: sec('a1', 'A', 'LEC'), a2: sec('a2', 'A', 'LEC', true), a3: sec('a3', 'A', 'LEC', true),
  d1: sec('d1', 'A', 'DIS', true), d2: sec('d2', 'A', 'DIS'),
  b1: sec('b1', 'B', 'LEC', true),
};
const sectionOf = (id) => sections[id];
const noEarly = (s) => !s.early;
const everything = () => true;
const draft = () => [
  { courseKey: 'A', considering: { LEC: ['a1', 'a2', 'a3'], DIS: ['d1', 'd2'] }, locked: [] },
  { courseKey: 'B', considering: { LEC: ['b1'] }, locked: ['b1'] },
];

test('tightening unchecks the sections that fail and remembers exactly those', () => {
  const { draftCourses, remembered } = applyFilterToPicks(draft(), new Set(), sectionOf, noEarly);
  assert.deepEqual(draftCourses[0].considering, { LEC: ['a1'], DIS: ['d2'] });
  assert.deepEqual([...remembered].sort(), ['a2', 'a3', 'd1']);
});

test('pinned sections are never unchecked, even if they fail', () => {
  const { draftCourses, remembered } = applyFilterToPicks(draft(), new Set(), sectionOf, noEarly);
  assert.deepEqual(draftCourses[1].considering, { LEC: ['b1'] });
  assert.equal(remembered.has('b1'), false);
});

test('clearing the filter checks exactly the remembered ones again and forgets them', () => {
  const tight = applyFilterToPicks(draft(), new Set(), sectionOf, noEarly);
  const loose = applyFilterToPicks(tight.draftCourses, tight.remembered, sectionOf, everything);
  assert.deepEqual(loose.draftCourses[0].considering.LEC.sort(), ['a1', 'a2', 'a3']);
  assert.deepEqual(loose.draftCourses[0].considering.DIS.sort(), ['d1', 'd2']);
  assert.equal(loose.remembered.size, 0);
});

test('a partial loosening restores what passes and keeps the rest remembered', () => {
  const tight = applyFilterToPicks(draft(), new Set(), sectionOf, noEarly);
  const onlyA2Passes = (s) => !s.early || s.id === 'a2';
  const next = applyFilterToPicks(tight.draftCourses, tight.remembered, sectionOf, onlyA2Passes);
  assert.deepEqual(next.draftCourses[0].considering.LEC.sort(), ['a1', 'a2']);
  assert.deepEqual([...next.remembered].sort(), ['a3', 'd1']);
});

test('a section checked by hand while the filter is on stays checked (exempt), even when it fails', () => {
  const tight = applyFilterToPicks(draft(), new Set(), sectionOf, noEarly);
  // The student checks a2 by hand while the filter is on; the page forgets it and exempts it.
  const picks = tight.draftCourses.map((c) => (c.courseKey === 'A' ? { ...c, considering: { ...c.considering, LEC: [...c.considering.LEC, 'a2'] } } : c));
  const remembered = new Set(tight.remembered);
  remembered.delete('a2');
  const exempt = new Set(['a2']);
  // Tightening again leaves it alone...
  const again = applyFilterToPicks(picks, remembered, sectionOf, noEarly, exempt);
  assert.equal(again.draftCourses[0].considering.LEC.includes('a2'), true);
  // ...and clearing the filter restores the others without doubling it up.
  const loose = applyFilterToPicks(again.draftCourses, again.remembered, sectionOf, everything, exempt);
  assert.deepEqual(loose.draftCourses[0].considering.LEC.sort(), ['a1', 'a2', 'a3']);
});

test('nothing to do returns the same objects; a removed course is forgotten', () => {
  const d = draft();
  const r = new Set();
  const same = applyFilterToPicks(d, r, sectionOf, everything);
  assert.equal(same.draftCourses, d);
  assert.equal(same.remembered, r);
  const gone = applyFilterToPicks([d[1]], new Set(['a2']), sectionOf, everything);
  assert.equal(gone.remembered.size, 0);
});
