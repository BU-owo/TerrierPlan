import { normalizeCourseKey, parseCourseKey } from './courseKey.js';

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
  if (entry.type === 'SEQUENCE_GROUP') return entry.options.map((option) => option.label).join(' or ');
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
    case 'SEQUENCE_GROUP':
      // Every option is meant to be an equivalent bundle for the same slot;
      // use the smallest so a sibling REMAINDER's denominator is never
      // overstated regardless of which option the student ends up matching.
      return Math.min(...node.options.map((option) => option.courses.length));
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
    case 'SEQUENCE_GROUP':
      return null;
    default:
      return null;
  }
}

// Subject/min/max for COURSE_RANGE / COURSE_RANGE_CAP entries, so a missing
// entry that can't offer a fixed candidateKeys list can still tell the UI
// what range it matches against (e.g. to pre-fill a search-panel filter).
// Null for every other entry type.
function poolEntryRange(entry) {
  if (typeof entry === 'string') return null;
  if (entry.type === 'COURSE_RANGE' || entry.type === 'COURSE_RANGE_CAP') {
    return { subject: entry.subject, min: entry.min, max: entry.max, exclude: entry.exclude || [] };
  }
  return null;
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
    case 'SEQUENCE_GROUP': {
      for (const option of entry.options) {
        const keys = option.courses.map(normalizeCourseKey);
        const allPresent = keys.every((key) => ctx.planCourseKeys.has(key) && !ctx.claimed.has(key));
        if (allPresent) {
          keys.forEach((key) => ctx.claimed.add(key));
          // A bundle claims several real courses but is still only ONE slot
          // filled (e.g. BB401+BB402 together count as one BMB elective, not
          // two) — claimFromPools reads this flag instead of
          // claimedKeys.length so it doesn't over-count the pool's `need`.
          return { claimedKeys: keys, candidateKeys, bundleClaim: true };
        }
      }
      return { claimedKeys: [], candidateKeys };
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
        // A SEQUENCE_GROUP entry's bundleClaim counts as 1 slot regardless of
        // how many real courses back it — everything else counts by however
        // many courses it actually claimed.
        satisfiedCount += result.bundleClaim ? 1 : result.claimedKeys.length;
        matched.push({ label: describeEntry(entry), courseKeys: result.claimedKeys });
      } else {
        // courseKeys is null for non-enumerable entries (COURSE_RANGE /
        // COURSE_RANGE_CAP) — there's no fixed list to offer as "add this".
        // range carries the subject/min/max for those same entries instead,
        // so the UI can offer a "browse this range" action.
        missing.push({
          label: describeEntry(entry),
          courseKeys: result.candidateKeys,
          range: poolEntryRange(entry),
        });
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

// Exactly one bundle from several must be completed in full — e.g. BU's
// "General Chemistry Sequence" is CH109+CH110, OR CH111+CH112, OR
// CH101+CH102+CH201. Claims the first option whose courses are ALL present
// and unclaimed (array order = priority, same convention as claimFromPools);
// a student who happens to qualify for more than one option only has the
// first claimed, so no course gets pulled into two different options' counts.
function evaluateSequenceGroup(node, ctx) {
  for (const option of node.options) {
    const keys = option.courses.map(normalizeCourseKey);
    const allPresent = keys.every((key) => ctx.planCourseKeys.has(key) && !ctx.claimed.has(key));
    if (allPresent) {
      keys.forEach((key) => ctx.claimed.add(key));
      return {
        ...node,
        status: 'satisfied',
        matched: keys,
        missing: [],
        matchedOption: option.label,
        satisfiedCount: 1,
        required: 1,
      };
    }
  }
  return {
    ...node,
    status: 'unsatisfied',
    matched: [],
    missing: node.options.map((option) => option.label),
    satisfiedCount: 0,
    required: 1,
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

// A "waive" override skips normal evaluation entirely — no children
// evaluated, no courses claimed — and reports the node as fully satisfied.
// Deliberately doesn't try to synthesize a real satisfiedCount/required (a
// waived ALL container has no evaluated children to count), so the UI keys
// off `waived` instead of the numbers to decide how to render it.
function evaluateWaived(node, override) {
  return {
    ...node,
    status: 'satisfied',
    matched: [],
    missing: [],
    satisfiedCount: 0,
    required: 0,
    waived: true,
    overrideNote: override.note ?? null,
  };
}

// A "substitute" override adds override.courseKey to the node's pool for
// this evaluation only (never written back to the program JSON — see
// SCHEMA.md's Manual overrides section), then evaluates normally so it
// participates in claim priority exactly like any other pool entry — it can
// still lose the course to an earlier-evaluated sibling that also wants it.
// UNRESOLVED nodes have no pool of their own, so they're evaluated as a
// synthetic COUNT(min: 1) built just for this call. SEQUENCE_GROUP nodes
// have no pool either — the courseKey must already appear in one of the
// node's own options, and that option is then evaluated as if the student
// had it, so its other courses still need to be genuinely in the plan; if
// the courseKey doesn't belong to any option, this returns null so the
// caller falls back to normal (unsubstituted) evaluation. ALL nodes have no
// well-defined "add to pool" (there's no slot the substitute is *for*), so
// they fall through to normal evaluation and the override has no effect.
function evaluateSubstituted(node, ctx, meta, override) {
  const subKey = normalizeCourseKey(override.courseKey);

  if (node.type === 'UNRESOLVED') {
    const synthetic = { ...node, type: 'COUNT', min: 1, pool: [subKey] };
    const { status, matched, missing, satisfiedCount, required } = evaluateCount(synthetic, ctx);
    return {
      ...node,
      status,
      matched,
      missing,
      satisfiedCount,
      required,
      substituted: true,
      overrideNote: override.note ?? null,
    };
  }

  if (node.type === 'COUNT') {
    const patched = { ...node, pool: [subKey, ...(node.pool || [])] };
    const result = evaluateCount(patched, ctx);
    return { ...result, pool: node.pool, substituted: true, overrideNote: override.note ?? null };
  }

  if (node.type === 'REMAINDER') {
    const patched = { ...node, pool: [subKey, ...(node.pool || [])] };
    const result = evaluateRemainder(patched, ctx, meta);
    return { ...result, pool: node.pool, substituted: true, overrideNote: override.note ?? null };
  }

  if (node.type === 'SEQUENCE_GROUP') {
    const optionIndex = node.options.findIndex((option) =>
      option.courses.map(normalizeCourseKey).includes(subKey)
    );
    if (optionIndex === -1) return null; // doesn't match any option's course list — fail gracefully.
    // Treat subKey as satisfied via petition for whichever option it belongs
    // to — the option's other courses still need to be genuinely in the plan.
    const patchedCtx = { ...ctx, planCourseKeys: new Set(ctx.planCourseKeys).add(subKey) };
    const result = evaluateSequenceGroup(node, patchedCtx);
    return { ...result, substituted: true, overrideNote: override.note ?? null };
  }

  return null; // ALL: no pool to substitute into — caller falls back to normal evaluation.
}

function evaluateNode(node, ctx, meta) {
  const override = ctx.overrides?.[node.id];
  if (override?.type === 'waive') return evaluateWaived(node, override);
  if (override?.type === 'substitute' && override.courseKey) {
    const substituted = evaluateSubstituted(node, ctx, meta, override);
    if (substituted) return substituted;
  }

  switch (node.type) {
    case 'ALL':
      return Array.isArray(node.children) ? evaluateAllContainer(node, ctx) : evaluateAllLeaf(node, ctx);
    case 'COUNT':
      return evaluateCount(node, ctx);
    case 'REMAINDER':
      return evaluateRemainder(node, ctx, meta);
    case 'SEQUENCE_GROUP':
      return evaluateSequenceGroup(node, ctx);
    case 'UNRESOLVED':
      return evaluateUnresolved(node, ctx);
    default:
      throw new Error(`Unknown requirement node type: ${node.type}`);
  }
}

// planCourseKeys should include every courseKey the student has credit for —
// semesters, extraTerms, AND externalCredits (unlike the HUB tracker, which
// excludes externalCredits). The engine doesn't care where a key came from.
//
// requirementOverrides is the plan's student-reported waive/substitute map,
// keyed by requirement node id (see src/data/requirements/SCHEMA.md's Manual
// overrides section) — entirely plan-scoped, never persisted to programDef.
export function evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides = {}) {
  const planSet = new Set(
    Array.from(planCourseKeys)
      .filter(Boolean)
      .map((key) => normalizeCourseKey(key))
  );
  const ctx = { planCourseKeys: planSet, claimed: new Set(), overrides: requirementOverrides || {} };
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
