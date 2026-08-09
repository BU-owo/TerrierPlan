import { useState, useMemo, useEffect } from 'react';
import { evaluateRequirementTree } from '../../utils/requirementsEngine';
import { normalizeCourseKey } from '../../utils/courseKey';
import MajorPicker from './MajorPicker';
import SemesterPickerModal from './SemesterPickerModal';

// Auto-discovers every program file under src/data/requirements/** so new
// majors just need a JSON file dropped in — no registry to hand-maintain.
const requirementModules = import.meta.glob('../../data/requirements/**/*.json', { eager: true });
const REQUIREMENT_PROGRAMS = Object.values(requirementModules).map((mod) => mod.default ?? mod);

function describeMissing(entry) {
  return typeof entry === 'string' ? entry : entry.label;
}

function formatCourseLabel(courseKey, courseMap) {
  return courseMap[courseKey]?.courseNumber ?? courseKey;
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

// Flattens a leaf node's matched/missing into per-course chip lists for the
// expandable pool view. `planCourseKeySet` (everything already in the plan,
// same set the engine itself claims against) is what decides "addable" —
// not `node.matched`, since a course can be enumerable-eligible for this
// node's slot while actually having been claimed by a different node. Using
// plan-membership rather than this node's own claim keeps a course that's
// already claimed elsewhere from ever showing as addable here too.
function collectPoolCourses(node, planCourseKeySet) {
  if (node.type === 'ALL' && !Array.isArray(node.children)) {
    return {
      claimed: (node.matched || []).map((key) => ({ key })),
      eligible: (node.missing || [])
        .filter((key) => !planCourseKeySet.has(key))
        .map((key) => ({ key })),
      ranges: [],
    };
  }

  if (node.type === 'COUNT' || node.type === 'REMAINDER') {
    const claimed = [];
    for (const entry of node.matched || []) {
      for (const key of entry.courseKeys || []) claimed.push({ key });
    }
    const seen = new Set();
    const eligible = [];
    // COURSE_RANGE / COURSE_RANGE_CAP entries carry `range` instead of an
    // enumerable `courseKeys` list — dedup by subject/min/max since the same
    // range can appear in both a node's pool and a sibling's additionalPool.
    const seenRanges = new Set();
    const ranges = [];
    for (const entry of node.missing || []) {
      if (entry.range) {
        const sig = `${entry.range.subject}:${entry.range.min}-${entry.range.max}`;
        if (!seenRanges.has(sig)) {
          seenRanges.add(sig);
          ranges.push({ range: entry.range, label: entry.label });
        }
        continue;
      }
      for (const key of entry.courseKeys || []) {
        if (planCourseKeySet.has(key) || seen.has(key)) continue;
        seen.add(key);
        eligible.push({ key });
      }
    }
    return { claimed, eligible, ranges };
  }

  return null;
}

// Flat list of every overridable node (everything but the root), in tree
// order, for the top-level "Report an exception" node picker. Container
// (ALL-with-children) nodes are included alongside leaves since a whole
// group can be waived, not just a single requirement.
function collectAllNodes(node, acc = [], isRoot = true) {
  if (!node) return acc;
  if (!isRoot) acc.push(node);
  if (node.type === 'ALL' && Array.isArray(node.children)) {
    node.children.forEach((child) => collectAllNodes(child, acc, false));
  }
  return acc;
}

// UNRESOLVED nodes that don't already have an override — these are the ones
// collapsed out of the inline tree and surfaced in the bottom summary row
// instead. Once overridden (substituted/waived) a node stays visible inline
// with its Petitioned badge, so it's excluded here.
function collectUnresolvedNodes(node, acc = []) {
  if (!node) return acc;
  if (node.type === 'ALL' && Array.isArray(node.children)) {
    node.children.forEach((child) => collectUnresolvedNodes(child, acc));
    return acc;
  }
  if (node.type === 'UNRESOLVED' && !node.waived && !node.substituted) {
    acc.push(node);
  }
  return acc;
}

// Walks the whole evaluated tree collecting every courseKey it references
// (claimed or eligible), so the sidebar can make sure courseMap has display
// data (courseNumber/name) for each one, including required courses the
// student hasn't added yet.
function collectAllCourseKeys(node, acc = new Set()) {
  if (!node) return acc;
  if (node.type === 'ALL' && Array.isArray(node.children)) {
    node.children.forEach((child) => collectAllCourseKeys(child, acc));
    return acc;
  }
  if (node.type === 'ALL') {
    (node.matched || []).forEach((key) => acc.add(key));
    (node.missing || []).forEach((key) => acc.add(key));
    return acc;
  }
  if (node.type === 'COUNT' || node.type === 'REMAINDER') {
    (node.matched || []).forEach((entry) => (entry.courseKeys || []).forEach((key) => acc.add(key)));
    (node.missing || []).forEach((entry) => (entry.courseKeys || []).forEach((key) => acc.add(key)));
  }
  if (node.type === 'SEQUENCE_GROUP') {
    // matched (satisfied case) plus partialMatch's have/need keys (unsatisfied
    // case) — both are what SequenceGroupDetail actually renders, so both
    // need courseMap data prefetched or they'd fall back to raw courseKeys.
    (node.matched || []).forEach((key) => acc.add(key));
    if (node.partialMatch) {
      node.partialMatch.haveKeys.forEach((key) => acc.add(key));
      node.partialMatch.needKeys.forEach((key) => acc.add(key));
    }
  }
  return acc;
}

function CourseChip({ courseKey, courseMap, interactive, onClick }) {
  const data = courseMap[courseKey];
  const display = data?.courseNumber ?? courseKey;
  const title = data?.name ? `${display} — ${data.name}` : display;

  if (!interactive) {
    return (
      <span className="req-pool-chip claimed" title={title}>
        {display}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="req-pool-chip eligible"
      title={`Add ${title}`}
      onClick={onClick}
    >
      {display}
    </button>
  );
}

function CoursePool({ claimed, eligible, ranges, courseMap, onAddCourse, onBrowseRange }) {
  if (claimed.length === 0 && eligible.length === 0 && ranges.length === 0) return null;

  return (
    <div className="req-pool">
      {(eligible.length > 0 || ranges.length > 0) && (
        <div className="req-pool-section">
          <span className="req-pool-section-label">Add:</span>
          <div className="req-pool-chips">
            {eligible.map(({ key }) => (
              <CourseChip
                key={key}
                courseKey={key}
                courseMap={courseMap}
                interactive
                onClick={() => onAddCourse(key)}
              />
            ))}
            {ranges.map(({ range, label }) => (
              <button
                key={`${range.subject}-${range.min}-${range.max}`}
                type="button"
                className="req-pool-chip eligible"
                title={`Browse ${label} in Search`}
                onClick={() => onBrowseRange(range)}
              >
                Browse eligible courses →
              </button>
            ))}
          </div>
        </div>
      )}
      {claimed.length > 0 && (
        <div className="req-pool-section">
          <span className="req-pool-section-label">Fulfilled by:</span>
          <div className="req-pool-chips">
            {claimed.map(({ key }) => (
              <CourseChip key={key} courseKey={key} courseMap={courseMap} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Read-only display of an already-applied override — the node itself always
// shows this (plus its "Petitioned" badge, see RequirementNodeView) once
// requirementOverrides has an entry for it. Creating/removing the override
// itself now only happens through the single top-level ExceptionModal below;
// this component is display-only except for "Remove", which is reporting the
// *absence* of an exception rather than a new entry point of its own.
function PetitionActiveDisplay({ node, override, courseMap, onRemoveOverride }) {
  if (!override) return null;
  const substitutedCourse = override.type === 'substitute' && override.courseKey
    ? (courseMap[override.courseKey]?.courseNumber ?? override.courseKey)
    : null;
  return (
    <div className="req-petition-active">
      <span className="req-petition-detail">
        {substitutedCourse && <>Using <strong>{substitutedCourse}</strong>. </>}
        {override.note ? `“${override.note}”` : 'No note provided.'}
      </span>
      <button
        type="button"
        className="req-petition-remove"
        onClick={() => onRemoveOverride(node.id)}
      >
        Remove
      </button>
    </div>
  );
}

// The single entry point for reporting a waive/substitute exception,
// replacing what used to be a "Mark as waived"/"Mark as petitioned" trigger
// on every node. Opened either generically (initialNodeId null — the top
// "Report an exception" button, picker step first) or pre-targeted at one
// node (from the UNRESOLVED summary list, straight to the form). UNRESOLVED
// nodes get the substitute form (pick a course already in the plan, or add a
// new one); every other node type gets the waive form (note only).
function ExceptionModal({
  open,
  initialNodeId,
  flatNodes,
  requirementOverrides,
  planCourseKeySet,
  courseMap,
  onAddCourse,
  onSetOverride,
  onRemoveOverride,
  onClose,
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(initialNodeId ?? null);
  const [note, setNote] = useState('');
  const [substituteKey, setSubstituteKey] = useState('');
  const [customKey, setCustomKey] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedNodeId(initialNodeId ?? null);
    setNote('');
    setSubstituteKey('');
    setCustomKey('');
  }, [open, initialNodeId]);

  if (!open) return null;

  const selectedNode = flatNodes.find((n) => n.id === selectedNodeId) || null;
  const override = selectedNode ? requirementOverrides?.[selectedNode.id] : null;
  const isUnresolved = selectedNode?.type === 'UNRESOLVED';
  const planCourseOptions = Array.from(planCourseKeySet).sort();

  function submit() {
    if (!selectedNode) return;
    if (isUnresolved) {
      const trimmedCustom = customKey.trim();
      if (substituteKey) {
        onSetOverride(selectedNode.id, { type: 'substitute', courseKey: substituteKey, note: note.trim() || null });
      } else if (trimmedCustom) {
        const key = normalizeCourseKey(trimmedCustom);
        onAddCourse(key);
        onSetOverride(selectedNode.id, { type: 'substitute', courseKey: key, note: note.trim() || null });
      } else {
        return;
      }
    } else {
      onSetOverride(selectedNode.id, { type: 'waive', note: note.trim() || null });
    }
    onClose();
  }

  return (
    <div className="search-picker-overlay" onClick={onClose}>
      <div className="search-picker-modal req-exception-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-picker-header">
          <h3>{selectedNode ? `Exception: ${selectedNode.label}` : 'Report an exception'}</h3>
          <button type="button" className="search-picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!selectedNode && (
          <div className="search-picker-options">
            {flatNodes.map((n) => (
              <button
                key={n.id}
                type="button"
                className="search-picker-option"
                onClick={() => setSelectedNodeId(n.id)}
              >
                {n.label}
                {requirementOverrides?.[n.id] && <span className="req-exception-existing-tag"> (reported)</span>}
              </button>
            ))}
          </div>
        )}

        {selectedNode && override && (
          <div className="req-exception-body">
            <PetitionActiveDisplay
              node={selectedNode}
              override={override}
              courseMap={courseMap}
              onRemoveOverride={(id) => { onRemoveOverride(id); onClose(); }}
            />
            <div className="req-petition-form-actions">
              <button type="button" className="req-petition-cancel" onClick={() => setSelectedNodeId(null)}>
                Choose a different requirement
              </button>
            </div>
          </div>
        )}

        {selectedNode && !override && (
          <div className="req-petition-form req-exception-form">
            {isUnresolved && (
              <>
                <label className="req-petition-field">
                  <span>Course already in your plan</span>
                  <select
                    value={substituteKey}
                    onChange={(e) => { setSubstituteKey(e.target.value); setCustomKey(''); }}
                  >
                    <option value="">— none —</option>
                    {planCourseOptions.map((key) => (
                      <option key={key} value={key}>
                        {courseMap[key]?.courseNumber ?? key}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="req-petition-field">
                  <span>Or a course code not yet in your plan</span>
                  <input
                    type="text"
                    placeholder="e.g. CAS CS 599"
                    value={customKey}
                    onChange={(e) => { setCustomKey(e.target.value); setSubstituteKey(''); }}
                  />
                </label>
              </>
            )}
            <label className="req-petition-field">
              <span>Note (optional)</span>
              <input
                type="text"
                placeholder="e.g. Approved by advisor, 3/2026"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="req-petition-form-actions">
              <button type="button" className="req-petition-save" onClick={submit}>Save</button>
              <button type="button" className="req-petition-cancel" onClick={() => setSelectedNodeId(null)}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Replaces the flat "Needs: [every option]" line for an unsatisfied
// SEQUENCE_GROUP once the student has made progress toward one specific
// option (node.partialMatch) — highlights that option instead of listing
// every alternative with equal weight. The other options are still
// reachable, just tucked behind a toggle rather than shown inline. Falls
// back to the plain flat list when partialMatch is null (nothing to
// prioritize yet).
function SequenceGroupDetail({ node, courseMap, collapsedOverrides, onToggle }) {
  if (!node.partialMatch) {
    return <span className="req-node-detail">{`Needs: ${node.missing.map(describeMissing).join(', ')}`}</span>;
  }

  const { label, haveKeys, needKeys } = node.partialMatch;
  const otherOptions = node.missing.filter((optionLabel) => optionLabel !== label);
  const toggleKey = `seq-alt:${node.label}`;
  const expanded = Boolean(collapsedOverrides[toggleKey]);

  return (
    <div className="req-node-detail req-sequence-partial">
      <span className="req-sequence-ontrack-label">On track: {label}</span> —{' '}
      <span className="req-sequence-have">have {haveKeys.map((key) => formatCourseLabel(key, courseMap)).join(', ')}</span>
      {', '}
      <span className="req-sequence-need">still need {needKeys.map((key) => formatCourseLabel(key, courseMap)).join(', ')}</span>
      {otherOptions.length > 0 && (
        <div className="req-sequence-alt-wrap">
          <button
            type="button"
            className="req-node-pool-toggle req-sequence-alt-toggle"
            onClick={() => onToggle(toggleKey, expanded)}
          >
            {expanded ? 'Hide other sequences' : 'or complete a different sequence instead ▾'}
          </button>
          {expanded && <div className="req-sequence-alt-list">{otherOptions.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

function RequirementNodeView({
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
      ? `Needs: ${node.missing.map(describeMissing).join(', ')}`
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

export default function RequirementsSidebar({
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
    <div className="req-panel">
      {/* Standalone picker — Requirements tracking must work without ever
          opening the Bulletin panel, so this sets majorBulletinUrl directly. */}
      <MajorPicker
        idPrefix="requirements-major"
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
              planCourseKeySet={planCourseKeySet}
              courseMap={courseMap}
              onAddCourse={handleAddCourse}
              onBrowseRange={onBrowseRange}
              requirementOverrides={requirementOverrides}
              onRemoveRequirementOverride={onRemoveRequirementOverride}
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
