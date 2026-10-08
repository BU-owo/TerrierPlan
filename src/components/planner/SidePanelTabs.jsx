import { useState } from 'react';
import HubSidebar from './HubSidebar';
import RequirementsBulletinTab from './RequirementsBulletinTab';
import CreditsPanel from './CreditsPanel';
import { PanelCollapseButton, PanelRail } from './PanelCollapseControls';
import usePanelCollapse from '../../hooks/usePanelCollapse';

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
  semesters,
  extraCourseKeys,
  externalCredits,
  courseMap,
  creditsMap,
  lockStatusMap,
  noteCredits,
  isTransfer,
  onToggleTransfer,
  majorBulletinUrl,
  onMajorSelect,
  onOpenHubFullView,
}) {
  const [activeTab, setActiveTab] = useState('hub');
  const { collapsed: isCollapsed, desktop, setCollapsed } = usePanelCollapse('terrierplan_planner_right_collapsed');
  const [summaries, setSummaries] = useState({});

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
        <div className={activeTab === 'hub' ? '' : 'side-panel-hidden'}>
          <HubSidebar
            semesters={semesters}
            extraCourseKeys={extraCourseKeys}
            externalCredits={externalCredits}
            courseMap={courseMap}
            isTransfer={isTransfer}
            onToggleTransfer={onToggleTransfer}
            onSummaryChange={makeSummaryHandler('hub')}
            onOpenFullView={onOpenHubFullView}
          />
        </div>
        <div className={activeTab === 'requirements' ? '' : 'side-panel-hidden'}>
          {/* Temporarily just a major picker + bulletin link — see
              RequirementsBulletinTab.jsx for why. The rest of this
              component's props (planCourseKeys, onAddCourse, etc.) are
              still threaded all the way down from PlannerPage even though
              nothing here consumes them right now, so swapping
              RequirementsSidebar back in later is a one-line change, not
              a prop-plumbing project. */}
          <RequirementsBulletinTab
            majorBulletinUrl={majorBulletinUrl}
            onMajorSelect={onMajorSelect}
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
            onSummaryChange={makeSummaryHandler('credits')}
          />
        </div>
      </div>
    </div>
  );
}
