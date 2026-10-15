import { useState } from 'react';
import {
  describeRequirement,
  describeFallbackNote,
  collectPoolGroups,
  collectSubsetLabels,
  collectMatchedKeys,
  shortCourseCode,
} from './treeHelpers';
import CoursePool from './CoursePool';
import PetitionActiveDisplay from './PetitionActiveDisplay';
import SequenceGroupDetail from './SequenceGroupDetail';
import RequirementNodeMenu from './RequirementNodeMenu';
import { HubProgressRing } from '../planner/HubFullView';
import { deriveRequiredTotal } from '../../utils/requirementsEngine';

// One requirement node, in bulletin order. depth 0 (the root's direct
// children) renders as a HubFullView-style card with a progress ring;
// anything deeper renders as a hub requirement row inside its card. Every
// node collapses to one line (satisfied ones by default, keyed by node.id):
// "✓ Label — CS 132, CS 237". Every node gets a "⋯" menu for waive/
// substitute. `shared` is everything passed down unchanged to children.
export default function RequirementNodeView({ node, depth = 0, ...shared }) {
  const {
    collapsedOverrides,
    onToggle,
    planCourseKeySet,
    courseMap,
    density = 'compact',
    lockStatusMap,
    stashSet,
    onToggleStash,
    onShowCourseInfo,
    requirementOverrides,
    onRemoveRequirementOverride,
    onMarkDone,
    onCountDifferent,
    onUndo,
    flatNodes,
    onAddFromRow,
    inactiveKeys,
    onOpenFullView,
  } = shared;

  // Which ONE_OF option is on screen; null = follow node.activeChildIndex.
  const [oneOfView, setOneOfView] = useState(null);

  // A waived container has no evaluated children to recurse into, since
  // evaluation was skipped entirely for it — it renders like a leaf.
  const isContainer = node.type === 'ALL' && Array.isArray(node.children) && !node.waived;
  const isOneOf = node.type === 'ONE_OF' && Array.isArray(node.children) && !node.waived;
  const viewIndex = oneOfView ?? node.activeChildIndex ?? 0;
  const isUnresolved = node.type === 'UNRESOLVED';
  const isOverridden = Boolean(node.waived || node.substituted);
  const satisfied = node.status === 'satisfied';
  // Compact (sidebar) top-level cards start collapsed to one line; elsewhere
  // only satisfied nodes do.
  const compact = density === 'compact';
  const collapsed = collapsedOverrides[node.id] ?? (compact && depth === 0 ? true : satisfied);
  const statusClass = isOverridden
    ? 'petitioned'
    : isUnresolved ? 'needs-review' : satisfied ? 'fulfilled' : 'pending';

  let indicatorSymbol;
  if (node.waived) indicatorSymbol = '✎';
  else if (isUnresolved) indicatorSymbol = node.substituted ? (satisfied ? '✓' : '○') : '!';
  else indicatorSymbol = satisfied ? '✓' : '○';

  // Pick-one counts only what's on screen (long-unoffered options hidden).
  const headerText = describeRequirement(node, {
    inactiveKeys,
    keep: (key) => planCourseKeySet.has(key) || stashSet.has(key),
  });
  // Progress numbers: containers show courses claimed / courses required
  // across their subtree (same derivation as the program total); every
  // other node keeps its own satisfiedCount / required.
  const needCount = isContainer ? deriveRequiredTotal(node) : node.required;
  const doneCount = isContainer ? Math.min(collectMatchedKeys(node).length, needCount) : node.satisfiedCount;
  let collapsedSummary = null;
  if (collapsed && satisfied) {
    const codes = collectMatchedKeys(node).map(shortCourseCode);
    collapsedSummary = codes.length > 0 ? `— ${codes.join(', ')}` : '';
  }

  function toggle() {
    onToggle(node.id, collapsed);
  }
  function handleHeaderKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }

  const badge = isOverridden ? (
    <span className="req-node-petitioned-badge">Petitioned</span>
  ) : isUnresolved ? (
    <span className="req-node-review-badge">Check with advisor</span>
  ) : null;

  const menu = (
    <RequirementNodeMenu
      node={node}
      onMarkDone={onMarkDone}
      onCountDifferent={onCountDifferent}
      onUndo={onUndo}
    />
  );

  function renderBody() {
    const override = requirementOverrides?.[node.id];
    // Student-facing `note` on any node type, first thing in the body (so in
    // a collapsed card it only shows once expanded). UNRESOLVED keeps its own
    // note line below. `devNote` is never rendered.
    const noteLine = !isUnresolved && node.note ? <p className="req-node-note">{node.note}</p> : null;
    if (isContainer) {
      return (
        <>
          {noteLine}
          <div className="hub-full-requirements">
            {node.children.map((child) => (
              <RequirementNodeView key={child.id} node={child} depth={depth + 1} {...shared} />
            ))}
          </div>
          <PetitionActiveDisplay
            node={node}
            override={override}
            courseMap={courseMap}
            onRemoveOverride={onRemoveRequirementOverride}
          />
        </>
      );
    }

    if (isOneOf) {
      const child = node.children[viewIndex];
      return (
        <>
          {/* Switches which option is shown — never what's evaluated
              (node.activeChildIndex is the one that counts). */}
          {noteLine}
          <div className="hub-year-toggle-group req-one-of-toggle" role="group" aria-label={node.label}>
            {node.children.map((option, i) => (
              <button
                key={option.id ?? i}
                type="button"
                className={`hub-year-toggle-btn${i === viewIndex ? ' active' : ''}`}
                aria-pressed={i === viewIndex}
                onClick={() => setOneOfView(i)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {child && (
            <div className="hub-full-requirements">
              <RequirementNodeView key={child.id ?? viewIndex} node={child} depth={depth + 1} {...shared} />
            </div>
          )}
          <PetitionActiveDisplay
            node={node}
            override={override}
            courseMap={courseMap}
            onRemoveOverride={onRemoveRequirementOverride}
          />
        </>
      );
    }

    // Overridden nodes skip normal course tracking — the override supersedes it.
    const pool = isUnresolved || isOverridden ? null : collectPoolGroups(node, planCourseKeySet);
    return (
      <>
        {noteLine}
        {isUnresolved && node.note && <span className="req-node-detail">{node.note}</span>}
        {node.type === 'SEQUENCE_GROUP' && !isOverridden && (
          <SequenceGroupDetail
            node={node}
            courseMap={courseMap}
            planCourseKeySet={planCourseKeySet}
            stashSet={stashSet}
            onToggleStash={onToggleStash}
            onShowCourseInfo={onShowCourseInfo}
            onRowClick={onAddFromRow}
            inactiveKeys={inactiveKeys}
          />
        )}
        {pool && (
          <CoursePool
            pool={pool}
            subsets={node.subsets}
            subsetLabels={collectSubsetLabels(node)}
            fallbackNote={
              pool.fallback.length > 0 ? describeFallbackNote(node, pool.fallback, flatNodes) : null
            }
            courseMap={courseMap}
            density={density}
            lockStatusMap={lockStatusMap}
            planCourseKeySet={planCourseKeySet}
            stashSet={stashSet}
            onToggleStash={onToggleStash}
            onShowCourseInfo={onShowCourseInfo}
            onRowClick={onAddFromRow}
            inactiveKeys={inactiveKeys}
            onOpenFullView={onOpenFullView}
          />
        )}
        <PetitionActiveDisplay
          node={node}
          override={override}
          courseMap={courseMap}
          onRemoveOverride={onRemoveRequirementOverride}
        />
      </>
    );
  }

  if (depth === 0) {
    const showRing = !isOverridden && !isUnresolved && collapsedSummary === null && needCount > 0;
    // Compact collapsed: one line of small ring + label + "2/3"; the header
    // text and "⋯" menu show once expanded.
    const oneLine = compact && collapsed;
    const percent = needCount > 0 ? Math.min(100, Math.round((doneCount / needCount) * 100)) : 0;
    return (
      <section className={`hub-full-group req-card req-card--${statusClass}${collapsed ? '' : ' is-expanded'}${compact ? ' req-card--compact' : ''}`}>
        <div
          className="hub-full-group-header"
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={handleHeaderKeyDown}
          aria-expanded={!collapsed}
        >
          {showRing && (
            <span className={`hub-ring-wrap req-ring${satisfied ? ' is-satisfied' : ''}`}>
              <HubProgressRing
                percent={percent}
                fulfilled={doneCount}
                total={needCount}
                size={compact ? 28 : 38}
                strokeWidth={compact ? 3 : 4}
                hideLabel={compact}
              />
            </span>
          )}
          <div className="hub-full-group-heading">
            <h3 className="hub-full-group-label" title={node.label}>
              {collapsedSummary !== null ? `✓ ${node.label} ${collapsedSummary}`.trim() : node.label}
            </h3>
            {collapsedSummary === null && headerText && !compact && (
              <span className="hub-full-group-count">{headerText}</span>
            )}
          </div>
          {compact && showRing && (
            <span className={`req-card-count${satisfied ? ' satisfied' : ''}`}>
              {doneCount}/{needCount}
            </span>
          )}
          {badge}
          {!oneLine && menu}
          <span className="hub-full-group-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        </div>
        {!collapsed && (
          <div className="req-card-body">
            {/* Compact: the header text gets its own full-width line — the
                sidebar header row is too narrow for it. */}
            {compact && collapsedSummary === null && headerText && (
              <span className="hub-full-group-count req-card-subtitle">{headerText}</span>
            )}
            {renderBody()}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={`hub-full-requirement req-row ${statusClass}`}>
      <div
        className="hub-full-requirement-header req-row-header"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={handleHeaderKeyDown}
        aria-expanded={!collapsed}
      >
        <span className="hub-full-requirement-indicator" aria-hidden="true">{indicatorSymbol}</span>
        <span className="hub-full-requirement-label">{node.label}</span>
        {collapsedSummary !== null ? (
          collapsedSummary && <span className="hub-full-requirement-detail">{collapsedSummary}</span>
        ) : (
          headerText && <span className="hub-full-requirement-detail">{headerText}</span>
        )}
        {badge ?? (
          <span className={`hub-full-requirement-count${satisfied ? ' satisfied' : ''}`}>
            {doneCount}/{needCount}
          </span>
        )}
        {menu}
      </div>
      {!collapsed && <div className="req-row-body">{renderBody()}</div>}
    </div>
  );
}
