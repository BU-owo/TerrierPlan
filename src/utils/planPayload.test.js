import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanPayload, PLAN_SNAPSHOT_FIELDS } from './planPayload.js';

const base = { name: 'Plan A', semesters: { 0: [] }, isTransfer: false };

test('a null snapshot field stays null (never filled from another plan)', () => {
  const payload = buildPlanPayload(base, {
    majorBulletinUrl: null,
    cumulativeGpa: null,
    earnedCredits: null,
    gradePoints: null,
  });
  assert.equal(payload.majorBulletinUrl, null);
  assert.equal(payload.cumulativeGpa, null);
  assert.equal(payload.earnedCredits, null);
  assert.equal(payload.gradePoints, null);
});

test('fields missing from the snapshot are left out of the update', () => {
  const payload = buildPlanPayload(base, { extraTerms: [] });
  assert.deepEqual(Object.keys(payload).sort(), ['extraTerms', 'isTransfer', 'name', 'semesters']);
  for (const field of PLAN_SNAPSHOT_FIELDS.filter((f) => f !== 'extraTerms')) {
    assert.equal(Object.prototype.hasOwnProperty.call(payload, field), false, field);
  }
});

test('undefined snapshot values are left out (Firestore rejects undefined)', () => {
  const payload = buildPlanPayload({ ...base, isTransfer: undefined }, { stash: undefined, majorBulletinUrl: 'x' });
  assert.equal('isTransfer' in payload, false);
  assert.equal('stash' in payload, false);
  assert.equal(payload.majorBulletinUrl, 'x');
});

test('every snapshot field is copied as given', () => {
  const extras = {
    gridSummerTerms: { 2027: ['CASCS111'] },
    majorBulletinUrl: 'https://bulletin/major',
    extraTerms: [{ term: 'x', courseKeys: [] }],
    cumulativeGpa: 3.5,
    earnedCredits: 64,
    gradePoints: 224,
    requirementOverrides: { n1: { type: 'waive' } },
    stash: ['CASMA123'],
  };
  const payload = buildPlanPayload(base, extras);
  for (const field of PLAN_SNAPSHOT_FIELDS) assert.deepEqual(payload[field], extras[field], field);
  assert.equal(payload.name, 'Plan A');
});

test('no extras at all gives just the base fields', () => {
  assert.deepEqual(buildPlanPayload(base), base);
  assert.deepEqual(buildPlanPayload(base, null), base);
});

test('unknown extras keys are ignored', () => {
  const payload = buildPlanPayload(base, { externalCredits: [{ id: 1 }], foo: 1 });
  assert.equal('externalCredits' in payload, false);
  assert.equal('foo' in payload, false);
});
