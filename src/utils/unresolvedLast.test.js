// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { unresolvedLast } from './unresolvedLast.js';

const n = (id, type = 'COUNT') => ({ id, type });
const ids = (list) => list.map((c) => c.id);

test('UNRESOLVED children go last; both groups keep their original order', () => {
  const input = [n('u1', 'UNRESOLVED'), n('a'), n('u2', 'UNRESOLVED'), n('b', 'ALL'), n('c', 'REMAINDER'), n('u3', 'UNRESOLVED')];
  assert.deepEqual(ids(unresolvedLast(input)), ['a', 'b', 'c', 'u1', 'u2', 'u3']);
});

test('does not mutate the input or the nodes', () => {
  const input = [n('u', 'UNRESOLVED'), n('a')];
  const snapshot = JSON.stringify(input);
  const out = unresolvedLast(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(out, input);
  assert.equal(out[0], input[1]); // same node objects, just reordered
});

test('nested case: applies independently at each level (the caller applies it per container)', () => {
  const tree = n('root', 'ALL');
  tree.children = [n('u', 'UNRESOLVED'), { id: 'box', type: 'ALL', children: [n('inner-u', 'UNRESOLVED'), n('inner-a')] }, n('z')];
  const top = unresolvedLast(tree.children);
  assert.deepEqual(ids(top), ['box', 'z', 'u']);
  assert.deepEqual(ids(unresolvedLast(top[0].children)), ['inner-a', 'inner-u']);
});

test('all UNRESOLVED and none UNRESOLVED keep their order', () => {
  assert.deepEqual(ids(unresolvedLast([n('x', 'UNRESOLVED'), n('y', 'UNRESOLVED')])), ['x', 'y']);
  assert.deepEqual(ids(unresolvedLast([n('x'), n('y', 'ALL'), n('z', 'ONE_OF')])), ['x', 'y', 'z']);
});

test('empty and non-array input pass through', () => {
  assert.deepEqual(unresolvedLast([]), []);
  assert.equal(unresolvedLast(undefined), undefined);
});
