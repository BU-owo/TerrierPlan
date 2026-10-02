import { useEffect, useMemo } from 'react';
import { entriesCourseKeys } from '../../utils/courseEntry';
import { describeLockStatus } from '../requirements/treeHelpers';

export default function CreditsPanel({
  semesters,
  extraCourseKeys = [],
  creditsMap,
  externalCredits = [],
  lockStatusMap = {},
  // Plan-wide note-placeholder credits (Fall/Spring + Summer slots), summed
  // by PlannerPage — the same figure its header credit badge adds in.
  noteCredits = 0,
  onSummaryChange,
}) {
  // Same completed/current/planned split as the Requirements and HUB
  // trackers (see describeLockStatus) — a course in a past semester counts
  // as completed whether or not it's still locked; "current semester"
  // courses count toward planned here (Credits has no separate "in
  // progress" bucket, just completed vs. everything still ahead).
  const { completedCredits, plannedCredits } = useMemo(() => {
    const allKeys = [...semesters.flatMap((sem) => entriesCourseKeys(sem)), ...extraCourseKeys];
    let completed = 0;
    // Note placeholders (no courseKey) aren't real courses, so they're never
    // "completed" — their own credits always count as planned.
    let planned = noteCredits;
    for (const key of allKeys) {
      const credit = creditsMap[key] ?? 0;
      if (describeLockStatus(lockStatusMap[key]).variant === 'completed') completed += credit;
      else planned += credit;
    }
    return { completedCredits: completed, plannedCredits: planned };
  }, [semesters, extraCourseKeys, creditsMap, lockStatusMap, noteCredits]);

  const planCourseCredits = completedCredits + plannedCredits;

  const { apIbCredits, transferCredits, noEquivalentCredits, unmappedTransferCount } = useMemo(() => {
    let apIb = 0;
    let transfer = 0;
    let noEquivalent = 0;
    let unmapped = 0;
    for (const credit of externalCredits) {
      if (!credit) continue;
      const value = Number(credit.credits);
      if (!Number.isFinite(value)) continue;
      if (credit.type === 'ap' || credit.type === 'ib') {
        apIb += value;
      } else if (credit.type === 'transfer') {
        if (String(credit.courseKey || '').trim()) transfer += value;
        else if (credit.status === 'no_equivalent') noEquivalent += value;
        else unmapped += 1;
      }
    }
    return { apIbCredits: apIb, transferCredits: transfer, noEquivalentCredits: noEquivalent, unmappedTransferCount: unmapped };
  }, [externalCredits]);

  const totalCredits = planCourseCredits + apIbCredits + transferCredits + noEquivalentCredits;

  useEffect(() => {
    onSummaryChange?.({ badge: `${totalCredits} cr` });
  }, [totalCredits]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="credits-panel">
      <p className="panel-summary-line">{totalCredits} credits total</p>

      <div className="credits-breakdown">
        <div className="credits-row">
          <span className="credits-row-label">Completed courses</span>
          <span className="credits-row-value">{completedCredits}</span>
        </div>
        <div className="credits-row">
          <span className="credits-row-label">Planned courses</span>
          <span className="credits-row-value">{plannedCredits}</span>
        </div>
        <div className="credits-row">
          <span className="credits-row-label">AP / IB credit</span>
          <span className="credits-row-value">{apIbCredits}</span>
        </div>
        <div className="credits-row">
          <span className="credits-row-label">Transfer credit</span>
          <span className="credits-row-value">{transferCredits}</span>
        </div>
        {noEquivalentCredits > 0 && (
          <div className="credits-row">
            <span className="credits-row-label">Transfer, no BU equivalent</span>
            <span className="credits-row-value">{noEquivalentCredits}</span>
          </div>
        )}
      </div>

      {unmappedTransferCount > 0 && (
        <p className="credits-hint">
          {unmappedTransferCount} transfer credit{unmappedTransferCount === 1 ? '' : 's'} still
          need a BU course match before they count — see External Credit below the semester
          board.
        </p>
      )}

      {totalCredits === 0 && (
        <div className="panel-empty-state">
          <p>Add courses to your plan to see your credit total here.</p>
        </div>
      )}
    </div>
  );
}
