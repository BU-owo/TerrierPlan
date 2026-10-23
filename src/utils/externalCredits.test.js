// Run with: node --test src/utils/externalCredits.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import { externalCreditCourseKeys } from './externalCredits.js';

test('auto-resolved "A+B" courseKey splits into both keys', () => {
  assert.deepEqual(externalCreditCourseKeys({ courseKey: 'CASMA123+CASMA124' }), ['CASMA123', 'CASMA124']);
});

test('tolerates spaces, case and stray plus signs', () => {
  assert.deepEqual(externalCreditCourseKeys({ courseKey: ' casma123 + CAS MA124 +' }), ['CASMA123', 'CASMA124']);
});

test('single courseKey is unchanged', () => {
  assert.deepEqual(externalCreditCourseKeys({ courseKey: 'CASCS111' }), ['CASCS111']);
});

test('null, empty and missing credits give no keys', () => {
  assert.deepEqual(externalCreditCourseKeys(null), []);
  assert.deepEqual(externalCreditCourseKeys({}), []);
  assert.deepEqual(externalCreditCourseKeys({ courseKey: '' }), []);
  assert.deepEqual(externalCreditCourseKeys({ courseKey: '+' }), []);
});

test('manualCourses / manualCourseKey fallback is unaffected', () => {
  assert.deepEqual(externalCreditCourseKeys({ courseKey: null, manualCourses: ['CASBI105', 'CASBI107'] }), ['CASBI105', 'CASBI107']);
  assert.deepEqual(externalCreditCourseKeys({ courseKey: null, manualCourseKey: 'CASBI108' }), ['CASBI108']);
});
