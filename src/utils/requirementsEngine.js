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
    case 'ONE_OF':
      // Only one child ever counts — same "never overstate" rule as above.
      return Math.min(...node.children.map(structuralCourseCount));
    case 'REMAINDER':
    case 'UNRESOLVED':
      return 0;
    default:
      return 0;
  }
}

// `include` (COURSE_RANGE only): extra courseKeys that also match, on top of
// the subject/number range — same exclude/claimed rules.
function matchCourseRange(ctx, subject, min, max, exclude, include = []) {
  const excludeSet = new Set((exclude || []).map(normalizeCourseKey));
  const includeSet = new Set((include || []).map(normalizeCourseKey));
  const results = [];
  for (const key of ctx.planCourseKeys) {
    if (ctx.claimed.has(key) || excludeSet.has(key)) continue;
    if (includeSet.has(key)) {
      results.push(key);
      continue;
    }
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
// Also used by the UI to find which node "owns" a fallback course.
export function poolEntryCandidateKeys(entry) {
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
    return {
      subject: entry.subject,
      min: entry.min,
      max: entry.max,
      exclude: entry.exclude || [],
      include: entry.type === 'COURSE_RANGE' ? (entry.include || []).map(normalizeCourseKey) : [],
    };
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
      const candidates = matchCourseRange(ctx, entry.subject, entry.min, entry.max, entry.exclude, entry.include);
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
      // Optional `cap`: never more than that many from this list.
      const claim = candidates.slice(0, Math.min(need, entry.cap ?? Infinity));
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
// Missing entries from any pool after the first (additionalPool) are tagged
// `fallback: true` so the UI can show them as a note instead of add chips.
// Every matched/missing entry also carries `entryIndex` (its position in its
// own pool) and `entryLabel` (the pool entry's optional authored `label`,
// else null), so the UI can line results back up with the pool in order.
function claimFromPools(pools, required, ctx) {
  const matched = [];
  const missing = [];
  let satisfiedCount = 0;

  for (const [poolIndex, pool] of pools.entries()) {
    for (const [entryIndex, entry] of pool.entries()) {
      const remaining = required - satisfiedCount;
      if (remaining <= 0) break;
      const result = claimPoolEntry(entry, ctx, remaining);
      const entryLabel = typeof entry === 'string' ? null : entry.label ?? null;
      if (result.claimedKeys.length > 0) {
        // A SEQUENCE_GROUP entry's bundleClaim counts as 1 slot regardless of
        // how many real courses back it — everything else counts by however
        // many courses it actually claimed.
        satisfiedCount += result.bundleClaim ? 1 : result.claimedKeys.length;
        matched.push({
          label: describeEntry(entry),
          entryLabel,
          courseKeys: result.claimedKeys,
          entryIndex,
          fallback: poolIndex > 0,
        });
      } else {
        // courseKeys is null for non-enumerable entries (COURSE_RANGE /
        // COURSE_RANGE_CAP) — there's no fixed list to offer as "add this".
        // range carries the subject/min/max for those same entries instead,
        // so the UI can offer a "browse this range" action.
        missing.push({
          label: describeEntry(entry),
          entryLabel,
          courseKeys: result.candidateKeys,
          range: poolEntryRange(entry),
          entryIndex,
          fallback: poolIndex > 0,
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

// COUNT/REMAINDER with optional `atLeast` subsets: each subset claims up to
// its own `min` from its own pool FIRST, and those claims count toward the
// node's total. The main pools then fill only what's left after every
// subset's `min` is reserved, so a node can't be satisfied while a subset is
// still short. Subset results are reported as `subsets` (same order as
// `atLeast`); their matched entries are included in the node's `matched`,
// tagged with `subsetIndex`. `missing` is the main pools' only.
function claimWithSubsets(node, mainPools, required, ctx) {
  const subsets = (node.atLeast || []).map((subset, subsetIndex) => {
    const result = claimFromPools([subset.pool || []], subset.min, ctx);
    return {
      label: subset.label ?? null,
      min: subset.min,
      status: result.satisfiedCount >= subset.min ? 'satisfied' : 'unsatisfied',
      satisfiedCount: result.satisfiedCount,
      matched: result.matched.map((entry) => ({ ...entry, subsetIndex })),
      missing: result.missing,
    };
  });
  const reserved = subsets.reduce((sum, subset) => sum + subset.min, 0);
  const subsetCount = subsets.reduce((sum, subset) => sum + subset.satisfiedCount, 0);
  const main = claimFromPools(mainPools, Math.max(required - reserved, 0), ctx);
  return {
    matched: [...subsets.flatMap((subset) => subset.matched), ...main.matched],
    missing: main.missing,
    satisfiedCount: subsetCount + main.satisfiedCount,
    subsets,
  };
}

function evaluateCount(node, ctx) {
  const required = node.min;
  const { matched, missing, satisfiedCount, subsets } = claimWithSubsets(node, [node.pool || []], required, ctx);
  return {
    ...node,
    status: satisfiedCount >= required ? 'satisfied' : 'unsatisfied',
    matched,
    missing,
    subsets,
    satisfiedCount,
    required,
  };
}

function evaluateRemainder(node, ctx, meta = {}) {
  const required = Math.max(node.totalRequired - (meta.siblingsExpected ?? 0), 0);
  const pools = [node.pool || [], node.additionalPool || []];
  const { matched, missing, satisfiedCount, subsets } = claimWithSubsets(node, pools, required, ctx);
  return {
    ...node,
    status: satisfiedCount >= required ? 'satisfied' : 'unsatisfied',
    matched,
    missing,
    subsets,
    satisfiedCount,
    required,
  };
}

// Exactly one child must be complete (e.g. a standard track vs. an
// alternative track). Each child is evaluated against its own COPY of the
// claimed set, so trying one track never eats courses another could use;
// only the chosen child's claims are committed. Chosen = first satisfied
// child, else the best satisfiedCount/required ratio (ties: first). All
// children are returned evaluated, for display; `activeChildIndex` says
// which one counts. Counts as one slot: 1/1 or 0/1.
function evaluateOneOf(node, ctx) {
  const attempts = node.children.map((child) => {
    const childCtx = { ...ctx, claimed: new Set(ctx.claimed) };
    return { result: evaluateNode(child, childCtx), claimed: childCtx.claimed };
  });
  const ratio = ({ result }) => (result.required > 0 ? result.satisfiedCount / result.required : 0);
  let activeChildIndex = attempts.findIndex(({ result }) => result.status === 'satisfied');
  if (activeChildIndex === -1) {
    activeChildIndex = 0;
    attempts.forEach((attempt, i) => {
      if (ratio(attempt) > ratio(attempts[activeChildIndex])) activeChildIndex = i;
    });
  }
  attempts[activeChildIndex].claimed.forEach((key) => ctx.claimed.add(key));
  const satisfied = attempts[activeChildIndex].result.status === 'satisfied';
  return {
    ...node,
    children: attempts.map(({ result }) => result),
    activeChildIndex,
    status: satisfied ? 'satisfied' : 'unsatisfied',
    matched: [],
    missing: [],
    satisfiedCount: satisfied ? 1 : 0,
    required: 1,
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
        partialMatch: null,
        satisfiedCount: 1,
        required: 1,
      };
    }
  }

  // Nothing satisfied — report the "closest" option (most courses already
  // present & unclaimed) so the UI can show progress instead of a flat list
  // of every option. Ties go to the first option in array order (only a
  // strictly bigger count replaces the current best). null if the student
  // has zero courses toward ANY option — nothing to prioritize over anything
  // else. Purely additional reporting; doesn't affect status/claiming above.
  let partialMatch = null;
  for (const option of node.options) {
    const keys = option.courses.map(normalizeCourseKey);
    const haveKeys = keys.filter((key) => ctx.planCourseKeys.has(key) && !ctx.claimed.has(key));
    if (haveKeys.length === 0) continue;
    if (!partialMatch || haveKeys.length > partialMatch.haveKeys.length) {
      const haveSet = new Set(haveKeys);
      partialMatch = { label: option.label, haveKeys, needKeys: keys.filter((key) => !haveSet.has(key)) };
    }
  }

  return {
    ...node,
    status: 'unsatisfied',
    matched: [],
    missing: node.options.map((option) => option.label),
    partialMatch,
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

  // ALL / ONE_OF: no pool to substitute into — caller falls back to normal
  // evaluation (ONE_OF only supports waive).
  return null;
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
    case 'ONE_OF':
      return evaluateOneOf(node, ctx);
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
// How many courses the evaluated tree actually asks for, along the branch
// that counts: ONE_OF -> its active child; SEQUENCE_GROUP -> the matched
// option's course count (unsatisfied: the closest option's, else the
// smallest); UNRESOLVED -> 0 (unless substituted, which claims one course);
// waived nodes -> 0 (they claim nothing either); everything else ->
// `required`. Lets the progress total follow the student's track instead of
// the program's fixed totalCoursesRequired. NaN if something's off, so the
// caller can fall back.
export function deriveRequiredTotal(node) {
  if (node.waived) return 0;
  switch (node.type) {
    case 'ALL':
      return Array.isArray(node.children)
        ? node.children.reduce((sum, child) => sum + deriveRequiredTotal(child), 0)
        : node.required;
    case 'ONE_OF':
      return deriveRequiredTotal(node.children[node.activeChildIndex]);
    case 'SEQUENCE_GROUP':
      if (node.status === 'satisfied') return node.matched.length;
      if (node.partialMatch) return node.partialMatch.haveKeys.length + node.partialMatch.needKeys.length;
      return Math.min(...node.options.map((option) => option.courses.length));
    case 'UNRESOLVED':
      return node.substituted ? node.required : 0;
    default:
      return node.required;
  }
}

export function evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides = {}) {
  const planSet = new Set(
    Array.from(planCourseKeys)
      .filter(Boolean)
      .map((key) => normalizeCourseKey(key))
  );
  const ctx = { planCourseKeys: planSet, claimed: new Set(), overrides: requirementOverrides || {} };
  const tree = evaluateNode(programDef.tree, ctx);
  const derivedTotal = deriveRequiredTotal(tree);

  return {
    programName: programDef.programName,
    degree: programDef.degree,
    bulletinUrl: programDef.bulletinUrl,
    verifiedBy: programDef.verifiedBy ?? null,
    verifiedDate: programDef.verifiedDate ?? null,
    status: tree.status,
    // Derived from the tree (see deriveRequiredTotal); the authored number
    // is only the fallback.
    totalCoursesRequired: Number.isFinite(derivedTotal) && derivedTotal > 0
      ? derivedTotal
      : programDef.totalCoursesRequired,
    totalCoursesClaimed: ctx.claimed.size,
    tree,
  };
}
