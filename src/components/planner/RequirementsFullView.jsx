import { useEffect } from 'react';
import RequirementTree from '../requirements/RequirementTree';
import FullViewHeader from './FullViewHeader';

// Full-screen overlay/mode rendered from inside PlannerPage (not a route —
// see PlannerPage's requirementsFullView state) so it shares the exact same
// plan state and handlers as the compact sidebar tab instead of duplicating
// any of it. All tree-walk/pool/exception logic lives in the shared
// RequirementTree (density="full" here) — this component is just the
// full-screen chrome around it. Course chips here toggle Paw-tential
// Courses (stash), never the plan, so the add-to-plan / browse-in-Search
// props PlannerPage still passes are deliberately not forwarded.
export default function RequirementsFullView({
  majorBulletinUrl,
  planCourseKeys,
  marineSlots,
  onMajorSelect,
  courseMap,
  onEnsureCourseData,
  requirementOverrides,
  onSetRequirementOverride,
  onRemoveRequirementOverride,
  lockStatusMap,
  splitStatusMap,
  stash,
  onAddToStash,
  onRemoveFromStash,
  onShowCourseInfo,
  onClose,
  // Swaps to the HUB overlay without closing (see FullViewHeader).
  onSwitchView,
  // True while CourseInfoPanel is open, so its own Escape closes just it.
  ignoreEscape = false,
}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !ignoreEscape) onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, ignoreEscape]);

  return (
    <div className="req-full-view" role="dialog" aria-modal="true" aria-label="Requirements">
      <FullViewHeader
        title="Requirements"
        view="requirements"
        onSwitchView={onSwitchView}
        onClose={onClose}
        closeAriaLabel="Close full-screen requirements view"
      />
      <div className="req-full-view-body">
        <div className="req-full-view-inner">
          <RequirementTree
            density="full"
            majorBulletinUrl={majorBulletinUrl}
            planCourseKeys={planCourseKeys}
            marineSlots={marineSlots}
            onMajorSelect={onMajorSelect}
            courseMap={courseMap}
            onEnsureCourseData={onEnsureCourseData}
            requirementOverrides={requirementOverrides}
            onSetRequirementOverride={onSetRequirementOverride}
            onRemoveRequirementOverride={onRemoveRequirementOverride}
            lockStatusMap={lockStatusMap}
            splitStatusMap={splitStatusMap}
            stash={stash}
            onAddToStash={onAddToStash}
            onRemoveFromStash={onRemoveFromStash}
            onShowCourseInfo={onShowCourseInfo}
          />
        </div>
      </div>
    </div>
  );
}
