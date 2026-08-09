import { useState, useMemo, useEffect } from 'react';
import { evaluateRequirementTree } from '../../utils/requirementsEngine';
import { normalizeCourseKey } from '../../utils/courseKey';
import { REQUIREMENT_PROGRAMS } from './programs';
import { collectAllNodes, collectUnresolvedNodes, collectAllCourseKeys } from './treeHelpers';
import MajorPicker from '../planner/MajorPicker';
import SemesterPickerModal from '../planner/SemesterPickerModal';
import RequirementNodeView from './RequirementNodeView';
import ExceptionModal from './ExceptionModal';

// The one source of truth for requirement-tree rendering — evaluates the
// program against the plan's courseKeys and renders the tree, pool
// chips, exception flow, and UNRESOLVED summary. Used both by the compact
// sidebar tab (density="compact") and the full-screen view
// (density="full") — see RequirementsSidebar.jsx and RequirementsFullView.jsx.
// Full density additionally accepts `lockStatusMap` (courseKey ->
// {locked, source}, display-only — never fed into evaluateRequirementTree)
// to distinguish planned vs. completed courses in claimed/fulfilled chips.
export default function RequirementTree({
  density = 'compact',
  majorBulletinUrl,
  planCourseKeys = [],
  onMajorSelect,
  onSummaryChange,
  courseMap = {},
  activeSemIndex,
  semesterOptions,
  onAddCourse,
  onEnsureCourseData,
  onBrowseRange,
  requirementOverrides = {},
  onSetRequirementOverride,
  onRemoveRequirementOverride,
  lockStatusMap,
  onOpenFullView,
}) {
  const [collapsedOverrides, setCollapsedOverrides] = useState({});
  const [pickerCourseKey, setPickerCourseKey] = useState(null);
  const [unresolvedExpanded, setUnresolvedExpanded] = useState(false);
  const [exceptionModalOpen, setExceptionModalOpen] = useState(false);
  const [exceptionInitialNodeId, setExceptionInitialNodeId] = useState(null);

  const programDef = useMemo(
    () => REQUIREMENT_PROGRAMS.find((p) => p.bulletinUrl === majorBulletinUrl) || null,
    [majorBulletinUrl]
  );

  const result = useMemo(
    () => (programDef ? evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides) : null),
    [programDef, planCourseKeys, requirementOverrides]
  );

  const flatNodes = useMemo(() => (result ? collectAllNodes(result.tree) : []), [result]);
  const unresolvedNodes = useMemo(() => (result ? collectUnresolvedNodes(result.tree) : []), [result]);

  // The engine's own claim set is built from this same normalization, so
  // matching it here is what lets "already claimed elsewhere" and "already
  // in the plan" collapse into a single addability check.
  const planCourseKeySet = useMemo(
    () => new Set(Array.from(planCourseKeys).filter(Boolean).map(normalizeCourseKey)),
    [planCourseKeys]
  );

  const percentComplete = result && result.totalCoursesRequired > 0
    ? Math.min(100, Math.round((result.totalCoursesClaimed / result.totalCoursesRequired) * 100))
    : 0;

  useEffect(() => {
    onSummaryChange?.({
      badge: result ? `${result.totalCoursesClaimed}/${result.totalCoursesRequired}` : '—',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  useEffect(() => {
    if (!result || !onEnsureCourseData) return;
    const keys = Array.from(collectAllCourseKeys(result.tree));
    const missing = keys.filter((key) => !courseMap[key]);
    if (missing.length > 0) onEnsureCourseData(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function toggleGroup(label, currentlyCollapsed) {
    setCollapsedOverrides((prev) => ({ ...prev, [label]: !currentlyCollapsed }));
  }

  // Same add-to-plan logic as the search-results chip click: add straight to
  // the focused semester, or fall back to the semester picker if none is
  // focused.
  function handleAddCourse(courseKey) {
    if (activeSemIndex !== undefined && activeSemIndex !== null) {
      onAddCourse(courseKey, activeSemIndex);
    } else {
      setPickerCourseKey(courseKey);
    }
  }

  function openExceptionPicker() {
    setExceptionInitialNodeId(null);
    setExceptionModalOpen(true);
  }

  function openExceptionFor(nodeId) {
    setExceptionInitialNodeId(nodeId);
    setExceptionModalOpen(true);
  }

  return (
    <div className={`req-panel${density === 'full' ? ' req-panel--full' : ''}`}>
      {/* Standalone picker — Requirements tracking must work without ever
          opening the Bulletin panel, so this sets majorBulletinUrl directly. */}
      <MajorPicker
        idPrefix={density === 'full' ? 'requirements-full-major' : 'requirements-major'}
        selectedProgramUrl={majorBulletinUrl || ''}
        onProgramSelect={onMajorSelect}
      />

      {/* Single consolidated entry point for waive/substitute exceptions —
          replaces the old per-node "Mark as waived"/"Mark as petitioned"
          trigger. See ExceptionModal. */}
      {result && (
        <button type="button" className="req-exception-entry" onClick={openExceptionPicker}>
          Report an exception
        </button>
      )}

      {!majorBulletinUrl && (
        <div className="panel-empty-state">
          <p>Pick a major above to track your degree requirements.</p>
        </div>
      )}

      {majorBulletinUrl && !programDef && (
        <div className="panel-empty-state">
          <p>Requirements tracking isn't built for this major yet.</p>
        </div>
      )}

      {result && (
        <>
          {density === 'full' ? (
            <div className="req-progress-summary">
              <p className="req-progress-summary-text">
                {result.totalCoursesClaimed} of {result.totalCoursesRequired} courses counted — {percentComplete}% complete
              </p>
              <div
                className="req-progress-bar"
                role="progressbar"
                aria-valuenow={percentComplete}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="req-progress-bar-fill" style={{ width: `${percentComplete}%` }} />
              </div>
              <p className="req-progress-summary-sub">{result.programName} {result.degree}</p>
            </div>
          ) : (
            <div className="panel-summary-row">
              <p className="panel-summary-line">
                {result.totalCoursesClaimed} of {result.totalCoursesRequired} courses counted toward{' '}
                {result.programName} {result.degree}
              </p>
              {onOpenFullView && (
                <button
                  type="button"
                  className="req-open-full-btn"
                  onClick={onOpenFullView}
                  title="Open full-screen Requirements view"
                >
                  Open full view ⤢
                </button>
              )}
            </div>
          )}

          {result.status === 'satisfied' && (
            <div className="panel-all-fulfilled">
              <p>All requirements satisfied!</p>
            </div>
          )}

          <div className="req-tree">
            <RequirementNodeView
              node={result.tree}
              isRoot
              collapsedOverrides={collapsedOverrides}
              onToggle={toggleGroup}
              planCourseKeySet={planCourseKeySet}
              courseMap={courseMap}
              onAddCourse={handleAddCourse}
              onBrowseRange={onBrowseRange}
              requirementOverrides={requirementOverrides}
              onRemoveRequirementOverride={onRemoveRequirementOverride}
              density={density}
              lockStatusMap={lockStatusMap}
            />
          </div>

          {unresolvedNodes.length > 0 && (
            <div className="req-unresolved-summary">
              <button
                type="button"
                className="req-unresolved-summary-toggle"
                onClick={() => setUnresolvedExpanded((v) => !v)}
              >
                <span className="panel-group-caret">{unresolvedExpanded ? '▾' : '▸'}</span>
                {unresolvedNodes.length} discretionary/petition item{unresolvedNodes.length === 1 ? '' : 's'} — tap to review
              </button>
              {unresolvedExpanded && (
                <ul className="req-unresolved-list">
                  {unresolvedNodes.map((n) => (
                    <li key={n.id} className="req-unresolved-item">
                      <span className="req-unresolved-item-label">{n.label}</span>
                      <button
                        type="button"
                        className="req-unresolved-item-action"
                        onClick={() => openExceptionFor(n.id)}
                      >
                        Report an exception
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <ExceptionModal
        open={exceptionModalOpen}
        initialNodeId={exceptionInitialNodeId}
        flatNodes={flatNodes}
        requirementOverrides={requirementOverrides}
        planCourseKeySet={planCourseKeySet}
        courseMap={courseMap}
        onAddCourse={handleAddCourse}
        onSetOverride={onSetRequirementOverride}
        onRemoveOverride={onRemoveRequirementOverride}
        onClose={() => setExceptionModalOpen(false)}
      />

      <SemesterPickerModal
        course={
          pickerCourseKey
            ? { id: pickerCourseKey, courseNumber: courseMap[pickerCourseKey]?.courseNumber ?? pickerCourseKey }
            : null
        }
        semesterOptions={semesterOptions}
        onPick={(target) => {
          onAddCourse(pickerCourseKey, target);
          setPickerCourseKey(null);
        }}
        onClose={() => setPickerCourseKey(null)}
      />
    </div>
  );
}
