// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPendingWriteFlush, flushAllPendingWrites } from './pendingWrites.js';

test('nothing registered: true', async () => {
  assert.equal(await flushAllPendingWrites(), true);
});

test('every flush runs; true when all succeed (true, undefined or a resolved true)', async () => {
  const calls = [];
  const offs = [
    registerPendingWriteFlush(() => { calls.push('sync'); }),
    registerPendingWriteFlush(() => { calls.push('bool'); return true; }),
    registerPendingWriteFlush(async () => { calls.push('async'); return true; }),
  ];
  assert.equal(await flushAllPendingWrites(), true);
  assert.deepEqual(calls.sort(), ['async', 'bool', 'sync']);
  offs.forEach((off) => off());
});

test('false when any flush returns false, throws or rejects', async () => {
  for (const bad of [() => false, async () => false, () => { throw new Error('x'); }, () => Promise.reject(new Error('y'))]) {
    const offOk = registerPendingWriteFlush(() => true);
    const offBad = registerPendingWriteFlush(bad);
    assert.equal(await flushAllPendingWrites(), false);
    offOk();
    offBad();
  }
});

test('false when a flush hangs past the timeout', async () => {
  const off = registerPendingWriteFlush(() => new Promise(() => {}));
  assert.equal(await flushAllPendingWrites(20), false);
  off();
});

test('unregistered flushes are not called', async () => {
  let called = false;
  const off = registerPendingWriteFlush(() => { called = true; return false; });
  off();
  assert.equal(await flushAllPendingWrites(), true);
  assert.equal(called, false);
});
