import { entriesCourseKeys, getCourseStatus } from './courseEntry.js';
import { planSplitEnabled, satisfiedHubInputs } from './completion.js';
import { computeHubCounts } from './hubCounts.js';
import { FIRST_YEAR_REQUIREMENTS, TRANSFER_REQUIREMENTS, neededUnitCodes } from './hubConstants.js';
import { normalizeStartTerm } from './term.js';

// One plan's "which HUB units does the student still need", outside
// PlannerPage (the scheduler's Paw-tential tab). Same steps as the planner's
// lockStatusMap -> splitStatusMap -> satisfiedHubInputs -> useHubProgress
// chain, so the same plan gives the same set in both places.
//   plan:    { semesters (normalized entry[][]), gridSummerTerms, extraTerms, isTransfer }
//   profile: { completedCourseKeys, currentSemesterTarget, startTerm, externalCredits }
//   hubUnitsOf(courseKey): the course's hubUnits
// Returns { needed: Set of unit codes, inPlan: Set of the plan's courseKeys }.
export function planHubNeeds({ plan, profile, hubUnitsOf, today }) {
  const semesters = plan.semesters || [];
  const gridSummerTerms = plan.gridSummerTerms || {};
  const extraTerms = plan.extraTerms || [];
  const completedCourseKeys = profile.completedCourseKeys || [];
  const startTerm = normalizeStartTerm(profile.startTerm);
  const currentSemesterTarget = profile.currentSemesterTarget ?? null;

  const summerKeys = Object.values(gridSummerTerms).flatMap((entries) => entriesCourseKeys(entries));
  const extraCourseKeys = [...extraTerms.flatMap((term) => term.courseKeys || []), ...summerKeys];

  const ctx = { startTerm, currentSemesterTarget, today, completedKeys: new Set(completedCourseKeys) };
  const lockStatusMap = {};
  semesters.forEach((sem, i) => {
    entriesCourseKeys(sem).forEach((key) => { lockStatusMap[key] = getCourseStatus(key, i, ctx); });
  });
  Object.entries(gridSummerTerms).forEach(([year, entries]) => {
    entriesCourseKeys(entries).forEach((key) => { lockStatusMap[key] = getCourseStatus(key, `summer:${year}`, ctx); });
  });
  extraTerms.forEach((term) => {
    (term.courseKeys || []).forEach((key) => { lockStatusMap[key] = getCourseStatus(key, null, ctx); });
  });
  const splitStatusMap = planSplitEnabled({ startTerm, currentSemesterTarget, completedCourseKeys })
    ? lockStatusMap
    : undefined;

  const inputs = satisfiedHubInputs(semesters, extraCourseKeys, splitStatusMap);
  const { counts } = computeHubCounts({
    semesters: inputs.semesters,
    extraCourseKeys: inputs.extraCourseKeys,
    externalCredits: profile.externalCredits || [],
    hubUnitsOf,
  });
  const needed = neededUnitCodes(counts, plan.isTransfer ? TRANSFER_REQUIREMENTS : FIRST_YEAR_REQUIREMENTS);

  const inPlan = new Set([...semesters.flatMap((sem) => entriesCourseKeys(sem)), ...extraCourseKeys]);
  return { needed, inPlan };
}

// The needed set for one Paw-tential row, given the plans that stashed it
// ({ needed, inPlan } each). null = show every chip bright: no plan data, or
// the course is already on one of those plans. Otherwise the union, so a
// code is bright if any of the plans still needs it.
export function neededForStashedCourse(courseKey, planNeeds) {
  if (!planNeeds?.length || planNeeds.some((p) => p.inPlan.has(courseKey))) return null;
  const union = new Set();
  planNeeds.forEach((p) => p.needed.forEach((code) => union.add(code)));
  return union;
}
