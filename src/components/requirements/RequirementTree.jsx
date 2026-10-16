import { useState, useMemo, useEffect, useRef } from 'react';
import { evaluateRequirementTree } from '../../utils/requirementsEngine';
import { normalizeCourseKey } from '../../utils/courseKey';
import { REQUIREMENT_PROGRAMS } from './programs';
import { collectAllNodes, collectAllCourseKeys, collectMatchedKeys, segmentCards } from './treeHelpers';
import MajorPicker from '../planner/MajorPicker';
import RequirementNodeView from './RequirementNodeView';
import ExceptionModal from './ExceptionModal';
import EstimateNote from '../EstimateNote';
import { BU_LINKS } from '../../data/officialLinks';
import { RequirementDragContext } from './requirementDrag';
import { unresolvedLast } from '../../utils/unresolvedLast';
import { DISCORD_URL, SUPPORT_EMAIL } from '../HelpSupportModal';
import { findProgramByUrl } from '../../data/bu-programs';
import useInactiveCourseKeys from '../../hooks/useInactiveCourseKeys';

// The one source of truth for requirement-tree rendering — evaluates the
// program against the plan's courseKeys and renders the tree as cards (one
// per top-level node, bulletin order), slot rows, and the per-node "⋯"
// exception flow. Used both by the compact sidebar tab (density="compact")
// and the full-screen view (density="full") — see RequirementsSidebar.jsx
// and RequirementsFullView.jsx.
// Full density additionally accepts `lockStatusMap` (courseKey ->
// {locked, source}, display-only — never fed into evaluateRequirementTree)
// to distinguish planned vs. completed courses in claimed/fulfilled chips.
// Course chips toggle Paw-tential Courses (`stash`) — never the plan.
export default function RequirementTree({
  density = 'compact',
  majorBulletinUrl,
  planCourseKeys = [],
  onMajorSelect,
  onSummaryChange,
  courseMap = {},
  onEnsureCourseData,
  requirementOverrides = {},
  onSetRequirementOverride,
  onRemoveRequirementOverride,
  lockStatusMap,
  onOpenFullView,
  stash = [],
  onAddToStash,
  onRemoveFromStash,
  onShowCourseInfo,
  // Sidebar on desktop: course rows can be dragged onto semesters.
  dragEnabled = false,
}) {
  const [collapsedOverrides, setCollapsedOverrides] = useState({});
  // { nodeId, mode: 'waive' | 'substitute' } while the exception form is open
  // ('waive' is only "Mark as done" on an UNRESOLVED node).
  const [exception, setException] = useState(null);

  const programDef = useMemo(
    () => REQUIREMENT_PROGRAMS.find((p) => p.bulletinUrl === majorBulletinUrl) || null,
    [majorBulletinUrl]
  );

  const result = useMemo(
    () => (programDef ? evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides) : null),
    [programDef, planCourseKeys, requirementOverrides]
  );

  const flatNodes = useMemo(() => (result ? collectAllNodes(result.tree) : []), [result]);

  // The engine's own claim set is built from this same normalization, so
  // matching it here is what lets "already claimed elsewhere" and "already
  // in the plan" collapse into a single check.
  const planCourseKeySet = useMemo(
    () => new Set(Array.from(planCourseKeys).filter(Boolean).map(normalizeCourseKey)),
    [planCourseKeys]
  );

  const stashSet = useMemo(() => new Set(stash), [stash]);
  // Long-unoffered courses, hidden from requirement choice lists (see hideInactive).
  const inactiveKeys = useInactiveCourseKeys();

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

  function isCollapsed(node) {
    return collapsedOverrides[node.id] ?? node.status === 'satisfied';
  }

  function toggleNode(id, currentlyCollapsed) {
    setCollapsedOverrides((prev) => ({ ...prev, [id]: !currentlyCollapsed }));
  }

  const anyCollapsed = flatNodes.some(isCollapsed);

  function toggleAll() {
    setCollapsedOverrides(Object.fromEntries(flatNodes.map((n) => [n.id, !anyCollapsed])));
  }

  // Whole-row click on a course row: add only (the paw removes). Shows a
  // short "Added to Paw-tential · Undo" toast; already-stashed rows do
  // nothing.
  const [toastKey, setToastKey] = useState(null);
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function addFromRow(courseKey) {
    if (stashSet.has(courseKey)) return;
    onAddToStash?.(courseKey);
    clearTimeout(toastTimer.current);
    setToastKey(courseKey);
    toastTimer.current = setTimeout(() => setToastKey(null), 4000);
  }

  function undoAddFromRow() {
    clearTimeout(toastTimer.current);
    onRemoveFromStash?.(toastKey);
    setToastKey(null);
  }

  function toggleStash(courseKey) {
    if (stashSet.has(courseKey)) onRemoveFromStash?.(courseKey);
    else onAddToStash?.(courseKey);
  }

  const exceptionNode = exception ? flatNodes.find((n) => n.id === exception.nodeId) || null : null;

  // "Substitute a course" choices: any course in the plan that no requirement
  // is counting yet (a course not in the plan yet can be typed in the form).
  const substituteOptions = useMemo(() => {
    if (!exceptionNode || exception?.mode !== 'substitute' || !result) return [];
    const claimed = new Set(collectMatchedKeys(result.tree));
    return Array.from(planCourseKeySet).filter((key) => !claimed.has(key)).sort();
  }, [exceptionNode, exception, result, planCourseKeySet]);

  // Petitions (see requirementsEngine's normalizeSubstitutions). One override
  // per node: { type: 'substitute', substitutions: [{ courseKey, for? }],
  // note? }. Rebuilt from the evaluated node's normalized list, so an older
  // single-course substitute is upgraded the first time it's touched. Fields
  // are omitted rather than set to undefined (Firestore rejects undefined),
  // and a node left with no substitutions loses its override entirely.
  function writeSubstitutions(node, list, newNote) {
    if (list.length === 0) {
      onRemoveRequirementOverride?.(node.id);
      return;
    }
    const existingNote = requirementOverrides[node.id]?.note;
    const note = typeof existingNote === 'string' && existingNote ? existingNote : newNote;
    onSetRequirementOverride?.(node.id, {
      type: 'substitute',
      substitutions: list,
      ...(note ? { note } : {}),
    });
  }

  const toStored = (sub) => ({
    ...(sub.courseKey ? { courseKey: sub.courseKey } : {}),
    ...(sub.label ? { label: sub.label } : {}),
    ...(sub.for ? { for: sub.for } : {}),
  });

  // `courseKey` (a catalog course) and/or `label` (free text for a course from
  // somewhere else); `replaces` is the required course it stands in for.
  function addSubstitution(node, { courseKey, label, replaces, note }) {
    const current = (node.substitutions ?? []).map(toStored);
    writeSubstitutions(node, [...current, toStored({ courseKey, label, for: replaces })], note);
  }

  function undoSubstitution(node, index) {
    const next = (node.substitutions ?? []).filter((_, i) => i !== index).map(toStored);
    writeSubstitutions(node, next);
  }

  const shared = {
    collapsedOverrides,
    onToggle: toggleNode,
    planCourseKeySet,
    courseMap,
    density,
    lockStatusMap,
    stashSet,
    onToggleStash: toggleStash,
    onShowCourseInfo,
    requirementOverrides,
    onRemoveRequirementOverride,
    onMarkDone: (node) => setException({ nodeId: node.id, mode: 'waive' }),
    onSubstitute: (node) => setException({ nodeId: node.id, mode: 'substitute' }),
    onUndo: (node) => onRemoveRequirementOverride(node.id),
    onUndoSubstitution: undoSubstitution,
    flatNodes,
    onAddFromRow: addFromRow,
    inactiveKeys,
  };

  // Same "planning only" line as the HUB views, under the progress summary
  // (prominent in the full view, the small sidebar size in compact).
  const disclaimer = (
    <EstimateNote
      prominent={density === 'full'}
      link={BU_LINKS.myBU}
      lead="For planning only. Verify on the official bulletin and"
      label="MyBU"
    />
  );

  // Tracked programs only; the coming-soon branch has its own bulletin button.
  const bulletinLink = programDef ? (
    <a
      href={programDef.bulletinUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="req-bulletin-link"
    >
      View official bulletin ↗
    </a>
  ) : null;

  const topNodes = result
    ? (Array.isArray(result.tree.children) ? unresolvedLast(result.tree.children) : [result.tree])
    : [];
  // Collapsed cards share grid rows in full density (same as HubFullView);
  // the narrow compact sidebar just stacks them.
  const segments = density === 'full'
    ? segmentCards(topNodes, isCollapsed)
    : topNodes.map((item) => ({ type: 'solo', item }));

  return (
    <RequirementDragContext.Provider value={density === 'compact' && dragEnabled}>
    <div className={`req-panel${density === 'full' ? ' req-panel--full' : ''}`}>
      {/* Sidebar only: way into the full view, same banner as HubSidebar's. */}
      {density === 'compact' && onOpenFullView && (
        <button
          type="button"
          className="hub-full-view-banner"
          onClick={onOpenFullView}
          title="Open full-screen Requirements view"
        >
          <span className="hub-full-view-banner-icon" aria-hidden="true">⤢</span>
          Full view
        </button>
      )}

      {/* Standalone picker — Requirements tracking must work without ever
          opening the Bulletin panel, so this sets majorBulletinUrl directly. */}
      <MajorPicker
        idPrefix={density === 'full' ? 'requirements-full-major' : 'requirements-major'}
        selectedProgramUrl={majorBulletinUrl || ''}
        onProgramSelect={onMajorSelect}
      />

      {!majorBulletinUrl && (
        <div className="panel-empty-state">
          <p>Pick a major above to track your degree requirements.</p>
          <p className="panel-empty-disclaimer">
Hey! This tracker is a work in progress. ~200 majors need to be structured and confirmed manually. I'm only one fella.... Please confirm against the bulletin!
          </p>
        </div>
      )}

      {majorBulletinUrl && !programDef && (
        <div className="panel-empty-state req-coming-soon">
          <p>Tracking for this major is coming soon. Until then, here&apos;s the bulletin page.</p>
          <a
            href={majorBulletinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="req-bulletin-open-btn"
          >
            Open {findProgramByUrl(majorBulletinUrl)?.name ?? 'program'} bulletin ↗
          </a>
          <p className="req-coming-soon-ask">
            Want yours next? Let us know on{' '}
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord</a> or at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      )}

      {/* No progress card without a tracked program — the disclaimer still shows. */}
      {!result && disclaimer}

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
              {bulletinLink}
            </div>
          ) : (
            <div className="req-compact-summary">
              <p className="panel-summary-line">
                {result.totalCoursesClaimed} of {result.totalCoursesRequired} courses counted
                <span className="req-beta-tag">Beta</span>
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
              {bulletinLink}
            </div>
          )}

          {disclaimer}

          {result.status === 'satisfied' && (
            <div className="panel-all-fulfilled">
              <p>All requirements satisfied!</p>
            </div>
          )}

          {density === 'full' && (
            <div className="hub-full-overview-toolbar req-toolbar">
              <button type="button" className="panel-open-full-btn" onClick={toggleAll}>
                {anyCollapsed ? 'Expand all' : 'Collapse all'}
              </button>
            </div>
          )}

          <div className="hub-full-groups req-tree">
            {segments.map((segment, i) =>
              segment.type === 'solo' ? (
                <RequirementNodeView key={segment.item.id} node={segment.item} {...shared} />
              ) : (
                <div key={`run-${i}`} className="hub-full-groups-row">
                  {segment.items.map((node) => (
                    <RequirementNodeView key={node.id} node={node} {...shared} />
                  ))}
                </div>
              ),
            )}
          </div>
        </>
      )}

      {toastKey && (
        <div className="req-toast" role="status">
          Added to Paw-tential ·{' '}
          <button type="button" className="req-toast-undo" onClick={undoAddFromRow}>Undo</button>
        </div>
      )}

      <ExceptionModal
        key={exception ? `${exception.nodeId}:${exception.mode}` : 'closed'}
        node={exceptionNode}
        mode={exception?.mode}
        substituteOptions={substituteOptions}
        hasNote={Boolean(exceptionNode && requirementOverrides[exceptionNode.id]?.note)}
        courseMap={courseMap}
        onSubstitute={addSubstitution}
        onSetOverride={onSetRequirementOverride}
        onClose={() => setException(null)}
      />
    </div>
    </RequirementDragContext.Provider>
  );
}
