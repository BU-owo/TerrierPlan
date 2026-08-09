// Pure tree-walking / formatting helpers shared by RequirementNodeView,
// SequenceGroupDetail, CoursePool, and CourseChip — no JSX here so both the
// compact sidebar and the full-screen view import the exact same logic.

// `entry` is either a plain string (SEQUENCE_GROUP's flat option-label list)
// or a { label, courseKeys, range } missing-entry (COUNT/REMAINDER). In full
// density, courseKeys (already normalized, courseMap-indexable) let us swap
// the raw authored label for real "CODE — Name" text; range entries have no
// courseKeys so they always fall back to label.
export function describeMissing(entry, courseMap = {}, density = 'compact') {
  if (typeof entry === 'string') return entry;
  if (density === 'full' && Array.isArray(entry.courseKeys) && entry.courseKeys.length > 0) {
    return entry.courseKeys.map((key) => formatCourseLabel(key, courseMap, density)).join(', ');
  }
  return entry.label;
}

export function formatCourseLabel(courseKey, courseMap = {}, density = 'compact') {
  const data = courseMap[courseKey];
  const code = data?.courseNumber ?? courseKey;
  if (density === 'full' && data?.name) return `${code} — ${data.name}`;
  return code;
}

// A claimed/fulfilled course's display status, derived from the plan-wide
// lock-status lookup PlannerPage builds from semesters/gridSummerTerms/
// extraTerms. Display-only — never fed into the requirements engine, which
// only ever sees flat courseKeys. Courses the lookup doesn't know about
// (e.g. AP/transfer external credits) are treated as already-earned credit.
export function describeLockStatus(lockStatus) {
  if (!lockStatus || !lockStatus.locked) return { variant: 'planned', label: 'Planned' };
  if (lockStatus.source === 'manual') return { variant: 'completed-manual', label: 'Completed (self-marked)' };
  return { variant: 'completed', label: 'Completed' };
}

// Most requirement trees are flat enough (a handful of leaf-type groups
// directly under the root) that there's nothing to collapse — each group is
// already a single row. Sorting unsatisfied first is what actually makes the
// "what's left" items easier to spot in that shape; satisfied-group collapse
// still kicks in for deeper trees where a group has its own children.
export function statusRank(node) {
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
export function collectPoolCourses(node, planCourseKeySet) {
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
export function collectAllNodes(node, acc = [], isRoot = true) {
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
export function collectUnresolvedNodes(node, acc = []) {
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
// (claimed or eligible), so the panel can make sure courseMap has display
// data (courseNumber/name) for each one, including required courses the
// student hasn't added yet.
export function collectAllCourseKeys(node, acc = new Set()) {
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
