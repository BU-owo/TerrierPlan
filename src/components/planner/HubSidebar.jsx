import { useState, useEffect, useMemo } from 'react';
import { HUB_GROUPS, describeRequirementLabels } from '../../utils/hubConstants';
import { useHubProgress, satisfiedCountForRequirement } from '../../hooks/useHubProgress';
import { completedHubInputs, hubBannerState, hubProgressText } from '../../utils/completion';
import RhettPeek from '../RhettPeek';
import HubYearToggle from './HubYearToggle';
import EstimateNote from '../EstimateNote';
import { BU_LINKS } from '../../data/officialLinks';

export default function HubSidebar({
  semesters,
  extraCourseKeys = [],
  externalCredits = [],
  courseMap,
  isTransfer,
  onToggleTransfer,
  onSummaryChange,
  onOpenFullView,
  // courseKey[] from the Paw-tential Courses tab; only used for the one-line
  // "could add" note (same counts HubFullView shows).
  stash = [],
  // Switches the planner's left panel to the Paw-tential Courses tab.
  onShowStash,
  // courseKey -> { locked, semesterStatus } when the done-vs-planned split
  // applies (PlannerPage, see planSplitEnabled); splits satisfied requirements
  // into done vs. only planned. Without it, everything reads as done.
  splitStatusMap,
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

  // "What if I added everything in my stash" — the same second useHubProgress
  // call HubFullView makes for its dashed rings.
  const extraCourseKeysWithStash = useMemo(() => [...extraCourseKeys, ...stash], [extraCourseKeys, stash]);
  const { fulfilled: potentialFulfilled } = useHubProgress({
    semesters,
    extraCourseKeys: extraCourseKeysWithStash,
    externalCredits,
    courseMap,
    isTransfer,
  });
  // Completed-only progress (see completion.js): which satisfied
  // requirements are done vs. still only planned.
  const completedInputs = useMemo(
    () => completedHubInputs(semesters, extraCourseKeys, splitStatusMap),
    [semesters, extraCourseKeys, splitStatusMap],
  );
  const { requirementsByGroup: completedRequirementsByGroup, fulfilled: completedFulfilled } = useHubProgress({
    semesters: completedInputs.semesters,
    extraCourseKeys: completedInputs.extraCourseKeys,
    externalCredits,
    courseMap,
    isTransfer,
  });
  const completedSatisfiedIds = useMemo(
    () => new Set(Object.values(completedRequirementsByGroup).flat()
      .filter(({ isSatisfied }) => isSatisfied)
      .map(({ requirement }) => requirement.id)),
    [completedRequirementsByGroup],
  );
  // Celebrates whenever the plan covers every unit; the copy says how many
  // units still lean on planned courses (see hubBannerState).
  const hubBanner = hubBannerState({ allFulfilled, fulfilled, completedFulfilled });
  const stashedHubCount = stash.filter((key) => (courseMap[key]?.hubUnits?.length ?? 0) > 0).length;
  const couldAddUnits = Math.max(0, potentialFulfilled - fulfilled);

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
          title="Open full-screen HUB tracker & course finder"
        >
          <span className="hub-full-view-banner-icon" aria-hidden="true">⤢</span>
          HUB Tracker &amp; Course Finder
        </button>
      )}

      {stashedHubCount > 0 && (
        <p className="hub-full-view-hint">
          {stashedHubCount} Paw-tential course{stashedHubCount === 1 ? '' : 's'} could add {couldAddUnits} HUB
          unit{couldAddUnits === 1 ? '' : 's'}.{' '}
          {onShowStash ? (
            <button type="button" className="hub-stash-link" onClick={onShowStash}>
              See the Paw-tential Courses tab
            </button>
          ) : (
            'See the Paw-tential Courses tab on the left.'
          )}
        </p>
      )}

      <p className="panel-summary-line">
        {hubProgressText({ fulfilled, completedFulfilled, total: totalRequired })}
      </p>
      <EstimateNote link={BU_LINKS.myBU} lead="For planning only. Confirm on" label="MyBU" />

      <HubYearToggle isTransfer={isTransfer} onToggleTransfer={onToggleTransfer} />

      {hubBanner.celebrate && (
        <div className="panel-all-fulfilled">
          <RhettPeek />
          <p>{hubBanner.variant === 'covered' ? 'Your plan covers every HUB requirement!' : 'All HUB requirements fulfilled!'}</p>
          {hubBanner.variant === 'covered' && (
            <p className="panel-all-fulfilled-sub">
              {hubBanner.plannedUnits} unit{hubBanner.plannedUnits === 1 ? '' : 's'} still to take
            </p>
          )}
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
          const groupPlanned = groupSatisfied
            && groupReqs.some(({ requirement }) => !completedSatisfiedIds.has(requirement.id));
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
                <span className={`hub-group-progress${groupSatisfied ? ' satisfied' : ''}${groupPlanned ? ' is-planned' : ''}`}>
                  {groupFulfilled}/{groupTotal}{groupPlanned ? ' · planned' : ''}
                </span>
              </div>

              {!collapsed && (
                <div className="hub-group-requirements">
                  {groupReqs.map(({ requirement, isSatisfied }) => {
                    const { displayLabel, shortLabel } = describeRequirementLabels(requirement);
                    const satisfiedCount = satisfiedCountForRequirement(requirement, counts);
                    const needsMultiple = requirement.required > 1;
                    const planned = isSatisfied && !completedSatisfiedIds.has(requirement.id);

                    return (
                      <div
                        key={requirement.id}
                        className={`hub-requirement ${isSatisfied ? 'fulfilled' : 'pending'}${planned ? ' is-planned' : ''}`}
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
                          {needsMultiple && (
                            <span
                              className="hub-requirement-multi"
                              title={`Requires ${requirement.required} separate courses to fulfill`}
                            >
                              needs {requirement.required}
                            </span>
                          )}
                        </div>
                        <span className={`hub-requirement-count ${isSatisfied ? 'satisfied' : ''}`}>
                          {satisfiedCount}/{requirement.required}{planned ? ' · planned' : ''}
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
