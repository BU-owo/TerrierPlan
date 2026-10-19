import { useState } from 'react';
import HubSidebar from './HubSidebar';
import RequirementsSidebar from './RequirementsSidebar';
import CreditsPanel from './CreditsPanel';
import { PanelCollapseButton, PanelRail } from './PanelCollapseControls';
import usePanelCollapse from '../../hooks/usePanelCollapse';
import useOneTimeHint from '../../hooks/useOneTimeHint';
import { isReturningUser } from '../../utils/firstTimer';
import OneTimeHint from '../OneTimeHint';

const TABS = [
  { id: 'hub', label: 'HUB' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'credits', label: 'Credits' },
];

// One status panel at a time instead of stacking HubSidebar/RequirementsSidebar
// full-height side by side — collapse/expand applies to whichever tab is
// active, not per-panel, so there's a single collapse state here rather than
// one inside each panel.
export default function SidePanelTabs({
  // False while a first-visit card or full-screen view is up (no hints behind it).
  hintsEnabled = true,
  // courseKey[] saved in the Paw-tential Courses tab (for the HUB tab's note).
  stash = [],
  semesters,
  extraCourseKeys,
  externalCredits,
  courseMap,
  creditsMap,
  lockStatusMap,
  noteCredits,
  // Part of noteCredits already completed (past Marine Semester placeholders).
  completedNoteCredits,
  isTransfer,
  onToggleTransfer,
  majorBulletinUrl,
  onMajorSelect,
  // Requirements tab (compact RequirementTree) — see RequirementsSidebar.
  planCourseKeys,
  // Remaining Marine Semester course slots in the plan (requirements engine).
  marineSlots,
  onEnsureCourseData,
  requirementOverrides,
  onSetRequirementOverride,
  onRemoveRequirementOverride,
  onOpenFullView,
  onAddToStash,
  onRemoveFromStash,
  onShowCourseInfo,
  onOpenHubFullView,
  // Switches the planner's left panel to the Paw-tential Courses tab.
  onShowStash,
}) {
  const [activeTab, setActiveTab] = useState('hub');
  const { collapsed: isCollapsed, desktop, setCollapsed } = usePanelCollapse('terrierplan_planner_right_collapsed', !isReturningUser());
  const [summaries, setSummaries] = useState({});
  const [hubHintShow, dismissHubHint, markHubSeen] = useOneTimeHint('hub', { priority: 12, when: hintsEnabled && activeTab === 'hub' && !isCollapsed });
  const [creditsHintShow, dismissCreditsHint, markCreditsSeen] = useOneTimeHint('credits', { priority: 13, when: hintsEnabled && activeTab === 'credits' && !isCollapsed });

  function makeSummaryHandler(tabId) {
    return (summary) => {
      setSummaries((prev) => {
        const existing = prev[tabId];
        if (existing && existing.badge === summary.badge) return prev;
        return { ...prev, [tabId]: summary };
      });
    };
  }

  if (isCollapsed) {
    const activeMeta = TABS.find((t) => t.id === activeTab);
    const activeSummary = summaries[activeTab];
    return (
      <div className="side-panel-tabs side-panel-collapsed">
        <PanelRail
          side="right"
          name="HUB"
          text={`${activeMeta.label}${activeSummary ? ` ${activeSummary.badge}` : ''}`}
          onExpand={() => setCollapsed(false)}
        />
      </div>
    );
  }

  return (
    <div className="side-panel-tabs">
      <div className="side-panel-tab-bar">
        {TABS.map((tab) => {
          const tabButton = (
            <button
              key={tab.id}
              className={`side-panel-tab-btn${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
            >
              <span className="side-panel-tab-label">{tab.label}</span>
              {summaries[tab.id] && (
                <span className="side-panel-tab-badge">{summaries[tab.id].badge}</span>
              )}
            </button>
          );
          // The HUB tab also carries a small button that opens the full HUB
          // view — a sibling of the tab button (not inside it: buttons can't
          // nest), so selecting the tab and expanding stay separate clicks.
          if (tab.id !== 'hub' || !onOpenHubFullView) return tabButton;
          return (
            <div key={tab.id} className="side-panel-tab-hub">
              {tabButton}
              <button
                type="button"
                className="side-panel-tab-expand"
                onClick={onOpenHubFullView}
                title="Open HUB tracker & course finder"
                aria-label="Open HUB tracker and course finder"
              >
                ⤢
              </button>
            </div>
          );
        })}
        {desktop && (
          <PanelCollapseButton side="right" name="HUB" onClick={() => setCollapsed(true)} />
        )}
      </div>

      <div className="side-panel-content">
        {hubHintShow && (
          <OneTimeHint onDismiss={dismissHubHint} onSeen={markHubSeen}>
            ✓ means your plan covers that HUB unit, ○ means it still needs a course.
          </OneTimeHint>
        )}
        {creditsHintShow && (
          <OneTimeHint onDismiss={dismissCreditsHint} onSeen={markCreditsSeen}>
            Completed is courses in past or locked semesters; planned is everything still ahead.
          </OneTimeHint>
        )}
        <div className={activeTab === 'hub' ? '' : 'side-panel-hidden'}>
          <HubSidebar
            semesters={semesters}
            extraCourseKeys={extraCourseKeys}
            externalCredits={externalCredits}
            courseMap={courseMap}
            isTransfer={isTransfer}
            onToggleTransfer={onToggleTransfer}
            stash={stash}
            onShowStash={onShowStash}
            onSummaryChange={makeSummaryHandler('hub')}
            onOpenFullView={onOpenHubFullView}
          />
        </div>
        <div className={activeTab === 'requirements' ? '' : 'side-panel-hidden'}>
          <RequirementsSidebar
            majorBulletinUrl={majorBulletinUrl}
            onMajorSelect={onMajorSelect}
            planCourseKeys={planCourseKeys}
            marineSlots={marineSlots}
            courseMap={courseMap}
            onEnsureCourseData={onEnsureCourseData}
            requirementOverrides={requirementOverrides}
            onSetRequirementOverride={onSetRequirementOverride}
            onRemoveRequirementOverride={onRemoveRequirementOverride}
            lockStatusMap={lockStatusMap}
            stash={stash}
            onAddToStash={onAddToStash}
            onRemoveFromStash={onRemoveFromStash}
            onShowCourseInfo={onShowCourseInfo}
            onOpenFullView={onOpenFullView}
            onSummaryChange={makeSummaryHandler('requirements')}
            dragEnabled={desktop}
          />
        </div>
        <div className={activeTab === 'credits' ? '' : 'side-panel-hidden'}>
          <CreditsPanel
            semesters={semesters}
            extraCourseKeys={extraCourseKeys}
            creditsMap={creditsMap}
            externalCredits={externalCredits}
            lockStatusMap={lockStatusMap}
            noteCredits={noteCredits}
            completedNoteCredits={completedNoteCredits}
            onSummaryChange={makeSummaryHandler('credits')}
          />
        </div>
      </div>
    </div>
  );
}
