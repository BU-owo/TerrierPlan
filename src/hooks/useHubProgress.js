import { useMemo } from 'react';
import {
  HUB_GROUPS,
  FIRST_YEAR_REQUIREMENTS,
  TRANSFER_REQUIREMENTS,
  computeProgress,
} from '../utils/hubConstants';
import { getApHub, getIbHub } from '../data/apIbHubCredit';
import { entryCourseKey } from '../utils/courseEntry';

// The one HUB counts/progress computation — extracted verbatim from
// HubSidebar's own useMemo (no behavior change there) so HubFullView can
// share it instead of risking the two silently disagreeing on what's
// fulfilled. Does NOT touch requirementsEngine.js, HUB_REQUIREMENTS.md's
// parsing, or how getApHub/getIbHub resolve a score to units — this only
// aggregates counts from the ALREADY-resolved unit lists onto each
// requirement table, exactly as HubSidebar always did.
//
// The one addition beyond what HubSidebar needed: `contributorsByUnit`,
// which records WHICH course/credit actually produced each unit, not just
// the running count — HubSidebar has never needed this (it only ever
// showed a number), but the full view's "inline course names instead of
// just codes/counts" redesign does.
export function useHubProgress({ semesters, extraCourseKeys = [], externalCredits = [], courseMap, isTransfer }) {
  const { counts, contributorsByUnit } = useMemo(() => {
    const countsResult = {};
    const contributors = {};

    function addContribution(unit, contributor) {
      countsResult[unit] = (countsResult[unit] ?? 0) + 1;
      (contributors[unit] ??= []).push(contributor);
    }

    const gridCourseKeys = semesters.flatMap((sem) => sem.map(entryCourseKey));
    for (const courseKey of [...gridCourseKeys, ...extraCourseKeys]) {
      for (const unit of courseMap[courseKey]?.hubUnits ?? []) {
        addContribution(unit, { type: 'course', courseKey });
      }
    }

    // BU's AP/IB policy has its own HUB table. Transfer credit is
    // deliberately omitted: it never fulfills HUB, even when equated to a
    // BU course — same rule HubSidebar has always applied.
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

    return { counts: countsResult, contributorsByUnit: contributors };
  }, [semesters, extraCourseKeys, externalCredits, courseMap]);

  const requirements = isTransfer ? TRANSFER_REQUIREMENTS : FIRST_YEAR_REQUIREMENTS;
  const progress = useMemo(() => computeProgress(counts, requirements), [counts, requirements]);

  const totalRequired = requirements.reduce((sum, req) => sum + req.required, 0);
  const fulfilled = progress.reduce(
    (sum, { requirement, isSatisfied }) => (isSatisfied ? sum + requirement.required : sum),
    0,
  );
  const allFulfilled = fulfilled === totalRequired;

  const requirementsByGroup = useMemo(() => {
    const groups = {};
    progress.forEach(({ requirement, isSatisfied }) => {
      (groups[requirement.groupLabel] ??= []).push({ requirement, isSatisfied });
    });
    return groups;
  }, [progress]);

  // One rollup per HUB_GROUPS entry — fulfilled/total course-slots and a
  // percent, keyed the same way the existing hub-chip-<id> token classes
  // are (see hubConstants.js's HUB_GROUPS/HUB_COLOR_FOR), so a caller can
  // drive a ring/bar per group off the same color system already used for
  // HUB chips elsewhere instead of introducing a second one. Groups with
  // nothing in the active requirement table (shouldn't happen today, since
  // both tables cover all 6) are dropped rather than shown empty.
  const groupSummaries = useMemo(() => {
    return HUB_GROUPS.map((group) => {
      const groupReqs = requirementsByGroup[group.label] || [];
      const groupFulfilled = groupReqs.reduce(
        (sum, { requirement, isSatisfied }) => (isSatisfied ? sum + requirement.required : sum),
        0,
      );
      const groupTotal = groupReqs.reduce((sum, { requirement }) => sum + requirement.required, 0);
      return {
        group,
        requirements: groupReqs,
        fulfilled: groupFulfilled,
        total: groupTotal,
        percent: groupTotal > 0 ? Math.round((groupFulfilled / groupTotal) * 100) : 0,
        satisfied: groupTotal > 0 && groupFulfilled === groupTotal,
      };
    }).filter((g) => g.total > 0);
  }, [requirementsByGroup]);

  return {
    counts,
    contributorsByUnit,
    requirements,
    progress,
    requirementsByGroup,
    groupSummaries,
    totalRequired,
    fulfilled,
    allFulfilled,
  };
}

// Every contributor (course or AP/IB credit) behind one requirement's
// satisfied count, across all of its unit codes (a requirement can name
// several — units: [...] or every code inside every unitOptions group).
// Used by the full view to show names instead of just a count; HubSidebar
// doesn't need this.
export function contributorsForRequirement(requirement, contributorsByUnit) {
  const codes = requirement.units
    ? requirement.units
    : (requirement.unitOptions || []).flat();
  const seen = new Set();
  const result = [];
  for (const code of codes) {
    for (const contributor of contributorsByUnit[code] || []) {
      const key = contributor.type === 'course' ? `c:${contributor.courseKey}` : `x:${contributor.label}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(contributor);
    }
  }
  return result;
}
