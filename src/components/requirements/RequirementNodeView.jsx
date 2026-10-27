import { useState } from 'react';
import {
  describeRequirement,
  isTakeAllNode,
  describeFallbackNote,
  collectPoolGroups,
  collectSubsetLabels,
  collectMatchedKeys,
  countCounted,
  shortCourseCode,
  nodeProgressState,
  nodeShown,
  poolOfferCount,
} from './treeHelpers';
import CoursePool from './CoursePool';
import PetitionActiveDisplay from './PetitionActiveDisplay';
import SequenceGroupDetail from './SequenceGroupDetail';
import RequirementNodeMenu from './RequirementNodeMenu';
import MarinePoolList from './MarinePoolList';
import PickDropdown from './PickDropdown';
import { HubProgressRing } from '../planner/HubFullView';
import { deriveRequiredTotal } from '../../utils/requirementsEngine';
import { unresolvedLast } from '../../utils/unresolvedLast';
import { completedCountOf, lockStatusVariant, plannedSuffix, startsCollapsed } from '../../utils/completion';

// Per-course marks in a collapsed row's course list (split on only).
const STATUS_MARK = { completed: '✓', current: '•', planned: '◉' };

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
    // lockStatusMap when the done-vs-planned split applies, else undefined
    // (see planSplitEnabled): drives the planned rows, ring and pool cards.
    splitStatusMap,
    viewFilter = 'all',
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
    onSelectOption,
  } = shared;

  // Which ONE_OF option is on screen; null = follow node.activeChildIndex.
  const [oneOfView, setOneOfView] = useState(null);
  // "Browse options": show every alternative, even once this is satisfied.
  const [browsing, setBrowsing] = useState(false);

  // Full view's All / Still to do / Done filter (RequirementTree).
  if (!nodeShown(node, viewFilter, splitStatusMap)) return null;

  // `selection: "student"` ONE_OF (BSBA concentration): a dropdown of every
  // option, then the picked one's requirements. The pick is what's evaluated
  // (onSelectOption); the dropdown's "No concentration" row clears it.
  if (node.type === 'ONE_OF' && node.selection === 'student' && Array.isArray(node.children) && !node.waived) {
    const picked = node.activeChildIndex;
    const chosen = picked == null ? null : node.children[picked];
    return (
      <div className="req-picker">
        <PickDropdown
          label={node.label}
          options={node.children.map((option) => option.label)}
          picked={picked}
          onPick={(index) => onSelectOption?.(node.id, index)}
          placeholder="Choose your concentration"
          clearLabel="No concentration"
        />
        {chosen ? (
          <div className="hub-full-requirements">
            <RequirementNodeView key={chosen.id} node={chosen} depth={depth + 1} {...shared} />
          </div>
        ) : (
          <p className="req-node-note">Pick your concentration to see what it needs.</p>
        )}
      </div>
    );
  }

  // A waived container has no evaluated children to recurse into, since
  // evaluation was skipped entirely for it — it renders like a leaf.
  const isContainer = node.type === 'ALL' && Array.isArray(node.children) && !node.waived;
  const isOneOf = node.type === 'ONE_OF' && Array.isArray(node.children) && !node.waived;
  const viewIndex = oneOfView ?? node.activeChildIndex ?? 0;
  const isUnresolved = node.type === 'UNRESOLVED';
  const isOverridden = Boolean(node.waived || node.substituted);
  const satisfied = node.status === 'satisfied';
  // 'done' | 'planned' | 'todo' (nodeProgressState; satisfied = done with the split off).
  const progressState = nodeProgressState(node, splitStatusMap);
  // Compact (sidebar) top-level cards start collapsed to one line; elsewhere
  // only fully done nodes do (startsCollapsed, same as RequirementTree's
  // isCollapsed). A manual toggle (collapsedOverrides) always wins.
  const compact = density === 'compact';
  const collapsed = collapsedOverrides[node.id] ?? startsCollapsed(progressState, { compactTopLevel: compact && depth === 0 });
  const statusClass = isOverridden
    ? 'petitioned'
    : isUnresolved ? 'needs-review' : satisfied ? 'fulfilled' : 'pending';
  // Satisfied, but some course counting toward it is only planned/current
  // (nodeProgressState): hollow ✓ and "· planned". Petitioned and
  // needs-review nodes keep their own look.
  const planned = progressState === 'planned';
  const plannedClass = planned ? ' is-planned' : '';
  // " · planned" when every counted course is still ahead, " · 1 planned" when mixed.
  const plannedText = planned ? plannedSuffix(collectMatchedKeys(node), splitStatusMap) : '';

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
  const substitutedText = substitutedCount > 0 ? `${substitutedCount} substituted` : null;
  // Take-all nodes: "Take all N" as a pill plus a one-line legend for the boxes.
  // `slotLayout: "rows"` nodes have no boxes, so neither.
  const subtitle = node.slotLayout === 'rows' && isTakeAllNode(node)
    ? substitutedText ?? ''
    : isTakeAllNode(node) && headerText
    ? (
      <>
        <span className="req-choose-badge">{headerText}</span>
        <span className="req-takeall-legend">Boxed groups: choose 1</span>
        {substitutedText && <span className="req-takeall-legend">{substitutedText}</span>}
      </>
    )
    : [headerText, substitutedText].filter(Boolean).join(' · ');
  let collapsedSummary = null;
  if (collapsed && satisfied) {
    // With the split on, each course gets its own mark (✓ done, • in
    // progress, ○ planned) instead of a second "planned" label.
    const codes = collectMatchedKeys(node).map((key) => (splitStatusMap
      ? `${shortCourseCode(key)} ${STATUS_MARK[lockStatusVariant(splitStatusMap[key])]}`
      : shortCourseCode(key)));
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
    const normalPool = isUnresolved || isOverridden ? null : collectPoolGroups(node, planCourseKeySet);
    const isMarineCard = node.poolFrom === 'marineSemester' && !isUnresolved && !isOverridden;
    // Browse mode: the same pool with nothing hidden for being satisfied or
    // full. The toggle shows only when that reveals more to pick from.
    const browsePool = normalPool && !isMarineCard ? collectPoolGroups(node, planCourseKeySet, { browse: true }) : null;
    const canBrowse = Boolean(browsePool) && poolOfferCount(browsePool) > poolOfferCount(normalPool);
    const pool = canBrowse && browsing ? browsePool : normalPool;
    // A small text link, right-aligned on the note's line (its own short line
    // when the node has no note).
    const browseToggle = canBrowse ? (
      <button
        type="button"
        className="req-browse-toggle"
        aria-expanded={browsing}
        onClick={(e) => { e.stopPropagation(); setBrowsing((open) => !open); }}
      >
        {browsing ? 'Hide options' : 'Browse options'}
      </button>
    ) : null;
    return (
      <>
        {browseToggle ? <div className="req-body-topline">{noteLine}{browseToggle}</div> : noteLine}
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
        {isMarineCard && (
          <MarinePoolList
            courseMap={courseMap}
            planCourseKeySet={planCourseKeySet}
            stashSet={stashSet}
            onToggleStash={onToggleStash}
            onShowCourseInfo={onShowCourseInfo}
            onRowClick={onAddFromRow}
          />
        )}
        {pool && (
          <CoursePool
            pool={isMarineCard ? { ...pool, groups: [] } : pool}
            subsets={node.subsets}
            subsetLabels={collectSubsetLabels(node)}
            fallbackNote={
              pool.fallback.length > 0 ? describeFallbackNote(node, pool.fallback, flatNodes) : null
            }
            courseMap={courseMap}
            lockStatusMap={lockStatusMap}
            splitStatusMap={splitStatusMap}
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
    // Solid share = completed courses, the rest of `percent` dashed (only
    // when the split applies; see HubProgressRing's completedPercent).
    const completedPercent = splitStatusMap && needCount > 0
      ? Math.min(100, Math.round((completedCountOf(
        doneCount,
        isContainer ? countCounted(node) : node.satisfiedCount,
        collectMatchedKeys(node),
        splitStatusMap,
      ) / needCount) * 100))
      : undefined;
    return (
      <section className={`hub-full-group req-card req-card--${statusClass}${plannedClass}${collapsed ? '' : ' is-expanded'}${compact ? ' req-card--compact' : ''}`}>
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
                completedPercent={completedPercent}
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
              {doneCount}/{needCount}{plannedText}
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
      <div className={`req-section ${statusClass}${plannedClass}`}>
        <div className="req-section-header">
          <span className="req-section-label">{node.label}</span>
          {badge ?? (
            <span className={`req-section-count${satisfied ? ' satisfied' : ''}`}>
              {doneCount}/{needCount}{plannedText}
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
    <div className={`hub-full-requirement req-row ${statusClass}${plannedClass}`}>
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
            {doneCount}/{needCount}{plannedText}
          </span>
        )}
        {menu}
        <span className="hub-full-group-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && <div className="req-row-body">{renderBody()}</div>}
    </div>
  );
}
