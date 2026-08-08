import { useState, useMemo, useEffect } from 'react';
import {
  HUB_GROUPS,
  HUB_LABELS,
  FIRST_YEAR_REQUIREMENTS,
  TRANSFER_REQUIREMENTS,
  OR_GROUP_DISPLAY_NAMES,
  computeProgress,
} from '../../utils/hubConstants';
import { getApHub, getIbHub } from '../../data/apIbHubCredit';

export default function HubSidebar({
  semesters,
  extraCourseKeys = [],
  externalCredits = [],
  courseMap,
  isTransfer,
  onToggleTransfer,
  onSummaryChange,
}) {
  // Groups the student has already finished collapse to a one-line summary
  // by default so the groups that still need attention stand out; explicit
  // clicks here override that default either way.
  const [collapsedOverrides, setCollapsedOverrides] = useState({});

  const counts = useMemo(() => {
    const result = {};
    const allKeys = [...semesters.flat(), ...extraCourseKeys];
    for (const key of allKeys) {
      for (const unit of courseMap[key]?.hubUnits ?? []) {
        result[unit] = (result[unit] ?? 0) + 1;
      }
    }
    // BU's AP policy has its own HUB table. Transfer credit is deliberately
    // omitted: it never fulfills HUB, even when equated to a BU course.
    for (const credit of externalCredits) {
      if (credit.type !== 'ap' && credit.type !== 'ib') continue;
      const units = Array.isArray(credit.manualHubUnits)
        ? credit.manualHubUnits
        : credit.type === 'ib'
          ? getIbHub(credit.testSubject, credit.score, credit.isHigherLevel)
          : getApHub(credit.testSubject, credit.score);
      if (!Array.isArray(units)) continue;
      for (const unit of units) result[unit] = (result[unit] ?? 0) + 1;
    }
    return result;
  }, [semesters, extraCourseKeys, externalCredits, courseMap]);

  const requirements = isTransfer ? TRANSFER_REQUIREMENTS : FIRST_YEAR_REQUIREMENTS;

  const progress = useMemo(() => computeProgress(counts, requirements), [counts, requirements]);

  const totalRequired = requirements.reduce((sum, req) => sum + req.required, 0);
  const fulfilled = progress.reduce((sum, { requirement, isSatisfied }) => {
    return isSatisfied ? sum + requirement.required : sum;
  }, 0);
  const allFulfilled = fulfilled === totalRequired;

  useEffect(() => {
    onSummaryChange?.({ badge: `${fulfilled}/${totalRequired}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fulfilled, totalRequired]);

  const requirementsByGroup = useMemo(() => {
    const groups = {};
    progress.forEach(({ requirement, isSatisfied }) => {
      const groupLabel = requirement.groupLabel;
      if (!groups[groupLabel]) {
        groups[groupLabel] = [];
      }
      groups[groupLabel].push({ requirement, isSatisfied });
    });
    return groups;
  }, [progress]);

  function toggleGroup(groupLabel, currentlyCollapsed) {
    setCollapsedOverrides((prev) => ({ ...prev, [groupLabel]: !currentlyCollapsed }));
  }

  return (
    <div className="hub-panel">
      <p className="panel-summary-line">
        {fulfilled} of {totalRequired} HUB units complete
      </p>

      <div className="hub-year-toggle-group">
        <button
          className={`hub-year-toggle-btn ${!isTransfer ? 'active' : ''}`}
          onClick={() => onToggleTransfer(false)}
          title="Show first-year requirements"
        >
          First-Year
        </button>
        <button
          className={`hub-year-toggle-btn ${isTransfer ? 'active' : ''}`}
          onClick={() => onToggleTransfer(true)}
          title="Show transfer requirements"
        >
          Transfer
        </button>
      </div>

      {allFulfilled && (
        <div className="panel-all-fulfilled">
          <div className="panel-all-fulfilled-icon">🎉</div>
          <p>All HUB requirements fulfilled!</p>
        </div>
      )}

      <div className="hub-requirements-list">
        {HUB_GROUPS.map((group) => {
          const groupReqs = requirementsByGroup[group.label] || [];
          if (groupReqs.length === 0) return null;

          const groupFulfilled = groupReqs.reduce(
            (sum, { requirement, isSatisfied }) => (isSatisfied ? sum + requirement.required : sum),
            0
          );
          const groupTotal = groupReqs.reduce((sum, { requirement }) => sum + requirement.required, 0);
          const groupSatisfied = groupFulfilled === groupTotal;
          const collapsed = collapsedOverrides[group.label] ?? groupSatisfied;

          const groupStyle = {
            '--hub-group-color': group.colorHex,
            borderLeftColor: group.colorHex,
          };

          return (
            <div key={group.label} className="hub-group" style={groupStyle}>
              <div
                className="hub-group-header"
                role="button"
                tabIndex={0}
                onClick={() => toggleGroup(group.label, collapsed)}
                onKeyDown={(e) => e.key === 'Enter' && toggleGroup(group.label, collapsed)}
              >
                <span className="panel-group-caret">{collapsed ? '▸' : '▾'}</span>
                <span className="hub-group-label">{group.label}</span>
                <span className={`hub-group-progress${groupSatisfied ? ' satisfied' : ''}`}>
                  {groupFulfilled}/{groupTotal}
                </span>
              </div>

              {!collapsed && (
                <div className="hub-group-requirements">
                  {groupReqs.map(({ requirement, isSatisfied }) => {
                    // Full display label
                    let displayLabel = requirement.id;
                    if (requirement.units && requirement.units.length === 1) {
                      displayLabel = HUB_LABELS[requirement.units[0]] || requirement.id;
                    } else if (requirement.unitOptions) {
                      const shortId = requirement.id.replace(/^(fy|tr)-/, '');
                      displayLabel = OR_GROUP_DISPLAY_NAMES[shortId] || shortId;
                    }

                    // Short code(s) shown as subtitle
                    let shortLabel = '';
                    if (requirement.units) {
                      shortLabel = requirement.units.join(' · ');
                    } else if (requirement.unitOptions) {
                      shortLabel = requirement.unitOptions
                        .map(optGroup => optGroup.join('+'))
                        .join(' or ');
                    }

                    // Satisfied count
                    let satisfiedCount = 0;
                    if (requirement.units) {
                      satisfiedCount = requirement.units.reduce((sum, code) => sum + (counts[code] ?? 0), 0);
                    } else if (requirement.unitOptions) {
                      satisfiedCount = requirement.unitOptions.reduce((sum, optGroup) => {
                        const optSum = optGroup.reduce((s, code) => s + (counts[code] ?? 0), 0);
                        return sum + optSum;
                      }, 0);
                    }

                    return (
                      <div
                        key={requirement.id}
                        className={`hub-requirement ${isSatisfied ? 'fulfilled' : 'pending'}`}
                      >
                        <div className="hub-requirement-indicator">
                          {isSatisfied ? '✓' : '○'}
                        </div>
                        <div className="hub-requirement-info">
                          <span className="hub-requirement-label" title={displayLabel}>
                            {displayLabel}
                          </span>
                          {shortLabel && (
                            <span className="hub-requirement-detail">{shortLabel}</span>
                          )}
                        </div>
                        <span className={`hub-requirement-count ${isSatisfied ? 'satisfied' : ''}`}>
                          {satisfiedCount}/{requirement.required}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
