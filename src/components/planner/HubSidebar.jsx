import { useState, useEffect } from 'react';
import { HUB_GROUPS, describeRequirementLabels } from '../../utils/hubConstants';
import { useHubProgress } from '../../hooks/useHubProgress';
import HubYearToggle from './HubYearToggle';

export default function HubSidebar({
  semesters,
  extraCourseKeys = [],
  externalCredits = [],
  courseMap,
  isTransfer,
  onToggleTransfer,
  onSummaryChange,
  onOpenFullView,
}) {
  // Groups the student has already finished collapse to a one-line summary
  // by default so the groups that still need attention stand out; explicit
  // clicks here override that default either way.
  const [collapsedOverrides, setCollapsedOverrides] = useState({});

  // Counts/progress computation lives in useHubProgress now (shared with
  // HubFullView — see that hook's doc comment) instead of inline here;
  // this is a pure extraction, the values below are computed identically
  // to before.
  const { counts, requirementsByGroup, totalRequired, fulfilled, allFulfilled } = useHubProgress({
    semesters,
    extraCourseKeys,
    externalCredits,
    courseMap,
    isTransfer,
  });

  useEffect(() => {
    onSummaryChange?.({ badge: `${fulfilled}/${totalRequired}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fulfilled, totalRequired]);

  function toggleGroup(groupLabel, currentlyCollapsed) {
    setCollapsedOverrides((prev) => ({ ...prev, [groupLabel]: !currentlyCollapsed }));
  }

  return (
    <div className="hub-panel">
      {/* The primary way into the redesigned full-screen tracker — first
          thing in the panel, not a small link buried next to the summary
          line, so it's the first thing visible when the HUB tab opens.
          Deliberately its own class (not .panel-open-full-btn, which
          RequirementTree's small equivalent button and HubFullView's own
          "Expand/Collapse all" toggle both still use unchanged) so making
          this one prominent doesn't balloon those other, genuinely
          secondary controls. */}
      {onOpenFullView && (
        <button
          type="button"
          className="hub-full-view-banner"
          onClick={onOpenFullView}
          title="Open full-screen HUB Tracker view"
        >
          <span className="hub-full-view-banner-icon" aria-hidden="true">⤢</span>
          Full HUB Tracker View
        </button>
      )}

      <p className="panel-summary-line">
        {fulfilled} of {totalRequired} HUB units complete
      </p>

      <HubYearToggle isTransfer={isTransfer} onToggleTransfer={onToggleTransfer} />

      {allFulfilled && (
        <div className="panel-all-fulfilled">
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
                    const { displayLabel, shortLabel } = describeRequirementLabels(requirement);

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
