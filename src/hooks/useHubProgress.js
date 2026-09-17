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
export function useHubProgress({
  semesters,
  extraCourseKeys = [],
  externalCredits = [],
  courseMap,
  isTransfer,
  stashCourseKeys = [],
}) {
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

    // Stashed ("Paw-tential") courses — pushed into contributorsByUnit so
    // they render in the same requirement rows via contributorsForRequirement,
    // but through a path that ONLY ever touches `contributors`, never
    // `countsResult`. That's deliberate: a staged course must show up
    // alongside real contributors without ever being able to flip a
    // requirement to satisfied, change `counts`, `progress`, `fulfilled`, or
    // any group's `satisfied`/`percent` — those all stay real-only.
    for (const courseKey of stashCourseKeys) {
      for (const unit of courseMap[courseKey]?.hubUnits ?? []) {
        (contributors[unit] ??= []).push({ type: 'staged', courseKey });
      }
    }

    return { counts: countsResult, contributorsByUnit: contributors };
  }, [semesters, extraCourseKeys, externalCredits, courseMap, stashCourseKeys]);

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

  // Still-open requirements, derived from `progress`/`counts` alone — no
  // re-reading HUB_REQUIREMENTS.md or hubConstants beyond what the hook
  // already has in scope. Shaped for a future course-search feature (not
  // built here): the unit code(s) a course would need to advance this
  // requirement, how many more units are needed, and which HUB_GROUPS
  // label it belongs to (matches requirementsByGroup's own keys).
  const openRequirements = useMemo(() => {
    return progress
      .filter(({ isSatisfied }) => !isSatisfied)
      .map(({ requirement }) => {
        const unitCodes = requirementUnitCodes(requirement);
        const satisfiedCount = unitCodes.reduce((sum, code) => sum + (counts[code] ?? 0), 0);
        return {
          requirement,
          group: requirement.groupLabel,
          unitCodes,
          needed: requirement.required - satisfiedCount,
        };
      });
  }, [progress, counts]);

  return {
    counts,
    contributorsByUnit,
    requirements,
    progress,
    requirementsByGroup,
    groupSummaries,
    openRequirements,
    totalRequired,
    fulfilled,
    allFulfilled,
  };
}

// The unit code(s) that count toward one requirement — its `units` list, or
// every code across all of its `unitOptions` groups. Shared by
// contributorsForRequirement and openRequirements (useHubProgress) so both
// agree on what "this requirement's codes" means.
function requirementUnitCodes(requirement) {
  return requirement.units
    ? requirement.units
    : (requirement.unitOptions || []).flat();
}

// How many real units a requirement has toward its `required` count —
// the same units/unitOptions-over-counts reduction computeProgress
// (hubConstants.js) does internally to produce isSatisfied, exposed here
// as the raw number so a caller can render "1/2" instead of just a
// satisfied/pending boolean. HubSidebar had its own inline copy of this
// exact reduction before; both it and HubFullView call this now instead
// of a requirement satisfying itself uses one reduction, not several.
export function satisfiedCountForRequirement(requirement, counts) {
  return requirementUnitCodes(requirement).reduce((sum, code) => sum + (counts[code] ?? 0), 0);
}

// Every contributor (real course, AP/IB credit, or staged/stashed course)
// behind one requirement's satisfied count, across all of its unit codes (a
// requirement can name several — units: [...] or every code inside every
// unitOptions group). Used by the full view to show names instead of just a
// count; HubSidebar doesn't need this. Staged contributors ride along here
// too (see useHubProgress) precisely so callers don't need a second
// rendering path just to show what's staged.
export function contributorsForRequirement(requirement, contributorsByUnit) {
  const codes = requirementUnitCodes(requirement);
  const seen = new Set();
  const result = [];
  for (const code of codes) {
    for (const contributor of contributorsByUnit[code] || []) {
      const key =
        contributor.type === 'course' || contributor.type === 'staged'
          ? `${contributor.type[0]}:${contributor.courseKey}`
          : `x:${contributor.label}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(contributor);
    }
  }
  return result;
}
