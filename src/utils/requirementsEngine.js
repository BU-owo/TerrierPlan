import { normalizeCourseKey } from './courseKey.js';

function parseCourseKey(courseKey) {
  const match = /^([A-Z]+)(\d+)$/.exec(courseKey);
  if (!match) return null;
  return { subject: match[1], number: Number(match[2]) };
}

function describeEntry(entry) {
  if (typeof entry === 'string') return entry;
  if (entry.type === 'OR_EQUIVALENT') return entry.options.join(' or ');
  if (entry.type === 'SUBSTITUTE_GROUP') {
    return [entry.primary, ...(entry.substitutes || [])].join(' or ');
  }
  if (entry.type === 'COURSE_RANGE' || entry.type === 'COURSE_RANGE_CAP') {
    return `${entry.subject} ${entry.min}-${entry.max}`;
  }
  if (entry.type === 'COURSE_LIST') return entry.courses.join(', ');
  return JSON.stringify(entry);
}

// How many courses a node is structurally expected to contribute toward the
// program's total — a static property of the JSON, independent of the
// student's actual progress. Used to give a sibling REMAINDER a fixed
// denominator (e.g. "6 electives") instead of one that inflates whenever an
// earlier group isn't finished yet.
function structuralCourseCount(node) {
  switch (node.type) {
    case 'ALL':
      return Array.isArray(node.children)
        ? node.children.reduce((sum, child) => sum + structuralCourseCount(child), 0)
        : (node.courses || []).length;
    case 'COUNT':
      return node.min;
    case 'REMAINDER':
    case 'UNRESOLVED':
      return 0;
    default:
      return 0;
  }
}

function matchCourseRange(ctx, subject, min, max, exclude) {
  const excludeSet = new Set((exclude || []).map(normalizeCourseKey));
  const results = [];
  for (const key of ctx.planCourseKeys) {
    if (ctx.claimed.has(key) || excludeSet.has(key)) continue;
    const parsed = parseCourseKey(key);
    if (!parsed || parsed.subject !== subject) continue;
    if (parsed.number < min || parsed.number > max) continue;
    results.push(key);
  }
  return results.sort();
}

// The full set of courseKeys that could ever fill this entry's slot, for
// display purposes (e.g. showing "remaining eligible" chips in the UI) —
// independent of what's actually claimed or in the plan right now. Returns
// null for entry types that aren't enumerable without a full course catalog
// (COURSE_RANGE / COURSE_RANGE_CAP match anything in-subject/in-range, which
// the engine can only discover by scanning the plan, not list up front).
function poolEntryCandidateKeys(entry) {
  if (typeof entry === 'string') return [normalizeCourseKey(entry)];
  switch (entry.type) {
    case 'OR_EQUIVALENT':
      return entry.options.map(normalizeCourseKey);
    case 'SUBSTITUTE_GROUP':
      return [entry.primary, ...(entry.substitutes || [])].map(normalizeCourseKey);
    case 'COURSE_LIST':
      return (entry.courses || []).map(normalizeCourseKey);
    case 'COURSE_RANGE':
    case 'COURSE_RANGE_CAP':
      return null;
    default:
      return null;
  }
}

// Claims up to `need` courses from a single pool entry, mutating ctx.claimed.
// Single-slot refs (courseKey / OR_EQUIVALENT / SUBSTITUTE_GROUP) never claim
// more than one course regardless of `need`. Always reports `candidateKeys`
// alongside `claimedKeys` so callers can show what else would satisfy this
// slot when it isn't claimed yet.
function claimPoolEntry(entry, ctx, need) {
  const candidateKeys = poolEntryCandidateKeys(entry);
  if (need <= 0) return { claimedKeys: [], candidateKeys };

  if (typeof entry === 'string') {
    const key = normalizeCourseKey(entry);
    if (ctx.planCourseKeys.has(key) && !ctx.claimed.has(key)) {
      ctx.claimed.add(key);
      return { claimedKeys: [key], candidateKeys };
    }
    return { claimedKeys: [], candidateKeys };
  }

  switch (entry.type) {
    case 'OR_EQUIVALENT': {
      for (const option of entry.options) {
        const key = normalizeCourseKey(option);
        if (ctx.planCourseKeys.has(key) && !ctx.claimed.has(key)) {
          ctx.claimed.add(key);
          return { claimedKeys: [key], candidateKeys };
        }
      }
      return { claimedKeys: [], candidateKeys };
    }
    case 'SUBSTITUTE_GROUP': {
      const candidates = [entry.primary, ...(entry.substitutes || [])];
      for (const option of candidates) {
        const key = normalizeCourseKey(option);
        if (ctx.planCourseKeys.has(key) && !ctx.claimed.has(key)) {
          ctx.claimed.add(key);
          return { claimedKeys: [key], candidateKeys };
        }
      }
      return { claimedKeys: [], candidateKeys };
    }
    case 'COURSE_RANGE': {
      const candidates = matchCourseRange(ctx, entry.subject, entry.min, entry.max, entry.exclude);
      const claim = candidates.slice(0, need);
      claim.forEach((key) => ctx.claimed.add(key));
      return { claimedKeys: claim, candidateKeys };
    }
    case 'COURSE_RANGE_CAP': {
      const candidates = matchCourseRange(ctx, entry.subject, entry.min, entry.max, entry.exclude);
      const cappedNeed = Math.min(need, entry.cap);
      const claim = candidates.slice(0, cappedNeed);
      claim.forEach((key) => ctx.claimed.add(key));
      return { claimedKeys: claim, candidateKeys };
    }
    case 'COURSE_LIST': {
      const candidates = (entry.courses || [])
        .map(normalizeCourseKey)
        .filter((key) => ctx.planCourseKeys.has(key) && !ctx.claimed.has(key));
      const claim = candidates.slice(0, need);
      claim.forEach((key) => ctx.claimed.add(key));
      return { claimedKeys: claim, candidateKeys };
    }
    default:
      throw new Error(`Unknown pool entry type: ${entry.type}`);
  }
}

// Shared by COUNT and REMAINDER: greedily claims from `pool` (then
// `additionalPool`, if given) in order, stopping once `required` is met.
// Entries left unevaluated once the need is met stay unclaimed, so later
// siblings (e.g. a REMAINDER's additionalPool) can still use them.
function claimFromPools(pools, required, ctx) {
  const matched = [];
  const missing = [];
  let satisfiedCount = 0;

  for (const pool of pools) {
    for (const entry of pool) {
      const remaining = required - satisfiedCount;
      if (remaining <= 0) break;
      const result = claimPoolEntry(entry, ctx, remaining);
      if (result.claimedKeys.length > 0) {
        satisfiedCount += result.claimedKeys.length;
        matched.push({ label: describeEntry(entry), courseKeys: result.claimedKeys });
      } else {
        // courseKeys is null for non-enumerable entries (COURSE_RANGE /
        // COURSE_RANGE_CAP) — there's no fixed list to offer as "add this".
        missing.push({ label: describeEntry(entry), courseKeys: result.candidateKeys });
      }
    }
    if (satisfiedCount >= required) break;
  }

  return { matched, missing, satisfiedCount };
}

function evaluateAllContainer(node, ctx) {
  const original = node.children;
  // REMAINDER siblings must see what everyone else already claimed, so they
  // always evaluate last regardless of where they appear in the JSON.
  const remainderIndices = [];
  const otherIndices = [];
  original.forEach((child, i) => {
    (child.type === 'REMAINDER' ? remainderIndices : otherIndices).push(i);
  });

  const children = new Array(original.length);
  for (const i of otherIndices) {
    children[i] = evaluateNode(original[i], ctx);
  }
  // Fixed, not derived from otherIndices' actual claimed counts — see
  // structuralCourseCount's doc comment.
  const siblingsExpected = otherIndices.reduce((sum, i) => sum + structuralCourseCount(original[i]), 0);
  for (const i of remainderIndices) {
    children[i] = evaluateNode(original[i], ctx, { siblingsExpected });
  }

  const blocking = children.filter((c) => c.type !== 'UNRESOLVED');
  const satisfiedCount = blocking.filter((c) => c.status === 'satisfied').length;
  const required = blocking.length;

  return {
    ...node,
    children,
    status: satisfiedCount === required ? 'satisfied' : 'unsatisfied',
    matched: [],
    missing: [],
    satisfiedCount,
    required,
  };
}

function evaluateAllLeaf(node, ctx) {
  const matched = [];
  const missing = [];
  for (const courseKey of node.courses) {
    const key = normalizeCourseKey(courseKey);
    if (ctx.planCourseKeys.has(key) && !ctx.claimed.has(key)) {
      ctx.claimed.add(key);
      matched.push(key);
    } else {
      missing.push(key);
    }
  }
  const required = node.courses.length;
  return {
    ...node,
    status: missing.length === 0 ? 'satisfied' : 'unsatisfied',
    matched,
    missing,
    satisfiedCount: matched.length,
    required,
  };
}

function evaluateCount(node, ctx) {
  const required = node.min;
  const { matched, missing, satisfiedCount } = claimFromPools([node.pool || []], required, ctx);
  return {
    ...node,
    status: satisfiedCount >= required ? 'satisfied' : 'unsatisfied',
    matched,
    missing,
    satisfiedCount,
    required,
  };
}

function evaluateRemainder(node, ctx, meta = {}) {
  const required = Math.max(node.totalRequired - (meta.siblingsExpected ?? 0), 0);
  const pools = [node.pool || [], node.additionalPool || []];
  const { matched, missing, satisfiedCount } = claimFromPools(pools, required, ctx);
  return {
    ...node,
    status: satisfiedCount >= required ? 'satisfied' : 'unsatisfied',
    matched,
    missing,
    satisfiedCount,
    required,
  };
}

function evaluateUnresolved(node) {
  return {
    ...node,
    status: 'needs_review',
    matched: [],
    missing: [],
    satisfiedCount: 0,
    required: 0,
  };
}

function evaluateNode(node, ctx, meta) {
  switch (node.type) {
    case 'ALL':
      return Array.isArray(node.children) ? evaluateAllContainer(node, ctx) : evaluateAllLeaf(node, ctx);
    case 'COUNT':
      return evaluateCount(node, ctx);
    case 'REMAINDER':
      return evaluateRemainder(node, ctx, meta);
    case 'UNRESOLVED':
      return evaluateUnresolved(node, ctx);
    default:
      throw new Error(`Unknown requirement node type: ${node.type}`);
  }
}

// planCourseKeys should include every courseKey the student has credit for —
// semesters, extraTerms, AND externalCredits (unlike the HUB tracker, which
// excludes externalCredits). The engine doesn't care where a key came from.
export function evaluateRequirementTree(programDef, planCourseKeys) {
  const planSet = new Set(
    Array.from(planCourseKeys)
      .filter(Boolean)
      .map((key) => normalizeCourseKey(key))
  );
  const ctx = { planCourseKeys: planSet, claimed: new Set() };
  const tree = evaluateNode(programDef.tree, ctx);

  return {
    programName: programDef.programName,
    degree: programDef.degree,
    bulletinUrl: programDef.bulletinUrl,
    verifiedBy: programDef.verifiedBy ?? null,
    verifiedDate: programDef.verifiedDate ?? null,
    status: tree.status,
    totalCoursesRequired: programDef.totalCoursesRequired,
    totalCoursesClaimed: ctx.claimed.size,
    tree,
  };
}
