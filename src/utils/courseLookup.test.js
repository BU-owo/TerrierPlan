import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNetworkShortBatch } from './courseLookup.js';

test('short batch served from cache is a network problem', () => {
  assert.equal(isNetworkShortBatch({ requested: 30, received: 0, fromCache: true, online: true }), true);
  assert.equal(isNetworkShortBatch({ requested: 30, received: 12, fromCache: true, online: true }), true);
});

test('short batch while the browser is offline is a network problem', () => {
  assert.equal(isNetworkShortBatch({ requested: 5, received: 0, fromCache: false, online: false }), true);
});

test('short batch served by the server is not (the courses are missing)', () => {
  assert.equal(isNetworkShortBatch({ requested: 5, received: 3, fromCache: false, online: true }), false);
  assert.equal(isNetworkShortBatch({ requested: 1, received: 0, fromCache: false, online: true }), false);
});

test('a full batch is never a network problem, cached or offline', () => {
  assert.equal(isNetworkShortBatch({ requested: 4, received: 4, fromCache: true, online: false }), false);
  assert.equal(isNetworkShortBatch({ requested: 4, received: 4, fromCache: false, online: true }), false);
});

test('an empty request is never a network problem', () => {
  assert.equal(isNetworkShortBatch({ requested: 0, received: 0, fromCache: true, online: false }), false);
});
