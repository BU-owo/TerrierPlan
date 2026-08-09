import { useEffect, useMemo } from 'react';
import { entryCourseKey } from '../../utils/courseEntry';

export default function CreditsPanel({
  semesters,
  extraCourseKeys = [],
  creditsMap,
  externalCredits = [],
  onSummaryChange,
}) {
  const planCourseCredits = useMemo(
    () => [...semesters.flatMap((sem) => sem.map(entryCourseKey)), ...extraCourseKeys]
      .reduce((sum, key) => sum + (creditsMap[key] ?? 0), 0),
    [semesters, extraCourseKeys, creditsMap]
  );

  const { apIbCredits, transferCredits, unmappedTransferCount } = useMemo(() => {
    let apIb = 0;
    let transfer = 0;
    let unmapped = 0;
    for (const credit of externalCredits) {
      if (!credit) continue;
      const value = Number(credit.credits);
      if (!Number.isFinite(value)) continue;
      if (credit.type === 'ap' || credit.type === 'ib') {
        apIb += value;
      } else if (credit.type === 'transfer') {
        if (String(credit.courseKey || '').trim()) transfer += value;
        else unmapped += 1;
      }
    }
    return { apIbCredits: apIb, transferCredits: transfer, unmappedTransferCount: unmapped };
  }, [externalCredits]);

  const totalCredits = planCourseCredits + apIbCredits + transferCredits;

  useEffect(() => {
    onSummaryChange?.({ badge: `${totalCredits} cr` });
  }, [totalCredits]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="credits-panel">
      <p className="panel-summary-line">{totalCredits} credits total</p>

      <div className="credits-breakdown">
        <div className="credits-row">
          <span className="credits-row-label">Planned courses</span>
          <span className="credits-row-value">{planCourseCredits}</span>
        </div>
        <div className="credits-row">
          <span className="credits-row-label">AP / IB credit</span>
          <span className="credits-row-value">{apIbCredits}</span>
        </div>
        <div className="credits-row">
          <span className="credits-row-label">Transfer credit</span>
          <span className="credits-row-value">{transferCredits}</span>
        </div>
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
