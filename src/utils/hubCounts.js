import { getApHub, getIbHub } from '../data/apIbHubCredit.js';
import { entryCourseKey } from './courseEntry.js';

// The one HUB unit counting pass, pure: how many times each unit is earned,
// who contributed, and which units staged (Paw-tential) courses carry.
// useHubProgress and planNeededHub both call this so the planner and the
// scheduler can't disagree. `hubUnitsOf(courseKey)` gives a course's units.
// Transfer credit is deliberately omitted: it never fulfills HUB.
export function computeHubCounts({
  semesters,
  extraCourseKeys = [],
  externalCredits = [],
  hubUnitsOf,
  stashCourseKeys = [],
}) {
  const counts = {};
  const contributorsByUnit = {};

  function addContribution(unit, contributor) {
    counts[unit] = (counts[unit] ?? 0) + 1;
    (contributorsByUnit[unit] ??= []).push(contributor);
  }

  const gridCourseKeys = semesters.flatMap((sem) => sem.map(entryCourseKey));
  for (const courseKey of [...gridCourseKeys, ...extraCourseKeys]) {
    for (const unit of hubUnitsOf(courseKey) ?? []) {
      addContribution(unit, { type: 'course', courseKey });
    }
  }

  for (const credit of externalCredits) {
    if (credit.type !== 'ap' && credit.type !== 'ib') continue;
    const units = Array.isArray(credit.manualHubUnits)
      ? credit.manualHubUnits
      : credit.type === 'ib'
        ? getIbHub(credit.testSubject, credit.score, credit.isHigherLevel)
        : getApHub(credit.testSubject, credit.score);
    if (!Array.isArray(units)) continue;
    for (const unit of units) {
      addContribution(unit, {
        type: 'credit',
        creditType: credit.type,
        label: credit.sourceTitle || credit.testSubject || (credit.type === 'ib' ? 'IB exam' : 'AP exam'),
      });
    }
  }

  // Staged courses only ever touch contributors, never counts.
  for (const courseKey of stashCourseKeys) {
    for (const unit of hubUnitsOf(courseKey) ?? []) {
      (contributorsByUnit[unit] ??= []).push({ type: 'staged', courseKey });
    }
  }

  return { counts, contributorsByUnit };
}
