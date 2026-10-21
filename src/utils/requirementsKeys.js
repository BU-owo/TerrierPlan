import { entriesCourseKeys } from './courseEntry.js';
import { externalCreditCourseKeys } from './externalCredits.js';

// The courseKeys the requirements tracker (and the standard-plan seeding)
// counts: every course in the grid, in extraTerms and in the per-year Summer
// slots, plus external credits (an auto-resolved "A+B" credit split into its
// courses, or a manual override). completedCourseKeys is NOT part of it —
// that list only decides which plan courses read as locked. Substitutions
// (requirementOverrides) reach the engine separately. The one place this list
// is built, so the tracker and seedSequence can never disagree.
export function requirementsPlanKeys({ semesters, gridSummerTerms, extraTerms, externalCredits }) {
  return [
    ...(semesters || []).flatMap((entries) => entriesCourseKeys(entries)),
    ...(extraTerms || []).flatMap((term) => term?.courseKeys || []),
    ...Object.values(gridSummerTerms || {}).flatMap((entries) => entriesCourseKeys(entries)),
    ...(externalCredits || []).flatMap(externalCreditCourseKeys),
  ];
}
