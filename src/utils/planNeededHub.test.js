// Run with: node --test src/utils/planNeededHub.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import { planHubNeeds, neededForStashedCourse } from './planNeededHub.js';
import { computeHubCounts } from './hubCounts.js';

const UNITS = {
  'CAS AA101': ['PLM'],
  'CAS AA102': ['GCI'],
  'CAS AA103': ['GCI'],
  'CAS AA104': ['AEX'],
};
const hubUnitsOf = (key) => UNITS[key];
const today = new Date('2026-10-01');
const emptyProfile = { completedCourseKeys: [], currentSemesterTarget: null, startTerm: null, externalCredits: [] };
const grid = (...slots) => Array.from({ length: 8 }, (_, i) => slots[i] ?? []);
const planOf = (semesters, extra = {}) => ({ semesters, gridSummerTerms: {}, extraTerms: [], isTransfer: false, ...extra });

test('computeHubCounts counts courses and AP, staged never counts', () => {
  const { counts, contributorsByUnit } = computeHubCounts({
    semesters: [['CAS AA101']],
    externalCredits: [{ type: 'ap', manualHubUnits: ['AEX'] }, { type: 'transfer', manualHubUnits: ['SI1'] }],
    hubUnitsOf,
    stashCourseKeys: ['CAS AA102'],
  });
  assert.deepEqual(counts, { PLM: 1, AEX: 1 });
  assert.equal(contributorsByUnit.GCI[0].type, 'staged');
});

test('empty plan: everything needed', () => {
  const { needed } = planHubNeeds({ plan: planOf(grid()), profile: emptyProfile, hubUnitsOf, today });
  assert.ok(needed.has('PLM') && needed.has('GCI') && needed.has('FYW'));
});

test('past and current satisfy, future planned does not', () => {
  const profile = { ...emptyProfile, currentSemesterTarget: 1 };
  const plan = planOf(grid(['CAS AA101'], ['CAS AA104'], ['CAS AA102']));
  const { needed } = planHubNeeds({ plan, profile, hubUnitsOf, today });
  assert.equal(needed.has('PLM'), false); // past
  assert.equal(needed.has('AEX'), false); // current
  assert.ok(needed.has('GCI')); // future
});

test('count > 1 stays needed until met (first-year); transfer table needs 1', () => {
  const profile = { ...emptyProfile, currentSemesterTarget: 3 };
  const one = planOf(grid(['CAS AA102']));
  assert.ok(planHubNeeds({ plan: one, profile, hubUnitsOf, today }).needed.has('GCI'));
  const two = planOf(grid(['CAS AA102', 'CAS AA103']));
  assert.equal(planHubNeeds({ plan: two, profile, hubUnitsOf, today }).needed.has('GCI'), false);
  const transfer = planOf(grid(['CAS AA102']), { isTransfer: true });
  assert.equal(planHubNeeds({ plan: transfer, profile, hubUnitsOf, today }).needed.has('GCI'), false);
});

test('AP credit satisfies; transfer credit does not', () => {
  const profile = {
    ...emptyProfile,
    externalCredits: [{ type: 'ap', manualHubUnits: ['PLM'] }, { type: 'transfer', manualHubUnits: ['AEX'] }],
  };
  const { needed } = planHubNeeds({ plan: planOf(grid()), profile, hubUnitsOf, today });
  assert.equal(needed.has('PLM'), false);
  assert.ok(needed.has('AEX'));
});

test('no timeline (split off): planned courses count, same as the planner rings', () => {
  const { needed } = planHubNeeds({ plan: planOf(grid(['CAS AA101'])), profile: emptyProfile, hubUnitsOf, today });
  assert.equal(needed.has('PLM'), false);
});

test('neededForStashedCourse: union across plans, bright when on a plan or no data', () => {
  const a = { needed: new Set(['PLM']), inPlan: new Set() };
  const b = { needed: new Set(['AEX']), inPlan: new Set() };
  assert.deepEqual([...neededForStashedCourse('X', [a, b])].sort(), ['AEX', 'PLM']);
  assert.deepEqual([...neededForStashedCourse('X', [a])], ['PLM']);
  assert.equal(neededForStashedCourse('X', [a, { ...b, inPlan: new Set(['X']) }]), null);
  assert.equal(neededForStashedCourse('X', []), null);
  assert.equal(neededForStashedCourse('X', undefined), null);
});
