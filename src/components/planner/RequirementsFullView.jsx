import { useEffect } from 'react';
import RequirementTree from '../requirements/RequirementTree';

// Full-screen overlay/mode rendered from inside PlannerPage (not a route —
// see PlannerPage's requirementsFullView state) so it shares the exact same
// plan state and handlers as the compact sidebar tab instead of duplicating
// any of it. All tree-walk/pool/exception logic lives in the shared
// RequirementTree (density="full" here) — this component is just the
// full-screen chrome around it.
export default function RequirementsFullView({
  majorBulletinUrl,
  planCourseKeys,
  onMajorSelect,
  courseMap,
  activeSemIndex,
  semesterOptions,
  onAddCourse,
  onEnsureCourseData,
  onBrowseRange,
  requirementOverrides,
  onSetRequirementOverride,
  onRemoveRequirementOverride,
  lockStatusMap,
  onClose,
}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="req-full-view" role="dialog" aria-modal="true" aria-label="Requirements">
      <header className="req-full-view-header">
        <h2 className="req-full-view-title">Requirements</h2>
        <button
          type="button"
          className="req-full-view-close"
          onClick={onClose}
          aria-label="Close full-screen requirements view"
        >
          × Close
        </button>
      </header>
      <div className="req-full-view-body">
        <div className="req-full-view-inner">
          <RequirementTree
            density="full"
            majorBulletinUrl={majorBulletinUrl}
            planCourseKeys={planCourseKeys}
            onMajorSelect={onMajorSelect}
            courseMap={courseMap}
            activeSemIndex={activeSemIndex}
            semesterOptions={semesterOptions}
            onAddCourse={onAddCourse}
            onEnsureCourseData={onEnsureCourseData}
            onBrowseRange={onBrowseRange}
            requirementOverrides={requirementOverrides}
            onSetRequirementOverride={onSetRequirementOverride}
            onRemoveRequirementOverride={onRemoveRequirementOverride}
            lockStatusMap={lockStatusMap}
          />
        </div>
      </div>
    </div>
  );
}
