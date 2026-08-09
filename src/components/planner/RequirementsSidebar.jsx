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

// Student-reported "this requirement is petitioned/waived" exception — see
// requirementOverrides in SCHEMA.md. Purely informational: no verification,
// no approval state. UNRESOLVED nodes (no fixed course list) offer
// "substitute" — pick a course already in the plan, or add a new one, to
// stand in for the petition-approved slot. Every other node type offers
// "waive" — the node reads as fully satisfied without needing a course at
// all (e.g. "Group C waived, department approved a substitution off-catalog").
function PetitionControls({ node, override, planCourseKeySet, courseMap, onAddCourse, onSetOverride, onRemoveOverride }) {
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState('');
  const [substituteKey, setSubstituteKey] = useState('');
  const [customKey, setCustomKey] = useState('');

  const isUnresolved = node.type === 'UNRESOLVED';

  if (override) {
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

  if (!formOpen) {
    return (
      <button
        type="button"
        className="req-node-pool-toggle req-petition-trigger"
        onClick={(e) => { e.stopPropagation(); setFormOpen(true); }}
      >
        {isUnresolved ? 'Mark as petitioned' : 'Mark as waived'}
      </button>
    );
  }

  const planCourseOptions = Array.from(planCourseKeySet).sort();

  function submit() {
    if (isUnresolved) {
      const trimmedCustom = customKey.trim();
      if (substituteKey) {
        onSetOverride(node.id, { type: 'substitute', courseKey: substituteKey, note: note.trim() || null });
      } else if (trimmedCustom) {
        const key = normalizeCourseKey(trimmedCustom);
        onAddCourse(key);
        onSetOverride(node.id, { type: 'substitute', courseKey: key, note: note.trim() || null });
      } else {
        return;
      }
    } else {
      onSetOverride(node.id, { type: 'waive', note: note.trim() || null });
    }
    setFormOpen(false);
    setNote('');
    setSubstituteKey('');
    setCustomKey('');
  }

  return (
    <div className="req-petition-form" onClick={(e) => e.stopPropagation()}>
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
        <button type="button" className="req-petition-cancel" onClick={() => setFormOpen(false)}>Cancel</button>
      </div>
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
  onSetRequirementOverride,
  onRemoveRequirementOverride,
}) {
  // A waived container is rendered as a flat "petitioned" row instead (see
  // below) — it has no evaluated children to recurse into, since evaluation
  // was skipped entirely for it.
  if (node.type === 'ALL' && Array.isArray(node.children) && !node.waived) {
    const orderedChildren = [...node.children].sort((a, b) => statusRank(a) - statusRank(b));
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
        onSetRequirementOverride={onSetRequirementOverride}
        onRemoveRequirementOverride={onRemoveRequirementOverride}
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
        {!collapsed && (
          <>
            <div className="req-group-children">{children}</div>
            <PetitionControls
              node={node}
              override={requirementOverrides?.[node.id]}
              planCourseKeySet={planCourseKeySet}
              courseMap={courseMap}
              onAddCourse={onAddCourse}
              onSetOverride={onSetRequirementOverride}
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

  const missingDetail =
    !isUnresolved && !isOverridden && node.status !== 'satisfied' && node.missing?.length > 0
      ? `Needs: ${node.missing.map(describeMissing).join(', ')}`
      : null;

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
        <PetitionControls
          node={node}
          override={requirementOverrides?.[node.id]}
          planCourseKeySet={planCourseKeySet}
          courseMap={courseMap}
          onAddCourse={onAddCourse}
          onSetOverride={onSetRequirementOverride}
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

  const programDef = useMemo(
    () => REQUIREMENT_PROGRAMS.find((p) => p.bulletinUrl === majorBulletinUrl) || null,
    [majorBulletinUrl]
  );

  const result = useMemo(
    () => (programDef ? evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides) : null),
    [programDef, planCourseKeys, requirementOverrides]
  );

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
              planCourseKeySet={planCourseKeySet}
              courseMap={courseMap}
              onAddCourse={handleAddCourse}
              onBrowseRange={onBrowseRange}
              requirementOverrides={requirementOverrides}
              onSetRequirementOverride={onSetRequirementOverride}
              onRemoveRequirementOverride={onRemoveRequirementOverride}
            />
          </div>
        </>
      )}

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
