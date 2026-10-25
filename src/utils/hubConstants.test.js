// Run with: node --test src/utils/hubConstants.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import { neededUnitCodes, FIRST_YEAR_REQUIREMENTS, TRANSFER_REQUIREMENTS } from './hubConstants.js';

test('empty counts: every code in the table is needed', () => {
  const needed = neededUnitCodes({}, FIRST_YEAR_REQUIREMENTS);
  for (const code of ['PLM', 'SI1', 'SI2', 'SO2', 'GCI', 'WIN', 'CRI']) assert.ok(needed.has(code), code);
});

test('a satisfied single requirement drops its code', () => {
  const needed = neededUnitCodes({ PLM: 1 }, FIRST_YEAR_REQUIREMENTS);
  assert.equal(needed.has('PLM'), false);
  assert.ok(needed.has('AEX'));
});

test('required 2 with 1 done: still needed; with 2 done: not', () => {
  assert.ok(neededUnitCodes({ GCI: 1 }, FIRST_YEAR_REQUIREMENTS).has('GCI'));
  assert.equal(neededUnitCodes({ GCI: 2 }, FIRST_YEAR_REQUIREMENTS).has('GCI'), false);
});

test('OR group: one option satisfies and drops every option', () => {
  const needed = neededUnitCodes({ SI2: 1 }, FIRST_YEAR_REQUIREMENTS);
  assert.equal(needed.has('SI2'), false);
  assert.equal(needed.has('SO2'), false);
});

test('follows the table passed in (transfer vs first-year)', () => {
  assert.ok(neededUnitCodes({ GCI: 1 }, FIRST_YEAR_REQUIREMENTS).has('GCI'));
  const transfer = neededUnitCodes({ GCI: 1 }, TRANSFER_REQUIREMENTS);
  assert.equal(transfer.has('GCI'), false);
  assert.equal(transfer.has('IIC'), false);
  assert.equal(transfer.has('FYW'), false); // not in the transfer table at all
});
