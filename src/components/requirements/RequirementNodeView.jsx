import { useState } from 'react';
import {
  describeRequirement,
  describeFallbackNote,
  collectPoolGroups,
  collectSubsetLabels,
  collectMatchedKeys,
  countCounted,
  shortCourseCode,
} from './treeHelpers';
import CoursePool from './CoursePool';
import PetitionActiveDisplay from './PetitionActiveDisplay';
import SequenceGroupDetail from './SequenceGroupDetail';
import RequirementNodeMenu from './RequirementNodeMenu';
import { HubProgressRing } from '../planner/HubFullView';
import { deriveRequiredTotal } from '../../utils/requirementsEngine';
import { unresolvedLast } from '../../utils/unresolvedLast';
import { getSpecialTerm } from '../../data/specialTerms';

// One requirement node, in bulletin order. depth 0 (the root's direct
// children) renders as a HubFullView-style card with a progress ring.
// Deeper, a container is just a section heading (title, progress count, a thin
// divider; always open, no chevron, no border) and a leaf is a collapsible row.
// Cards and rows collapse to one line (satisfied ones by default, keyed by
// node.id): "✓ Label — CS 132, CS 237", each with one chevron at the far right.
// Leaf nodes get a "⋯" menu for petitions (substitute a course). `shared` is
// everything passed down unchanged to children.
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
    onUndo,
    onSubstitute,
    onUndoSubstitution,
    flatNodes,
    onAddFromRow,
    inactiveKeys,
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
  const doneCount = isContainer ? Math.min(countCounted(node), needCount) : node.satisfiedCount;
  // Petitions applied to this node ("2 substituted"). Goes on the subtitle
  // line (never next to the count, where it squeezed the title); the count
  // itself is a plain "3/4" — a substitution fills a slot, so the numerator
  // goes up by one and the denominator never changes.
  const substitutedCount = (node.substitutions ?? []).filter((sub) => sub.status === 'applied').length;
  // Which other requirement is already counting a plan course a petition points at.
  const countedIn = (sub) => flatNodes.find(
    (other) => other.id !== node.id && !Array.isArray(other.children) && collectMatchedKeys(other).includes(sub.courseKey)
  )?.label;
  const subtitle = [headerText, substitutedCount > 0 ? `${substitutedCount} substituted` : null].filter(Boolean).join(' · ');
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
      onUndo={onUndo}
      onSubstitute={onSubstitute}
      onUndoSubstitution={onUndoSubstitution}
      courseLabel={(sub) => (sub.courseKey ? shortCourseCode(sub.courseKey) : sub.label)}
    />
  );

  function renderBody() {
    const override = requirementOverrides?.[node.id];
    // Student-facing `note` on any node type, first thing in the body (so in
    // a collapsed card it only shows once expanded). UNRESOLVED keeps its own
    // note line below. `devNote` is never rendered.
    const noteLine = !isUnresolved && node.note ? <p className={`req-node-note${node.noteStyle === 'caption' ? ' req-node-note--caption' : ''}`}>{node.note}</p> : null;
    if (isContainer) {
      return (
        <>
          {noteLine}
          <div className="hub-full-requirements">
            {unresolvedLast(node.children).map((child) => (
              <RequirementNodeView key={child.id} node={child} depth={depth + 1} {...shared} />
            ))}
          </div>
          <PetitionActiveDisplay
            node={node}
            override={override}
            onRemoveOverride={onRemoveRequirementOverride}
            onUndoSubstitution={onUndoSubstitution}
            countedIn={countedIn}
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
            onRemoveOverride={onRemoveRequirementOverride}
            onUndoSubstitution={onUndoSubstitution}
            countedIn={countedIn}
          />
        </>
      );
    }

    // Overridden nodes skip normal course tracking — the override supersedes it.
    const pool = isUnresolved || isOverridden ? null : collectPoolGroups(node, planCourseKeySet);
    // Slots filled by a special-term block in the plan (filledByBlock): one row.
    const blockFill = (node.matched || []).find((m) => m?.filledByBlock);
    const blockTerm = blockFill ? getSpecialTerm(blockFill.filledByBlock) : null;
    return (
      <>
        {noteLine}
        {blockFill && (
          <div className="req-course-grid">
            <div className="req-course-row is-in-plan">
              <span className="req-course-row-check" aria-hidden="true">✓</span>
              <span className="req-course-row-title">
                {blockTerm
                  ? `${blockTerm.label} · ${blockTerm.credits} credits (from your plan)`
                  : 'Special term (from your plan)'}
              </span>
            </div>
          </div>
        )}
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
            lockStatusMap={lockStatusMap}
            planCourseKeySet={planCourseKeySet}
            stashSet={stashSet}
            onToggleStash={onToggleStash}
            onShowCourseInfo={onShowCourseInfo}
            onRowClick={onAddFromRow}
            inactiveKeys={inactiveKeys}
          />
        )}
        <PetitionActiveDisplay
          node={node}
          override={override}
          onRemoveOverride={onRemoveRequirementOverride}
          onUndoSubstitution={onUndoSubstitution}
          countedIn={countedIn}
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
            <h3
              className="hub-full-group-label"
              title={collapsedSummary !== null ? `✓ ${node.label} ${collapsedSummary}`.trim() : node.label}
            >
              {collapsedSummary !== null ? `✓ ${node.label} ${collapsedSummary}`.trim() : node.label}
            </h3>
            {collapsedSummary === null && subtitle && !compact && (
              <span className="hub-full-group-count">{subtitle}</span>
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
            {compact && collapsedSummary === null && subtitle && (
              <span className="hub-full-group-count req-card-subtitle">{subtitle}</span>
            )}
            {renderBody()}
          </div>
        )}
      </section>
    );
  }

  // A container nested inside a card is a plain section heading, not a
  // collapsible row: its leaves are the collapsible things.
  if (isContainer) {
    return (
      <div className={`req-section ${statusClass}`}>
        <div className="req-section-header">
          <span className="req-section-label">{node.label}</span>
          {badge ?? (
            <span className={`req-section-count${satisfied ? ' satisfied' : ''}`}>
              {doneCount}/{needCount}
            </span>
          )}
        </div>
        {node.note && <p className="req-node-note">{node.note}</p>}
        <div className="hub-full-requirements">
          {unresolvedLast(node.children).map((child) => (
            <RequirementNodeView key={child.id} node={child} depth={depth + 1} {...shared} />
          ))}
        </div>
      </div>
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
          subtitle && <span className="hub-full-requirement-detail">{subtitle}</span>
        )}
        {badge ?? (
          <span className={`hub-full-requirement-count${satisfied ? ' satisfied' : ''}`}>
            {doneCount}/{needCount}
          </span>
        )}
        {menu}
        <span className="hub-full-group-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && <div className="req-row-body">{renderBody()}</div>}
    </div>
  );
}
