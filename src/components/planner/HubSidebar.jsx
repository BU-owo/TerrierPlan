import { useState, useMemo } from 'react';
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
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  if (isCollapsed) {
    return (
      <div className="hub-sidebar hub-sidebar-collapsed">
        <button
          className="hub-expand-btn"
          onClick={() => setIsCollapsed(false)}
          title="Expand HUB sidebar"
        >
          HUB {fulfilled}/{totalRequired}
        </button>
      </div>
    );
  }

  return (
    <div className="hub-sidebar">
      <div className="hub-sidebar-header">
        <div className="hub-header-top">
          <h2>BU Hub</h2>
          <button
            className="hub-collapse-btn"
            onClick={() => setIsCollapsed(true)}
            title="Collapse HUB sidebar"
          >
            −
          </button>
        </div>

        <div className="hub-header-meta">
          <span className="hub-progress-badge">
            {fulfilled}/{totalRequired}
          </span>

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
        </div>
      </div>

      {allFulfilled && (
        <div className="hub-all-fulfilled">
          <div className="hub-all-fulfilled-icon">🎉</div>
          <p>All HUB requirements fulfilled!</p>
        </div>
      )}

      <div className="hub-requirements-list">
        {HUB_GROUPS.map((group) => {
          const groupReqs = requirementsByGroup[group.label] || [];
          if (groupReqs.length === 0) return null;

          const groupStyle = {
            '--hub-group-color': group.colorHex,
            borderLeftColor: group.colorHex,
          };

          return (
            <div key={group.label} className="hub-group" style={groupStyle}>
              <div className="hub-group-header">
                <span className="hub-group-label">{group.label}</span>
              </div>

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
            </div>
          );
        })}
      </div>
    </div>
  );
}
