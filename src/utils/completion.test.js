// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCompletedStatus, isKeyDone, completionState, completedHubInputs, satisfiedHubInputs, lockStatusVariant, planSplitEnabled,
  completedCountOf, isNodeShown, courseTally, countNeedsReview, plannedSuffix, startsCollapsed,
  requirementsProgressView, requirementsCelebrationReady, hubBannerState,
  progressHeaderText, progressSummaryText, hubProgressText,
} from './completion.js';
import { createNoteEntry } from './courseEntry.js';

const map = {
  PAST: { locked: false, semesterStatus: 'past' },
  LOCKED: { locked: true, semesterStatus: 'upcoming' },
  CURRENT: { locked: false, semesterStatus: 'current' },
  PLANNED: { locked: false, semesterStatus: 'upcoming' },
  NOSTATUS: { locked: false, semesterStatus: null },
};

test('isCompletedStatus: past or locked', () => {
  assert.equal(isCompletedStatus(map.PAST), true);
  assert.equal(isCompletedStatus(map.LOCKED), true);
  assert.equal(isCompletedStatus(map.CURRENT), false);
  assert.equal(isCompletedStatus(map.PLANNED), false);
  assert.equal(isCompletedStatus(map.NOSTATUS), false);
  assert.equal(isCompletedStatus(undefined), false);
});

test('isKeyDone: unknown keys (external credit) and no map count as done', () => {
  assert.equal(isKeyDone(map, 'PAST'), true);
  assert.equal(isKeyDone(map, 'CURRENT'), false);
  assert.equal(isKeyDone(map, 'APCREDIT'), true);
  assert.equal(isKeyDone(undefined, 'PLANNED'), true);
});

test('completionState: done, planned, or null when not satisfied', () => {
  assert.equal(completionState(true, ['PAST', 'LOCKED'], map), 'done');
  assert.equal(completionState(true, ['PAST', 'PLANNED'], map), 'planned');
  assert.equal(completionState(true, ['CURRENT'], map), 'planned');
  assert.equal(completionState(true, ['APCREDIT'], map), 'done');
  assert.equal(completionState(true, [], map), 'done'); // e.g. satisfied by Marine slots only
  assert.equal(completionState(false, ['PAST'], map), null);
  assert.equal(completionState(true, ['PLANNED'], undefined), 'done');
});

test('completedHubInputs: keeps done courses and keyless entries only', () => {
  const note = createNoteEntry();
  const out = completedHubInputs(
    [[{ courseKey: 'PAST' }, { courseKey: 'PLANNED' }, note], ['CURRENT', 'LOCKED']],
    ['PAST', 'PLANNED', 'APCREDIT'],
    map,
  );
  assert.deepEqual(out.semesters, [[{ courseKey: 'PAST' }, note], ['LOCKED']]);
  assert.deepEqual(out.extraCourseKeys, ['PAST', 'APCREDIT']);
  // No map: unchanged.
  assert.deepEqual(completedHubInputs([['PLANNED']], ['PLANNED'], undefined), { semesters: [['PLANNED']], extraCourseKeys: ['PLANNED'] });
});

test('lockStatusVariant: no status (AP/IB/transfer equivalent) counts as completed', () => {
  assert.equal(lockStatusVariant(undefined), 'completed');
  assert.equal(lockStatusVariant(null), 'completed');
  assert.equal(lockStatusVariant(map.PAST), 'completed');
  assert.equal(lockStatusVariant(map.LOCKED), 'completed');
  assert.equal(lockStatusVariant(map.CURRENT), 'current');
  assert.equal(lockStatusVariant(map.PLANNED), 'planned');
  assert.equal(lockStatusVariant(map.NOSTATUS), 'planned');
});

test('planSplitEnabled: off only with no start term, no current semester and nothing locked', () => {
  assert.equal(planSplitEnabled({ startTerm: null, currentSemesterTarget: null, completedCourseKeys: [] }), false);
  assert.equal(planSplitEnabled({ startTerm: '', currentSemesterTarget: undefined, completedCourseKeys: undefined }), false);
  assert.equal(planSplitEnabled({ startTerm: '2255', currentSemesterTarget: null, completedCourseKeys: [] }), false); // invalid start term
  assert.equal(planSplitEnabled({ startTerm: '2248', currentSemesterTarget: null, completedCourseKeys: [] }), true);
  assert.equal(planSplitEnabled({ startTerm: null, currentSemesterTarget: 0, completedCourseKeys: [] }), true);
  assert.equal(planSplitEnabled({ startTerm: null, currentSemesterTarget: null, completedCourseKeys: ['A'] }), true);
});

test('completedCountOf: counted courses minus the ones not done, clamped', () => {
  assert.equal(completedCountOf(2, 2, ['PAST', 'PLANNED'], map), 1);
  assert.equal(completedCountOf(2, 2, ['PLANNED', 'CURRENT'], map), 0);
  assert.equal(completedCountOf(2, 3, ['PAST', 'LOCKED', 'PLANNED'], map), 2); // capped at doneCount
  assert.equal(completedCountOf(3, 3, ['PLANNED'], undefined), 3); // no split
  assert.equal(completedCountOf(1, 1, ['PLANNED', 'CURRENT'], map), 0); // never below 0
});

test('isNodeShown: All / Still to do / Done', () => {
  for (const state of ['done', 'planned', 'todo']) assert.equal(isNodeShown('all', state), true);
  assert.equal(isNodeShown('todo', 'done'), false);
  assert.equal(isNodeShown('todo', 'planned'), true);
  assert.equal(isNodeShown('todo', 'todo'), true);
  assert.equal(isNodeShown('done', 'done'), true);
  assert.equal(isNodeShown('done', 'planned'), false);
  assert.equal(isNodeShown('done', 'todo', true), true); // parent of a done child
});

test('courseTally: course counts that add up to the header', () => {
  // 15 of 15 counted, all done.
  assert.deepEqual(
    courseTally({ claimedTotal: 15, requiredTotal: 15, countedKeys: ['PAST', 'LOCKED'], statusMap: map }),
    { done: 15, planned: 0, toGo: 0, toCheck: 0 },
  );
  // Planned > 0: two counted courses still ahead; duplicates count once.
  const t = courseTally({ claimedTotal: 12, requiredTotal: 15, countedKeys: ['PAST', 'PLANNED', 'CURRENT', 'PLANNED'], statusMap: map });
  assert.deepEqual(t, { done: 10, planned: 2, toGo: 3, toCheck: 0 });
  assert.equal(t.done + t.planned + t.toGo, 15);
  // No split: nothing planned.
  assert.deepEqual(
    courseTally({ claimedTotal: 12, requiredTotal: 15, countedKeys: ['PLANNED'], statusMap: undefined }),
    { done: 12, planned: 0, toGo: 3, toCheck: 0 },
  );
  // Never negative.
  assert.equal(courseTally({ claimedTotal: 16, requiredTotal: 15, countedKeys: [] }).toGo, 0);
});

test('courseTally + countNeedsReview: advisor items are their own count, never "to go"', () => {
  const tree = {
    type: 'ALL',
    status: 'satisfied',
    children: [
      { type: 'COUNT', status: 'satisfied' },
      { type: 'UNRESOLVED', status: 'needs_review' },
      { type: 'UNRESOLVED', status: 'satisfied', substituted: true }, // petitioned: resolved
      {
        type: 'ONE_OF',
        status: 'satisfied',
        activeChildIndex: 1,
        children: [
          { type: 'ALL', children: [{ type: 'UNRESOLVED', status: 'needs_review' }] }, // inactive track: ignored
          { type: 'ALL', children: [{ type: 'UNRESOLVED', status: 'needs_review' }] },
        ],
      },
    ],
  };
  const toCheck = countNeedsReview(tree);
  assert.equal(toCheck, 2);
  assert.deepEqual(
    courseTally({ claimedTotal: 15, requiredTotal: 15, countedKeys: [], statusMap: map, toCheck }),
    { done: 15, planned: 0, toGo: 0, toCheck: 2 },
  );
  assert.equal(countNeedsReview(null), 0);
  assert.equal(countNeedsReview({ type: 'ALL', waived: true, children: [{ type: 'UNRESOLVED', status: 'needs_review' }] }), 0);
});

test('plannedSuffix: none, all, or how many', () => {
  assert.equal(plannedSuffix(['PAST', 'LOCKED'], map), '');
  assert.equal(plannedSuffix(['PLANNED'], map), ' · planned');
  assert.equal(plannedSuffix(['PLANNED', 'CURRENT'], map), ' · planned');
  assert.equal(plannedSuffix(['PAST', 'PLANNED'], map), ' · 1 planned');
  assert.equal(plannedSuffix(['PAST', 'PLANNED', 'CURRENT'], map), ' · 2 planned');
  assert.equal(plannedSuffix(['PLANNED'], undefined), '');
});

test('startsCollapsed: only fully done rows (and compact top-level cards)', () => {
  assert.equal(startsCollapsed('done'), true);
  assert.equal(startsCollapsed('planned'), false); // planned or in-progress courses: open
  assert.equal(startsCollapsed('todo'), false);
  assert.equal(startsCollapsed('planned', { compactTopLevel: true }), true);
  assert.equal(startsCollapsed('todo', { compactTopLevel: true }), true);
  // Split off: a satisfied row's state is 'done' (completionState with no
  // map), so it starts collapsed exactly as before.
  assert.equal(startsCollapsed(completionState(true, ['PLANNED'], undefined)), true);
  assert.equal(startsCollapsed(completionState(true, ['PLANNED'], map)), false);
});

test('requirementsProgressView: banner copy follows what is still planned', () => {
  // Satisfied, everything done (or split off: planned is 0).
  assert.deepEqual(
    requirementsProgressView({ satisfied: true, claimed: 15, required: 15, planned: 0 }),
    { banner: 'complete', countedPercent: 100, donePercent: 100, plannedPercent: 0 },
  );
  // Satisfied, but 3 of the 15 only planned: calm banner, split bar.
  assert.deepEqual(
    requirementsProgressView({ satisfied: true, claimed: 15, required: 15, planned: 3 }),
    { banner: 'covered', countedPercent: 100, donePercent: 80, plannedPercent: 20 },
  );
  // Not satisfied: no banner, bar still split.
  const partial = requirementsProgressView({ satisfied: false, claimed: 10, required: 15, planned: 4 });
  assert.equal(partial.banner, null);
  assert.equal(partial.donePercent + partial.plannedPercent, partial.countedPercent);
  assert.equal(partial.countedPercent, 67);
  // Nothing required yet.
  assert.deepEqual(
    requirementsProgressView({ satisfied: false, claimed: 0, required: 0, planned: 0 }),
    { banner: null, countedPercent: 0, donePercent: 0, plannedPercent: 0 },
  );
});

test('requirementsCelebrationReady: celebrates when covered, with honest copy', () => {
  assert.deepEqual(requirementsCelebrationReady(true, 0), { celebrate: true, variant: 'complete' });
  assert.deepEqual(requirementsCelebrationReady(true, 2), { celebrate: true, variant: 'covered' });
  assert.deepEqual(requirementsCelebrationReady(false, 0), { celebrate: false, variant: null });
  assert.deepEqual(requirementsCelebrationReady(false, 3), { celebrate: false, variant: null });
});

test('hubBannerState: celebrates when every unit is covered; variant says if any are planned', () => {
  assert.deepEqual(hubBannerState({ allFulfilled: true, fulfilled: 26, completedFulfilled: 26 }), { celebrate: true, variant: 'complete', plannedUnits: 0 });
  assert.deepEqual(hubBannerState({ allFulfilled: true, fulfilled: 26, completedFulfilled: 21 }), { celebrate: true, variant: 'covered', plannedUnits: 5 });
  assert.deepEqual(hubBannerState({ allFulfilled: false, fulfilled: 20, completedFulfilled: 12 }), { celebrate: false, variant: null, plannedUnits: 0 });
});

test('progressHeaderText / progressSummaryText: split-on wording', () => {
  const planned = { done: 6, planned: 9, toGo: 0, required: 15, toCheck: 0 };
  assert.equal(progressHeaderText(planned), '6 of 15 courses done · 9 planned');
  assert.equal(progressHeaderText(planned, { compact: true }), '6 of 15 done · 9 planned');
  assert.equal(progressSummaryText(planned), '6 done · 9 planned · 0 to go');
  // planned = 0: no "· 0 planned" in the header; the summary keeps all three.
  const allDone = { done: 15, planned: 0, toGo: 0, required: 15 };
  assert.equal(progressHeaderText(allDone), '15 of 15 courses done');
  assert.equal(progressSummaryText(allDone), '15 done · 0 planned · 0 to go');
  // toGo > 0, plus advisor items.
  const missing = { done: 8, planned: 3, toGo: 4, required: 15, toCheck: 2 };
  assert.equal(progressHeaderText(missing), '8 of 15 courses done · 3 planned · 4 to add');
  assert.equal(progressHeaderText({ ...missing, planned: 0 }, { compact: true }), '8 of 15 done · 4 to add');
  assert.equal(progressSummaryText(missing), '8 done · 3 planned · 4 to go · 2 to check with advisor');
});

test('hubProgressText: no "complete" while units lean on planned courses', () => {
  assert.equal(hubProgressText({ fulfilled: 26, completedFulfilled: 23, total: 26 }), '23 of 26 HUB units done · 3 planned');
  assert.equal(hubProgressText({ fulfilled: 26, completedFulfilled: 23, total: 26 }, { hubWord: false }), '23 of 26 units done · 3 planned');
  // None planned (or split off: completed-only count equals the full one).
  assert.equal(hubProgressText({ fulfilled: 26, completedFulfilled: 26, total: 26 }), '26 of 26 HUB units complete');
  assert.equal(hubProgressText({ fulfilled: 20, completedFulfilled: 20, total: 26 }, { hubWord: false }), '20 of 26 units complete');
  assert.equal(hubProgressText({ fulfilled: 20, total: 26 }), '20 of 26 HUB units complete'); // no completed count passed
});

test('satisfiedHubInputs keeps done and current courses, drops future planned', () => {
  const status = {
    'CAS CS 111': { locked: false, semesterStatus: 'past' },
    'CAS CS 112': { locked: false, semesterStatus: 'current' },
    'CAS CS 210': { locked: false, semesterStatus: 'upcoming' },
    'CAS CS 330': { locked: true, semesterStatus: 'upcoming' },
  };
  const out = satisfiedHubInputs(
    [['CAS CS 111', 'CAS CS 112'], ['CAS CS 210', 'CAS CS 330']],
    ['CAS CS 210', 'CAS CS 111', 'CAS XX 999'],
    status,
  );
  assert.deepEqual(out.semesters, [['CAS CS 111', 'CAS CS 112'], ['CAS CS 330']]);
  assert.deepEqual(out.extraCourseKeys, ['CAS CS 111', 'CAS XX 999']);
});

test('satisfiedHubInputs with no status map keeps everything', () => {
  const out = satisfiedHubInputs([['A', 'B']], ['C'], undefined);
  assert.deepEqual(out.semesters, [['A', 'B']]);
  assert.deepEqual(out.extraCourseKeys, ['C']);
});
