import { normalizeCourseKey, parseCourseKey, cleanSubstituteLabel } from './courseKey.js';
import { marinePool } from '../data/marineSemester.js';

function describeEntry(entry) {
  if (typeof entry === 'string') return entry;
  if (entry.type === 'OR_EQUIVALENT') return entry.options.join(' or ');
  if (entry.type === 'SUBSTITUTE_GROUP') {
    return [entry.primary, ...(entry.substitutes || [])].join(' or ');
  }
  if (entry.type === 'COURSE_RANGE' || entry.type === 'COURSE_RANGE_CAP') {
    const notSubjects = entry.excludeSubjectPrefixes?.length ? ` (not ${entry.excludeSubjectPrefixes.join('/')})` : '';
    return `${entry.subject ?? `${entry.subjectPrefix ?? ''}*`} ${entry.min}-${entry.max}${notSubjects}`;
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
  // A view node (`claims: "view"`) only re-reads its siblings' courses.
  if (node.claims === 'view') return 0;
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

// Which subjects a COURSE_RANGE / COURSE_RANGE_CAP entry (or the `range` the
// engine reports for one) covers: exactly `subject` when set; otherwise every
// subject starting with `subjectPrefix` ("CAS", or "" for any course). Either
// way, subjects starting with one of `excludeSubjectPrefixes` never match.
export function rangeMatchesSubject(range, subject) {
  if ((range.excludeSubjectPrefixes || []).some((prefix) => subject.startsWith(prefix))) return false;
  if (range.subject) return subject === range.subject;
  return typeof range.subjectPrefix === 'string' && subject.startsWith(range.subjectPrefix);
}

// `include` (COURSE_RANGE only): extra courseKeys that also match, on top of
// the subject/number range — same exclude/claimed rules.
function matchCourseRange(ctx, range, min, max, exclude, include = []) {
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
    if (!parsed || !rangeMatchesSubject(range, parsed.subject)) continue;
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
      // Prefix ranges only (see rangeMatchesSubject); absent on plain ranges.
      ...(entry.subjectPrefix !== undefined ? { subjectPrefix: entry.subjectPrefix } : {}),
      ...(entry.excludeSubjectPrefixes ? { excludeSubjectPrefixes: entry.excludeSubjectPrefixes } : {}),
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
      const candidates = matchCourseRange(ctx, entry, entry.min, entry.max, entry.exclude, entry.include);
      const claim = candidates.slice(0, need);
      claim.forEach((key) => ctx.claimed.add(key));
      return { claimedKeys: claim, candidateKeys };
    }
    case 'COURSE_RANGE_CAP': {
      const candidates = matchCourseRange(ctx, entry, entry.min, entry.max, entry.exclude);
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

// Every courseKey an evaluated node counts in the shared claimed set (a ONE_OF
// through its active child only; view nodes count nothing).
function countedKeysOf(node) {
  if (!node || node.claims === 'view') return [];
  if (node.waived) return (node.matched || []).filter((key) => typeof key === 'string');
  if (node.type === 'ONE_OF') return node.activeChildIndex == null ? [] : countedKeysOf(node.children[node.activeChildIndex]);
  if (Array.isArray(node.children)) return node.children.flatMap(countedKeysOf);
  return (node.matched || []).flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.courseKeys || []));
}

function evaluateAllContainer(node, ctx) {
  const original = node.children;
  // REMAINDER siblings must see what everyone else already claimed, so they
  // always evaluate last regardless of where they appear in the JSON. View
  // nodes (`claims: "view"`) go after them: they re-read what their `viewOf`
  // siblings counted.
  const remainderIndices = [];
  const otherIndices = [];
  const viewIndices = [];
  original.forEach((child, i) => {
    if (child.claims === 'view') viewIndices.push(i);
    else (child.type === 'REMAINDER' ? remainderIndices : otherIndices).push(i);
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
  // A view node sees every plan course except those counted by siblings
  // outside its `viewOf`, and claims into a private copy: nothing it takes
  // reaches the shared set, so the program total and numerator never move.
  for (const i of viewIndices) {
    const viewOf = new Set(original[i].viewOf || []);
    const visible = new Set(children.filter((child) => child && viewOf.has(child.id)).flatMap(countedKeysOf));
    const claimed = new Set([...ctx.claimed].filter((key) => !visible.has(key)));
    children[i] = evaluateNode(original[i], { ...ctx, claimed });
  }

  // UNRESOLVED and view nodes never hold their parent back.
  const blocking = children.filter((c) => c.type !== 'UNRESOLVED' && c.claims !== 'view');
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
  return fillFromMarineSlots(node, {
    ...node,
    status: satisfiedCount >= required ? 'satisfied' : 'unsatisfied',
    matched,
    missing,
    subsets,
    satisfiedCount,
    required,
  }, ctx);
}

const MARINE_POOL_SOURCE = 'marineSemester';

// `poolFrom: "marineSemester"` on a COUNT: its pool is the Marine Semester
// course list from src/data/marineSemester.js (twins as one OR_EQUIVALENT
// slot), resolved here so the sweep test and the UI see the same pool. An
// authored non-empty `pool` wins. Any other poolFrom value is ignored.
export function resolvePoolFrom(node) {
  if (node?.poolFrom !== MARINE_POOL_SOURCE || (node.pool || []).length > 0) return node;
  return { ...node, pool: marinePool() };
}


// The program with every `poolFrom` resolved, for code that reads the
// authored JSON directly (tests, tooling). The engine resolves per node.
export function resolveProgramPools(programDef) {
  const walk = (node) => {
    const resolved = resolvePoolFrom(node);
    return Array.isArray(resolved.children) ? { ...resolved, children: resolved.children.map(walk) } : resolved;
  };
  return { ...programDef, tree: walk(programDef.tree) };
}

// Numerator for a `poolFrom: "marineSemester"` COUNT: real pool courses in
// the plan (claimed through the pool, cross-listed twins once) plus the
// plan's Marine Semester slots (ctx.marineSlots, from
// evaluateRequirementTree's options.marineSlots: remaining placeholders and
// research-in-lieu courses in Marine terms), capped at `required`. Those
// slots are filled through synthetic claimed keys (never real courseKeys, so
// nothing else can match them). `required` (and so the program total) doesn't
// change. Runs before substitutions, which then find no open slot and stay
// inert. The fill is reported in `matched` as { marineSlots: n, courseKeys: [] }.
function fillFromMarineSlots(node, result, ctx) {
  if (node.poolFrom !== MARINE_POOL_SOURCE || !(ctx.marineSlots > 0)) return result;
  const fill = Math.min(result.required - result.satisfiedCount, ctx.marineSlots);
  if (fill <= 0) return result;
  for (let i = 0; i < fill; i += 1) ctx.claimed.add(outsideKey(node, `marine-slot-${i}`));
  const satisfiedCount = result.satisfiedCount + fill;
  return {
    ...result,
    status: satisfiedCount >= result.required ? 'satisfied' : 'unsatisfied',
    matched: [
      ...result.matched,
      { label: 'Marine Semester course', entryLabel: null, courseKeys: [], entryIndex: null, fallback: false, marineSlots: fill },
    ],
    satisfiedCount,
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
  // A child satisfied by courses the student actually holds beats everything,
  // including a whole-node waived child (which always reads satisfied) — so
  // waiving a track while another is genuinely complete changes nothing. With
  // no genuinely complete child, a waived child wins (the student excused that
  // track); otherwise the child with the most progress.
  let autoChildIndex = attempts.findIndex(({ result }) => result.status === 'satisfied' && !result.waived);
  if (autoChildIndex === -1) autoChildIndex = attempts.findIndex(({ result }) => result.waived);
  if (autoChildIndex === -1) {
    autoChildIndex = 0;
    attempts.forEach((attempt, i) => {
      if (ratio(attempt) > ratio(attempts[autoChildIndex])) autoChildIndex = i;
    });
  }
  // `options.forcedTracks` (see evaluateRequirementTree) can pin the child,
  // e.g. the track tab the student is looking at; everything after this
  // point treats it exactly like an auto-picked one.
  const forced = ctx.forcedTracks?.[node.id];
  const validForced = Number.isInteger(forced) && forced >= 0 && forced < attempts.length;
  // `selection: "student"`: only the student's pick counts; no pick = none
  // active (activeChildIndex null), nothing claimed, unsatisfied.
  if (node.selection === 'student' && !validForced) {
    return {
      ...node,
      children: attempts.map(({ result }) => result),
      activeChildIndex: null,
      autoChildIndex,
      status: 'unsatisfied',
      matched: [],
      missing: [],
      satisfiedCount: 0,
      required: 1,
    };
  }
  const activeChildIndex = validForced ? forced : autoChildIndex;
  attempts[activeChildIndex].claimed.forEach((key) => ctx.claimed.add(key));
  const satisfied = attempts[activeChildIndex].result.status === 'satisfied';
  return {
    ...node,
    children: attempts.map(({ result }) => result),
    activeChildIndex,
    // The child the engine would pick on its own (the "best match").
    autoChildIndex,
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
//
// Substitutions (see applySlotSubstitutions) replace one course of an option:
// `for` names the replaced course, no `for` fills the first unmet course.
// A substitution only applies while the real course isn't available, so
// completing the real course later makes it inert (the course is released).
// A substitute that is a plan course claims it; one that isn't in the plan
// (transfer / study abroad / label only) fills the slot and claims nothing.
// Matching is still all-or-nothing, so an unfinished option claims nothing.
function matchOption(keys, subs, ctx) {
  const avail = (key) => ctx.planCourseKeys.has(key) && !ctx.claimed.has(key);
  const usable = subs.filter((sub) => !isClaimedElsewhere(sub, ctx) && !(sub.courseKey && keys.includes(sub.courseKey)));
  const taken = new Set();
  const fill = (replaces, sub) => {
    taken.add(sub);
    const real = isPlanCourse(sub, ctx);
    return { key: real ? sub.courseKey : null, replaces, sub, outside: !real };
  };
  const slots = keys.map((key) => {
    if (avail(key)) return { key };
    const sub = usable.find((s) => s.for === key && !taken.has(s));
    return sub ? fill(key, sub) : { key, unmet: true };
  });
  for (let i = 0; i < slots.length; i += 1) {
    if (!slots[i].unmet) continue;
    const sub = usable.find((s) => !s.for && !taken.has(s));
    if (sub) slots[i] = fill(slots[i].key, sub);
  }
  return {
    slots,
    // Courses this option claims (substitutes from outside the plan claim nothing).
    keys: slots.filter((slot) => slot.key && !slot.unmet).map((slot) => slot.key),
    unmet: slots.filter((slot) => slot.unmet).map((slot) => slot.key),
    complete: slots.every((slot) => !slot.unmet),
  };
}

function evaluateSequenceGroup(node, ctx, subs = []) {
  const attempts = node.options.map((option) => matchOption(option.courses.map(normalizeCourseKey), subs, ctx));
  const wonIndex = attempts.findIndex((attempt) => attempt.complete);

  // Nothing complete — report the "closest" option (most courses already
  // present & unclaimed, substituted ones included) so the UI can show
  // progress instead of a flat list of every option. Ties go to the first
  // option in array order. null if the student has zero courses toward ANY
  // option. Purely additional reporting; doesn't affect claiming.
  let bestIndex = -1;
  if (wonIndex === -1) {
    attempts.forEach((attempt, i) => {
      const have = attempt.slots.length - attempt.unmet.length;
      const bestHave = bestIndex === -1 ? 0 : attempts[bestIndex].slots.length - attempts[bestIndex].unmet.length;
      if (have > 0 && (bestIndex === -1 || have > bestHave)) bestIndex = i;
    });
  }
  const shown = wonIndex !== -1 ? attempts[wonIndex] : attempts[bestIndex === -1 ? 0 : bestIndex];

  // Per-substitution report, computed before this node claims anything.
  const substitutions = subs.map((sub) => {
    const used = shown.slots.find((slot) => slot.sub === sub);
    if (used) return { ...subBase(sub), status: wonIndex !== -1 ? 'applied' : 'pending', replaces: used.replaces };
    if (isClaimedElsewhere(sub, ctx)) return { ...subBase(sub), status: 'already-counted' };
    return { ...subBase(sub), status: sub.for ? 'real-course-completed' : 'no-open-slot' };
  });

  if (wonIndex !== -1) {
    shown.keys.forEach((key) => ctx.claimed.add(key));
    shown.slots.forEach((slot) => {
      if (slot.outside) ctx.claimed.add(outsideKey(node, subs.indexOf(slot.sub)));
    });
    return {
      ...node,
      status: 'satisfied',
      matched: shown.keys,
      missing: [],
      matchedOption: node.options[wonIndex].label,
      partialMatch: null,
      satisfiedCount: 1,
      required: 1,
      substitutions,
      openSlots: [],
    };
  }

  const partialMatch = bestIndex === -1 ? null : {
    label: node.options[bestIndex].label,
    haveKeys: attempts[bestIndex].slots.filter((slot) => !slot.unmet).map((slot) => slot.key ?? slot.replaces),
    needKeys: attempts[bestIndex].unmet,
  };
  return {
    ...node,
    status: 'unsatisfied',
    matched: [],
    missing: node.options.map((option) => option.label),
    partialMatch,
    satisfiedCount: 0,
    required: 1,
    substitutions,
    openSlots: shown.unmet.map((key) => ({ for: key, keys: [key] })),
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

// A whole-node "waive" override reports the node as satisfied, but the
// courses the student actually has in it stay claimed and counted: the node
// is evaluated normally first (so nothing it holds is released to later
// nodes), then reported with `required` = the number of courses it holds.
// A 3/5 node therefore reads 3/3 and the program total drops only by the
// unmet 2. `matched` is the flat list of claimed keys; the evaluated
// children are not returned (the UI renders a waived node as a leaf, keyed
// off `waived`). UNRESOLVED nodes claim nothing, so they stay 0 / 0 and
// never count toward totals. A SEQUENCE_GROUP is all-or-nothing when
// evaluated normally, so its partially-held option's courses are claimed
// here too.
function evaluateWaived(node, override, claimedKeys = []) {
  return {
    ...node,
    status: 'satisfied',
    matched: claimedKeys.filter((key) => !isOutsideKey(key)),
    missing: [],
    satisfiedCount: claimedKeys.length,
    required: claimedKeys.length,
    waived: true,
    overrideNote: override.note ?? null,
  };
}

function evaluateWholeWaived(node, ctx, meta, override) {
  if (node.type === 'UNRESOLVED') return evaluateWaived(node, override);
  const before = new Set(ctx.claimed);
  if (node.type === 'SEQUENCE_GROUP') {
    const result = evaluateSequenceGroup(node, ctx);
    if (result.status !== 'satisfied') {
      (result.partialMatch?.haveKeys || []).forEach((key) => ctx.claimed.add(key));
    }
  } else {
    evaluateNodeBody(node, ctx, meta);
  }
  const claimedKeys = [...ctx.claimed].filter((key) => !before.has(key));
  return evaluateWaived(node, override, claimedKeys);
}

// ── Substitutions (petitions) ───────────────────────────────────────────────
// A petition replaces ONE required course with a different course, so it
// fills one still-unmet slot of its node: the node's `required` (and so the
// program total) never changes, the substitute is claimed by that node (+1 in
// the numerator) and can't be claimed again elsewhere. The stored override is
//   { type: 'substitute', substitutions: [{ courseKey, for? }], note?, createdAt }
// where `for` names what is replaced: the required courseKey on an ALL leaf,
// any course of a named COUNT slot, or a course in a SEQUENCE_GROUP option.
// COUNT / REMAINDER nodes with range or list pools have no named slots, so
// `for` is omitted and a substitution just fills one open slot. The legacy
// shape { type: 'substitute', courseKey } reads as one substitution with no
// `for`. Containers and ONE_OF have no courses of their own: substitutions
// live on the leaf nodes inside them (for a ONE_OF, on the track that counts).
// Each entry is { courseKey?, label?, for? } — at least one of courseKey /
// label. `courseKey` is a catalog course (in the plan or not); `label` is free
// text for a course from somewhere else (transfer, study abroad, ...).
export function normalizeSubstitutions(override) {
  if (override?.type !== 'substitute') return [];
  let list = [];
  if (Array.isArray(override.substitutions)) list = override.substitutions;
  else if (typeof override.courseKey === 'string') list = [{ courseKey: override.courseKey }];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const courseKey = typeof item.courseKey === 'string' && item.courseKey ? normalizeCourseKey(item.courseKey) : '';
    const label = cleanSubstituteLabel(item.label);
    if (!courseKey && !label) continue;
    const id = courseKey || `label:${label.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      ...(courseKey ? { courseKey } : {}),
      ...(label ? { label } : {}),
      ...(typeof item.for === 'string' && item.for ? { for: normalizeCourseKey(item.for) } : {}),
    });
  }
  return out;
}

function isSingleSlotEntry(entry) {
  return typeof entry === 'string'
    || entry.type === 'OR_EQUIVALENT'
    || entry.type === 'SUBSTITUTE_GROUP'
    || entry.type === 'SEQUENCE_GROUP';
}

// A COUNT whose every pool entry is one required slot (Economics core: min 4,
// four either/or entries) has named slots a substitution can target.
function hasNamedSlots(node) {
  return node.type === 'COUNT' && (node.pool || []).length === node.min && (node.pool || []).every(isSingleSlotEntry);
}

// A substitute from outside the plan (a catalog course not in the plan, or a
// label-only course) claims nothing, so it can't collide with other nodes; it
// is counted in the numerator through a synthetic claimed key instead (never
// a real courseKey, so nothing else can match it).
const OUTSIDE_PREFIX = 'OUTSIDE|';
function outsideKey(node, index) {
  return `${OUTSIDE_PREFIX}${node.id}|${index}`;
}
export function isOutsideKey(key) {
  return typeof key === 'string' && key.startsWith(OUTSIDE_PREFIX);
}

const isPlanCourse = (sub, ctx) => Boolean(sub.courseKey) && ctx.planCourseKeys.has(sub.courseKey);
// A plan course another node already counts: the substitution stays inert.
const isClaimedElsewhere = (sub, ctx) => isPlanCourse(sub, ctx) && ctx.claimed.has(sub.courseKey);
const subBase = (sub) => ({
  ...(sub.courseKey ? { courseKey: sub.courseKey } : {}),
  ...(sub.label ? { label: sub.label } : {}),
  ...(sub.for ? { for: sub.for } : {}),
});

// Runs after a leaf / COUNT / REMAINDER node's normal evaluation. Each
// substitution fills one open slot (the one `for` names, else the first
// open one), up to the node's unmet slots. Reports, on the evaluated node:
//   substitutions: [{ courseKey?, label?, for?, status, replaces?, entryIndex? }]
//     status 'applied', or why it's inert: 'real-course-completed' (the real
//     course is done, so the substitute is released), 'already-counted'
//     (a plan course another node counts), 'no-open-slot'
//   openSlots: what is still unmet, for the substitute picker
//     [{ for, keys, label? }] per course / named slot, or one
//     [{ for: null, keys: null, count }] for range / list pools
function applySlotSubstitutions(node, result, ctx, subs) {
  const leaf = node.type === 'ALL';
  const named = hasNamedSlots(node);
  let open = [];
  if (leaf) {
    open = result.missing.map((key) => ({ for: key, keys: [key], entryIndex: null }));
  } else if (named) {
    open = result.missing
      .filter((entry) => !entry.fallback)
      .map((entry) => ({ for: (entry.courseKeys || [])[0], keys: entry.courseKeys || [], entryIndex: entry.entryIndex, label: entry.entryLabel }));
  }

  let filled = result.satisfiedCount;
  const matched = [...result.matched];
  let missing = result.missing;
  const statuses = [];
  for (const sub of subs) {
    const base = subBase(sub);
    let reason = isClaimedElsewhere(sub, ctx) ? 'already-counted' : null;
    let slot = null;
    if (!reason) {
      if (leaf || named) {
        slot = sub.for ? open.find((candidate) => candidate.keys.includes(sub.for)) : open[0];
        if (!slot) reason = sub.for ? 'real-course-completed' : 'no-open-slot';
      } else if (filled >= result.required) {
        reason = 'no-open-slot';
      }
    }
    if (reason) {
      statuses.push({ ...base, status: reason });
      continue;
    }
    // A plan course is claimed by this node; anything else claims nothing.
    const real = isPlanCourse(sub, ctx);
    ctx.claimed.add(real ? sub.courseKey : outsideKey(node, subs.indexOf(sub)));
    filled += 1;
    if (slot) open = open.filter((candidate) => candidate !== slot);
    if (leaf) {
      if (real) matched.push(sub.courseKey);
      missing = missing.filter((missingKey) => missingKey !== slot.for);
    } else {
      matched.push({
        label: sub.courseKey ?? sub.label,
        entryLabel: null,
        courseKeys: real ? [sub.courseKey] : [],
        entryIndex: slot ? slot.entryIndex : null,
        fallback: false,
        substituted: true,
      });
      if (slot) missing = missing.filter((entry) => entry.fallback || entry.entryIndex !== slot.entryIndex);
    }
    statuses.push({
      ...base,
      status: 'applied',
      ...(slot ? { replaces: slot.for, entryIndex: slot.entryIndex } : {}),
    });
  }

  let openSlots;
  if (leaf || named) {
    openSlots = open.map((candidate) => ({ for: candidate.for, keys: candidate.keys, ...(candidate.label ? { label: candidate.label } : {}) }));
  } else {
    const unmet = result.required - filled;
    openSlots = unmet > 0 ? [{ for: null, keys: null, count: unmet }] : [];
  }

  return {
    ...result,
    status: filled >= result.required ? 'satisfied' : 'unsatisfied',
    matched,
    missing,
    satisfiedCount: filled,
    substitutions: statuses,
    openSlots,
  };
}

// Legacy: a substitute on an UNRESOLVED node (the old "Count a different
// course") is evaluated as a synthetic COUNT(min 1) of the chosen course so
// it still claims it. Nothing creates these anymore; saved ones keep working.
function evaluateUnresolvedSubstituted(node, ctx, sub, override) {
  const synthetic = { ...node, type: 'COUNT', min: 1, pool: [sub.courseKey] };
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

// A bundle slot (a SEQUENCE_GROUP pool entry, e.g. ES 110 + ES 210) is one
// slot to the claiming, status and petition logic above, but the program
// total and the header count courses. So a COUNT / REMAINDER result reports
// `required` / `satisfiedCount` in courses: a filled bundle adds its matched
// option's extra courses to both; an unfilled named slot (take-all card) adds
// its smallest option's extra courses to `required`. A pick-N card's empty
// slots stay one course each. `status` and `openSlots` are unchanged.
function inCourses(node, result) {
  let filled = 0;
  let unmet = 0;
  for (const m of result.matched) {
    if (typeof m === 'string' || m.entryIndex == null) continue;
    const pool = m.subsetIndex !== undefined ? node.atLeast?.[m.subsetIndex]?.pool : m.fallback ? node.additionalPool : node.pool;
    if (pool?.[m.entryIndex]?.type === 'SEQUENCE_GROUP') filled += Math.max(0, (m.courseKeys || []).length - 1);
  }
  if (hasNamedSlots(node)) {
    node.pool.forEach((entry, i) => {
      if (entry?.type !== 'SEQUENCE_GROUP') return;
      if (result.matched.some((m) => m.entryIndex === i && !m.fallback && m.subsetIndex === undefined)) return;
      unmet += Math.min(...entry.options.map((option) => option.courses.length)) - 1;
    });
  }
  if (filled + unmet === 0) return result;
  return { ...result, required: result.required + filled + unmet, satisfiedCount: result.satisfiedCount + filled };
}

function evaluateNode(rawNode, ctx, meta) {
  const node = resolvePoolFrom(rawNode);
  const override = ctx.overrides?.[node.id];
  if (override?.type === 'waive') return evaluateWholeWaived(node, ctx, meta, override);
  const substitutions = normalizeSubstitutions(override);
  const legacyUnresolved = node.type === 'UNRESOLVED' ? substitutions.find((sub) => sub.courseKey) : null;
  if (legacyUnresolved) return evaluateUnresolvedSubstituted(node, ctx, legacyUnresolved, override);
  return evaluateNodeBody(node, ctx, meta, substitutions);
}

function evaluateNodeBody(node, ctx, meta, substitutions = []) {
  switch (node.type) {
    case 'ALL':
      return Array.isArray(node.children)
        ? evaluateAllContainer(node, ctx)
        : applySlotSubstitutions(node, evaluateAllLeaf(node, ctx), ctx, substitutions);
    case 'COUNT':
      return inCourses(node, applySlotSubstitutions(node, evaluateCount(node, ctx), ctx, substitutions));
    case 'REMAINDER':
      return inCourses(node, applySlotSubstitutions(node, evaluateRemainder(node, ctx, meta), ctx, substitutions));
    case 'SEQUENCE_GROUP':
      return evaluateSequenceGroup(node, ctx, substitutions);
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
// waived nodes -> the courses they actually hold (`required`, set by
// evaluateWaived; 0 for UNRESOLVED); everything else ->
// `required`. Lets the progress total follow the student's track instead of
// the program's fixed totalCoursesRequired. NaN if something's off, so the
// caller can fall back.
export function deriveRequiredTotal(node) {
  if (node.waived) return node.required ?? 0;
  switch (node.type) {
    case 'ALL':
      // A view child adds nothing to its parent's total (its own total still
      // counts when it is asked directly, e.g. for its card's n/N).
      return Array.isArray(node.children)
        ? node.children.reduce((sum, child) => sum + (child.claims === 'view' ? 0 : deriveRequiredTotal(child)), 0)
        : node.required;
    case 'ONE_OF':
      // No pick yet on a `selection: "student"` ONE_OF: nothing asked.
      if (node.activeChildIndex == null) return 0;
      return deriveRequiredTotal(node.children[node.activeChildIndex]);
    case 'SEQUENCE_GROUP':
      // The matched option's size (not `matched.length`: a substitute from outside the plan fills a slot without being a matched course).
      if (node.status === 'satisfied') return node.options.find((option) => option.label === node.matchedOption)?.courses.length ?? node.matched.length;
      if (node.partialMatch) return node.partialMatch.haveKeys.length + node.partialMatch.needKeys.length;
      return Math.min(...node.options.map((option) => option.courses.length));
    case 'UNRESOLVED':
      return node.substituted ? node.required : 0;
    default:
      return node.required;
  }
}

// `options.marineSlots`: how many Marine Semester course slots the plan still
// holds (see fillFromMarineSlots); 0 or absent = none.
// `options.forcedTracks`: { [ONE_OF node id]: childIndex } — use that child
// as the ONE_OF's active child instead of the auto-pick (out-of-range values
// are ignored). Absent = today's behavior.
export function evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides = {}, options = {}) {
  const planSet = new Set(
    Array.from(planCourseKeys)
      .filter(Boolean)
      .map((key) => normalizeCourseKey(key))
  );
  const ctx = {
    planCourseKeys: planSet,
    claimed: new Set(),
    overrides: requirementOverrides || {},
    marineSlots: Number.isFinite(options?.marineSlots) ? Math.max(0, Math.floor(options.marineSlots)) : 0,
    forcedTracks: options?.forcedTracks || null,
  };
  const tree = evaluateNode(programDef.tree, ctx);
  const derivedTotal = deriveRequiredTotal(tree);
  const totalCoursesRequired = Number.isFinite(derivedTotal) && derivedTotal > 0
    ? derivedTotal
    : programDef.totalCoursesRequired;

  return {
    programName: programDef.programName,
    degree: programDef.degree,
    bulletinUrl: programDef.bulletinUrl,
    verifiedBy: programDef.verifiedBy ?? null,
    verifiedDate: programDef.verifiedDate ?? null,
    status: tree.status,
    // Derived from the tree (see deriveRequiredTotal); the authored number
    // is only the fallback.
    totalCoursesRequired,
    totalCoursesClaimed: ctx.claimed.size,
    tree,
  };
}
