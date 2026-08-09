import { useState, useMemo, useEffect } from 'react';
import { evaluateRequirementTree } from '../../utils/requirementsEngine';
import MajorPicker from './MajorPicker';

// Auto-discovers every program file under src/data/requirements/** so new
// majors just need a JSON file dropped in — no registry to hand-maintain.
const requirementModules = import.meta.glob('../../data/requirements/**/*.json', { eager: true });
const REQUIREMENT_PROGRAMS = Object.values(requirementModules).map((mod) => mod.default ?? mod);

function describeMissing(entry) {
  return typeof entry === 'string' ? entry : entry.label;
}

// Most requirement trees are flat enough (a handful of leaf-type groups
// directly under the root) that there's nothing to collapse — each group is
// already a single row. Sorting unsatisfied first is what actually makes the
// "what's left" items easier to spot in that shape; satisfied-group collapse
// (below) still kicks in for deeper trees where a group has its own children.
function statusRank(node) {
  if (node.type === 'UNRESOLVED') return 1;
  return node.status === 'satisfied' ? 2 : 0;
}

function RequirementNodeView({ node, isRoot = false, collapsedOverrides, onToggle }) {
  if (node.type === 'ALL' && Array.isArray(node.children)) {
    const orderedChildren = [...node.children].sort((a, b) => statusRank(a) - statusRank(b));
    const children = orderedChildren.map((child, i) => (
      <RequirementNodeView
        key={child.label ?? i}
        node={child}
        collapsedOverrides={collapsedOverrides}
        onToggle={onToggle}
      />
    ));
    if (isRoot) return <>{children}</>;

    // Satisfied groups collapse to a one-line summary by default so
    // whatever's still unsatisfied is what actually catches the eye.
    const collapsed = collapsedOverrides[node.label] ?? node.status === 'satisfied';
    return (
      <div className="req-group">
        <div
          className="req-group-header"
          role="button"
          tabIndex={0}
          onClick={() => onToggle(node.label, collapsed)}
          onKeyDown={(e) => e.key === 'Enter' && onToggle(node.label, collapsed)}
        >
          <span className="panel-group-caret">{collapsed ? '▸' : '▾'}</span>
          <span className="req-group-label">{node.label}</span>
          <span className={`req-group-progress${node.status === 'satisfied' ? ' satisfied' : ''}`}>
            {node.satisfiedCount}/{node.required}
          </span>
        </div>
        {!collapsed && <div className="req-group-children">{children}</div>}
      </div>
    );
  }

  const isUnresolved = node.type === 'UNRESOLVED';
  const statusClass = isUnresolved ? 'needs-review' : node.status === 'satisfied' ? 'fulfilled' : 'pending';
  const missingDetail =
    !isUnresolved && node.status !== 'satisfied' && node.missing?.length > 0
      ? `Needs: ${node.missing.map(describeMissing).join(', ')}`
      : null;

  return (
    <div className={`req-node ${statusClass}`}>
      <div className="req-node-indicator">
        {isUnresolved ? '!' : node.status === 'satisfied' ? '✓' : '○'}
      </div>
      <div className="req-node-info">
        <span className="req-node-label" title={node.label}>{node.label}</span>
        {isUnresolved && node.note && <span className="req-node-detail">{node.note}</span>}
        {/* TODO: once drag-requirement-into-planner exists, a per-course drag
            handle on each entry in node.missing would attach here — not
            building that interaction in this pass. */}
        {missingDetail && <span className="req-node-detail">{missingDetail}</span>}
      </div>
      {isUnresolved ? (
        <span className="req-node-review-badge">Needs review</span>
      ) : (
        <span className={`req-node-count ${node.status === 'satisfied' ? 'satisfied' : ''}`}>
          {node.satisfiedCount}/{node.required}
        </span>
      )}
    </div>
  );
}

export default function RequirementsSidebar({
  majorBulletinUrl,
  planCourseKeys = [],
  onMajorSelect,
  onSummaryChange,
}) {
  const [collapsedOverrides, setCollapsedOverrides] = useState({});

  const programDef = useMemo(
    () => REQUIREMENT_PROGRAMS.find((p) => p.bulletinUrl === majorBulletinUrl) || null,
    [majorBulletinUrl]
  );

  const result = useMemo(
    () => (programDef ? evaluateRequirementTree(programDef, planCourseKeys) : null),
    [programDef, planCourseKeys]
  );

  useEffect(() => {
    onSummaryChange?.({
      badge: result ? `${result.totalCoursesClaimed}/${result.totalCoursesRequired}` : '—',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function toggleGroup(label, currentlyCollapsed) {
    setCollapsedOverrides((prev) => ({ ...prev, [label]: !currentlyCollapsed }));
  }

  return (
    <div className="req-panel">
      {/* Standalone picker — Requirements tracking must work without ever
          opening the Bulletin panel, so this sets majorBulletinUrl directly. */}
      <MajorPicker
        idPrefix="requirements-major"
        selectedProgramUrl={majorBulletinUrl || ''}
        onProgramSelect={onMajorSelect}
      />

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
          <p className="panel-summary-line">
            {result.totalCoursesClaimed} of {result.totalCoursesRequired} courses counted toward{' '}
            {result.programName} {result.degree}
          </p>

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
            />
          </div>
        </>
      )}
    </div>
  );
}
