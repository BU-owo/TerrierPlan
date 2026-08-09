import { useState } from 'react';
import HubSidebar from './HubSidebar';
import RequirementsSidebar from './RequirementsSidebar';
import CreditsPanel from './CreditsPanel';

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
  isTransfer,
  onToggleTransfer,
  majorBulletinUrl,
  planCourseKeys,
  onMajorSelect,
  activeSemIndex,
  semesterOptions,
  onAddCourse,
  onEnsureCourseData,
  onBrowseRange,
  requirementOverrides,
  onSetRequirementOverride,
  onRemoveRequirementOverride,
  onOpenFullView,
}) {
  const [activeTab, setActiveTab] = useState('hub');
  const [isCollapsed, setIsCollapsed] = useState(false);
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
        <button
          className="side-panel-expand-btn"
          onClick={() => setIsCollapsed(false)}
          title="Expand status panel"
        >
          {activeMeta.label}{activeSummary ? ` ${activeSummary.badge}` : ''}
        </button>
      </div>
    );
  }

  return (
    <div className="side-panel-tabs">
      <div className="side-panel-tab-bar">
        {TABS.map((tab) => (
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
        ))}
        <button
          className="side-panel-collapse-btn"
          onClick={() => setIsCollapsed(true)}
          title="Collapse status panel"
        >
          −
        </button>
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
          />
        </div>
        <div className={activeTab === 'requirements' ? '' : 'side-panel-hidden'}>
          <RequirementsSidebar
            majorBulletinUrl={majorBulletinUrl}
            planCourseKeys={planCourseKeys}
            onMajorSelect={onMajorSelect}
            onSummaryChange={makeSummaryHandler('requirements')}
            courseMap={courseMap}
            activeSemIndex={activeSemIndex}
            semesterOptions={semesterOptions}
            onAddCourse={onAddCourse}
            onEnsureCourseData={onEnsureCourseData}
            onBrowseRange={onBrowseRange}
            requirementOverrides={requirementOverrides}
            onSetRequirementOverride={onSetRequirementOverride}
            onRemoveRequirementOverride={onRemoveRequirementOverride}
            onOpenFullView={onOpenFullView}
          />
        </div>
        <div className={activeTab === 'credits' ? '' : 'side-panel-hidden'}>
          <CreditsPanel
            semesters={semesters}
            extraCourseKeys={extraCourseKeys}
            creditsMap={creditsMap}
            externalCredits={externalCredits}
            onSummaryChange={makeSummaryHandler('credits')}
          />
        </div>
      </div>
    </div>
  );
}
