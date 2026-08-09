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

function RequirementNodeView({
  node,
  isRoot = false,
  collapsedOverrides,
  onToggle,
  planCourseKeySet,
  courseMap,
  onAddCourse,
  onBrowseRange,
}) {
  if (node.type === 'ALL' && Array.isArray(node.children)) {
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

  // UNRESOLVED nodes (petition clauses) have no fixed course list to add
  // from, so they never get a pool — description + badge only.
  const pool = isUnresolved ? null : collectPoolCourses(node, planCourseKeySet);
  const hasPool = pool && (pool.claimed.length > 0 || pool.eligible.length > 0 || pool.ranges.length > 0);
  const poolToggleKey = `pool:${node.label}`;
  const poolExpanded = Boolean(collapsedOverrides[poolToggleKey]);

  return (
    <div className={`req-node ${statusClass}`}>
      <div className="req-node-indicator">
        {isUnresolved ? '!' : node.status === 'satisfied' ? '✓' : '○'}
      </div>
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
  courseMap = {},
  activeSemIndex,
  onAddCourse,
  onEnsureCourseData,
  onBrowseRange,
}) {
  const [collapsedOverrides, setCollapsedOverrides] = useState({});
  const [pickerCourseKey, setPickerCourseKey] = useState(null);

  const programDef = useMemo(
    () => REQUIREMENT_PROGRAMS.find((p) => p.bulletinUrl === majorBulletinUrl) || null,
    [majorBulletinUrl]
  );

  const result = useMemo(
    () => (programDef ? evaluateRequirementTree(programDef, planCourseKeys) : null),
    [programDef, planCourseKeys]
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
        onPick={(i) => {
          onAddCourse(pickerCourseKey, i);
          setPickerCourseKey(null);
        }}
        onClose={() => setPickerCourseKey(null)}
      />
    </div>
  );
}
