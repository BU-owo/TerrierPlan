import { useState, useCallback } from 'react';
import SchedulerSearch from './SchedulerSearch';
import SchedulerStashPanel from './SchedulerStashPanel';
import CourseInfoPanel from '../planner/CourseInfoPanel';

// Scheduler-left toggle between course search and the planner's Paw-tential
// stash — modeled on the planner's SearchPanelTabs: same pill toggle, and
// both tabs stay mounted (hidden via CSS) so the search keeps its query.
export default function SchedulerLeftTabs({ user, authLoading, draftCourseKeys, onAddCourse, theme }) {
  const [activeTab, setActiveTab] = useState('search');
  // The one CourseInfoPanel ("i"), like PlannerPage's infoCourseKey. Kept
  // outside both tab bodies so flipping tabs doesn't hide it, and mounted only
  // while open so it mounts after the catalog has loaded (its season detail
  // reads the catalog index at mount — see useUpcomingSeasons).
  const [infoCourseKey, setInfoCourseKey] = useState(null);
  const closeCourseInfo = useCallback(() => setInfoCourseKey(null), []);

  return (
    <div className="search-panel-tabs">
      <div className="hub-year-toggle-group search-panel-toggle">
        <button
          type="button"
          className={`hub-year-toggle-btn ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          Add a Course
        </button>
        <button
          type="button"
          className={`hub-year-toggle-btn ${activeTab === 'stash' ? 'active' : ''}`}
          onClick={() => setActiveTab('stash')}
        >
          Paw-tential
        </button>
      </div>

      <div className={`search-panel-tab-body${activeTab === 'search' ? '' : ' side-panel-hidden'}`}>
        <SchedulerSearch
          draftCourseKeys={draftCourseKeys}
          onAddCourse={onAddCourse}
          onShowCourseInfo={setInfoCourseKey}
          theme={theme}
        />
      </div>
      <div className={`search-panel-tab-body${activeTab === 'stash' ? '' : ' side-panel-hidden'}`}>
        <SchedulerStashPanel
          active={activeTab === 'stash'}
          user={user}
          authLoading={authLoading}
          draftCourseKeys={draftCourseKeys}
          onAddCourse={onAddCourse}
          onShowCourseInfo={setInfoCourseKey}
          theme={theme}
        />
      </div>

      {infoCourseKey && <CourseInfoPanel courseKey={infoCourseKey} onClose={closeCourseInfo} />}
    </div>
  );
}
