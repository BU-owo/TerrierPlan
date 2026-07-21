import { useState, useMemo } from 'react';
import {
  HUB_GROUPS,
  HUB_LABELS,
  FIRST_YEAR_REQUIREMENTS,
  TRANSFER_REQUIREMENTS,
  OR_GROUP_DISPLAY_NAMES,
  computeProgress,
} from '../../utils/hubConstants';

export default function HubSidebar({ semesters, courseMap, isTransfer, onToggleTransfer }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Count how many courses satisfy each HUB unit
  const counts = useMemo(() => {
    const result = {};
    for (const sem of semesters) {
      for (const key of sem) {
        for (const unit of courseMap[key]?.hubUnits ?? []) {
          result[unit] = (result[unit] ?? 0) + 1;
        }
      }
    }
    return result;
  }, [semesters, courseMap]);

  // Select requirements based on first-year vs transfer
  const requirements = isTransfer ? TRANSFER_REQUIREMENTS : FIRST_YEAR_REQUIREMENTS;

  // Compute progress for all requirements
  const progress = useMemo(() => computeProgress(counts, requirements), [counts, requirements]);

  // Overall stats: sum the required counts, not just count fulfilled requirements
  const totalRequired = requirements.reduce((sum, req) => sum + req.required, 0);
  const fulfilled = progress.reduce((sum, { requirement, isSatisfied }) => {
    return isSatisfied ? sum + requirement.required : sum;
  }, 0);
  const allFulfilled = fulfilled === totalRequired;

  // Group requirements by group label
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

  // Find the group color for a groupLabel
  function getGroupColor(groupLabel) {
    const group = HUB_GROUPS.find((g) => g.label === groupLabel);
    return group?.colorHex || '#ccc';
  }

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

          // Calculate group progress by summing required counts
          const groupTotalRequired = groupReqs.reduce((sum, { requirement }) => sum + requirement.required, 0);
          const groupFulfilled = groupReqs.reduce((sum, { requirement, isSatisfied }) => {
            return isSatisfied ? sum + requirement.required : sum;
          }, 0);

          const groupStyle = {
            '--hub-group-color': group.colorHex,
            borderLeftColor: group.colorHex,
          };

          return (
            <div key={group.label} className="hub-group" style={groupStyle}>
              <div className="hub-group-header">
                <span className="hub-group-label">{group.label}</span>
                <span className="hub-group-progress">
                  {groupFulfilled}/{groupTotalRequired}
                </span>
              </div>

              <div className="hub-group-requirements">
                {groupReqs.map(({ requirement, isSatisfied }) => {
                  // Determine display label
                  let displayLabel = requirement.id;
                  if (requirement.units && requirement.units.length === 1) {
                    displayLabel = HUB_LABELS[requirement.units[0]] || requirement.id;
                  } else if (requirement.unitOptions) {
                    // Extract the short ID (e.g., "si2-so2" from "fy-si2-so2")
                    const shortId = requirement.id.replace(/^(fy|tr)-/, '');
                    displayLabel = OR_GROUP_DISPLAY_NAMES[shortId] || shortId;
                  }

                  // Determine detail text (shows what's required)
                  const detailText = requirement.required > 1
                    ? `${requirement.required} courses`
                    : requirement.unitOptions
                      ? 'or'
                      : 'course';

                  // Get the satisfied count based on requirement type
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
                        <span className="hub-requirement-label">{displayLabel}</span>
                        <span className="hub-requirement-detail">{detailText}</span>
                      </div>
                      <span className={`hub-requirement-count ${isSatisfied ? 'satisfied' : ''}`}>
                        {satisfiedCount}
                        {requirement.required > 1 ? `/${requirement.required}` : ''}
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
