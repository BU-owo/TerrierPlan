import { useState, useRef, useEffect } from 'react';
import CourseSearch from './CourseSearch';
import StashPanel from './StashPanel';

// How long the "Paw-tential Courses" tab flashes for after a course gets
// starred — needs to roughly match the flash CSS animation's duration.
const STASH_FLASH_MS = 700;

// Toggles the planner-left panel between live Course Search and the
// "Paw-tential Courses" stash — mirrors SidePanelTabs' approach on the right
// side (both tabs stay mounted, hidden via CSS, so neither loses its own
// state — search query/filters, stash's semester-picker modal — when the
// student flips back and forth) but uses the two-state pill toggle style
// (hub-year-toggle-group/-btn) rather than that panel's bar-of-tabs look,
// per the existing First-Year/Transfer toggle in HubSidebar.
export default function SearchPanelTabs({
  theme,
  activeSemIndex,
  onActiveSemChange,
  semesterOptions,
  coursesInPlan,
  onAddCourse,
  rangeFilter,
  onClearRangeFilter,
  stash,
  courseMap,
  onAddToStash,
  onRemoveFromStash,
}) {
  const [activeTab, setActiveTab] = useState('search');
  // Starring a course from Search doesn't switch tabs (so the student can
  // keep browsing), so this is the only signal that something landed in the
  // stash — a quick flash on the tab itself instead of a toast/notification.
  const [stashFlash, setStashFlash] = useState(false);
  const flashTimeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(flashTimeoutRef.current), []);

  function handleAddToStash(courseKey) {
    onAddToStash(courseKey);
    // Force the CSS animation to restart even if a flash is already
    // in-flight (e.g. starring two courses back to back) — toggling the
    // class off then back on next frame re-triggers it from scratch.
    setStashFlash(false);
    requestAnimationFrame(() => setStashFlash(true));
    clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setStashFlash(false), STASH_FLASH_MS);
  }

  return (
    <div className="search-panel-tabs">
      <div className="hub-year-toggle-group search-panel-toggle">
        <button
          type="button"
          className={`hub-year-toggle-btn ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          Search
        </button>
        <button
          type="button"
          className={`hub-year-toggle-btn ${activeTab === 'stash' ? 'active' : ''}${stashFlash ? ' flash' : ''}`}
          onClick={() => setActiveTab('stash')}
        >
          Paw-tential Courses
        </button>
      </div>

      <div className={`search-panel-tab-body${activeTab === 'search' ? '' : ' side-panel-hidden'}`}>
        <CourseSearch
          theme={theme}
          activeSemIndex={activeSemIndex}
          onActiveSemChange={onActiveSemChange}
          semesterOptions={semesterOptions}
          coursesInPlan={coursesInPlan}
          onAddCourse={onAddCourse}
          rangeFilter={rangeFilter}
          onClearRangeFilter={onClearRangeFilter}
          stash={stash}
          onAddToStash={handleAddToStash}
          onRemoveFromStash={onRemoveFromStash}
        />
      </div>
      <div className={`search-panel-tab-body${activeTab === 'stash' ? '' : ' side-panel-hidden'}`}>
        <StashPanel
          theme={theme}
          stash={stash}
          courseMap={courseMap}
          activeSemIndex={activeSemIndex}
          semesterOptions={semesterOptions}
          coursesInPlan={coursesInPlan}
          onAddCourse={onAddCourse}
          onRemoveFromStash={onRemoveFromStash}
        />
      </div>
    </div>
  );
}
