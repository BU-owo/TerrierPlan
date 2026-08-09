import { describeMissing, statusRank, collectPoolCourses } from './treeHelpers';
import CoursePool from './CoursePool';
import PetitionActiveDisplay from './PetitionActiveDisplay';
import SequenceGroupDetail from './SequenceGroupDetail';

export default function RequirementNodeView({
  node,
  isRoot = false,
  collapsedOverrides,
  onToggle,
  planCourseKeySet,
  courseMap,
  onAddCourse,
  onBrowseRange,
  requirementOverrides,
  onRemoveRequirementOverride,
  density = 'compact',
  lockStatusMap,
}) {
  // A waived container is rendered as a flat "petitioned" row instead (see
  // below) — it has no evaluated children to recurse into, since evaluation
  // was skipped entirely for it.
  if (node.type === 'ALL' && Array.isArray(node.children) && !node.waived) {
    // Non-overridden UNRESOLVED children are collapsed out of the inline
    // tree entirely — they surface in the bottom summary row instead (see
    // collectUnresolvedNodes). An overridden UNRESOLVED node still renders
    // inline with its Petitioned badge.
    const visibleChildren = node.children.filter(
      (child) => !(child.type === 'UNRESOLVED' && !child.waived && !child.substituted)
    );
    const orderedChildren = [...visibleChildren].sort((a, b) => statusRank(a) - statusRank(b));
    const children = orderedChildren.map((child, i) => (
      <RequirementNodeView
        key={child.label ?? i}
        node={child}
        collapsedOverrides={collapsedOverrides}
        onToggle={onToggle}
        planCourseKeySet={planCourseKeySet}
        courseMap={courseMap}
        onAddCourse={onAddCourse}
        onBrowseRange={onBrowseRange}
        requirementOverrides={requirementOverrides}
        onRemoveRequirementOverride={onRemoveRequirementOverride}
        density={density}
        lockStatusMap={lockStatusMap}
      />
    ));
    if (isRoot) return <>{children}</>;

    // Satisfied groups collapse to a one-line summary by default so
    // whatever's still unsatisfied is what actually catches the eye.
    const collapsed = collapsedOverrides[node.label] ?? node.status === 'satisfied';
    const override = requirementOverrides?.[node.id];
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
        {!collapsed && (
          <>
            <div className="req-group-children">{children}</div>
            <PetitionActiveDisplay
              node={node}
              override={override}
              courseMap={courseMap}
              onRemoveOverride={onRemoveRequirementOverride}
            />
          </>
        )}
      </div>
    );
  }

  const isUnresolved = node.type === 'UNRESOLVED';
  const isOverridden = Boolean(node.waived || node.substituted);
  const statusClass = isOverridden
    ? 'petitioned'
    : isUnresolved ? 'needs-review' : node.status === 'satisfied' ? 'fulfilled' : 'pending';

  let indicatorSymbol;
  if (node.waived) indicatorSymbol = '✎';
  else if (isUnresolved) indicatorSymbol = node.substituted ? (node.status === 'satisfied' ? '✓' : '○') : '!';
  else indicatorSymbol = node.status === 'satisfied' ? '✓' : '○';

  const isSequenceGroup = node.type === 'SEQUENCE_GROUP';
  const missingDetail =
    !isUnresolved && !isOverridden && !isSequenceGroup && node.status !== 'satisfied' && node.missing?.length > 0
      ? `Needs: ${node.missing.map((entry) => describeMissing(entry, courseMap, density)).join(', ')}`
      : null;
  const showSequenceDetail = isSequenceGroup && !isOverridden && node.status !== 'satisfied';

  // UNRESOLVED nodes (petition clauses) have no fixed course list to add
  // from, so they never get a pool — description + badge only. Same for any
  // node once overridden — the override supersedes normal course tracking.
  const pool = isUnresolved || isOverridden ? null : collectPoolCourses(node, planCourseKeySet);
  const hasPool = pool && (pool.claimed.length > 0 || pool.eligible.length > 0 || pool.ranges.length > 0);
  const poolToggleKey = `pool:${node.label}`;
  const poolExpanded = Boolean(collapsedOverrides[poolToggleKey]);

  return (
    <div className={`req-node ${statusClass}`}>
      <div className="req-node-indicator">{indicatorSymbol}</div>
      <div className="req-node-info">
        <div className="req-node-toprow">
          <span className="req-node-label" title={node.label}>{node.label}</span>
          {hasPool && (
            <button
              type="button"
              className="req-node-pool-toggle"
              onClick={() => onToggle(poolToggleKey, poolExpanded)}
            >
              {poolExpanded ? 'Hide courses' : 'Show courses'}
            </button>
          )}
        </div>
        {isUnresolved && node.note && <span className="req-node-detail">{node.note}</span>}
        {missingDetail && <span className="req-node-detail">{missingDetail}</span>}
        {showSequenceDetail && (
          <SequenceGroupDetail
            node={node}
            courseMap={courseMap}
            collapsedOverrides={collapsedOverrides}
            onToggle={onToggle}
            density={density}
          />
        )}
        {hasPool && poolExpanded && (
          <CoursePool
            claimed={pool.claimed}
            eligible={pool.eligible}
            ranges={pool.ranges}
            courseMap={courseMap}
            onAddCourse={onAddCourse}
            onBrowseRange={onBrowseRange}
            density={density}
            lockStatusMap={lockStatusMap}
          />
        )}
        <PetitionActiveDisplay
          node={node}
          override={requirementOverrides?.[node.id]}
          courseMap={courseMap}
          onRemoveOverride={onRemoveRequirementOverride}
        />
      </div>
      {isOverridden ? (
        <span className="req-node-petitioned-badge">Petitioned</span>
      ) : isUnresolved ? (
        <span className="req-node-review-badge">Needs review</span>
      ) : (
        <span className={`req-node-count ${node.status === 'satisfied' ? 'satisfied' : ''}`}>
          {node.satisfiedCount}/{node.required}
        </span>
      )}
    </div>
  );
}
