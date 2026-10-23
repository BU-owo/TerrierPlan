// Run with: node --test src/utils/requirementsSweep.test.js (or npm test for all)
//
// Sweep over EVERY program JSON in src/data/requirements/ (same set
// programs.js globs, so new majors are picked up automatically). For each
// program it builds a synthetic plan that completes about half of each
// node's courses (plus a pool of courses no requirement mentions), then, for
// every node, applies one override at a time and checks the invariants a
// petition must never break:
//   - nothing throws
//   - the program total (denominator) never changes — a substitution fills a
//     slot, it doesn't lower the requirement
//   - the header numerator (courses claimed) never goes down, and never
//     exceeds the total
//   - no completed course is freed, and no course is claimed twice
// Overrides tried per node: a substitution into every unmet slot the node
// reports (one `for` per named slot, or open slots for range / list pools)
// plus one extra beyond the unmet slots (which must stay inert) — once with
// substitutes that are in the plan, once with substitutes from outside the
// plan (catalog courses not in the plan, and label-only transfer / study-
// abroad courses, which claim nothing) — and a legacy whole-node waive (the
// shape saved before petitions were reworked; nothing creates it any more but
// it must keep evaluating).
//
// ONE_OF tracks: an override on a non-counting track while another track is
// genuinely complete changes nothing (covered by the checks above). The one
// case exempted from the total / numerator / freed-course checks is the
// switch: when NO track of a ONE_OF is genuinely complete, completing a
// non-counting track (by a whole-node waive or by substitutions) makes it the
// active one, so the total follows that track's size and the previously
// counting (partial) track's claims are released. That is by design (the
// total follows the track that counts) and is reported as a diagnostic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRequirementTree, poolEntryCandidateKeys, resolveProgramPools } from './requirementsEngine.js';
import { normalizeSemesters, marineTrackerSlots } from './courseEntry.js';
import { normalizeCourseKey } from './courseKey.js';

const REQUIREMENTS_DIR = fileURLToPath(new URL('../data/requirements/', import.meta.url));

function findJson(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return findJson(full);
    return name.endsWith('.json') ? [full] : [];
  });
}

const programs = findJson(REQUIREMENTS_DIR)
  .sort()
  .map((file) => ({ file: relative(REQUIREMENTS_DIR, file), def: resolveProgramPools(JSON.parse(readFileSync(file, 'utf8'))) }));

// ── Synthetic plan ──────────────────────────────────────────────────────────

const half = (n) => Math.ceil(n / 2);

// Up to `count` distinct courseKeys that would satisfy a pool entry.
function keysForEntry(entry, count) {
  if (count <= 0) return [];
  const listed = poolEntryCandidateKeys(entry);
  if (listed) {
    // OR_EQUIVALENT / SUBSTITUTE_GROUP is one slot: its first option only.
    const oneSlot = typeof entry !== 'string' && (entry.type === 'OR_EQUIVALENT' || entry.type === 'SUBSTITUTE_GROUP');
    return oneSlot ? listed.slice(0, 1) : listed.slice(0, count);
  }
  if (entry.type === 'SEQUENCE_GROUP') return (entry.options[0]?.courses || []).map(normalizeCourseKey);
  if (entry.type === 'COURSE_RANGE' || entry.type === 'COURSE_RANGE_CAP') {
    const skip = new Set([...(entry.exclude || [])].map(normalizeCourseKey));
    const keys = [];
    for (let n = entry.min; n <= entry.max && keys.length < count; n += 1) {
      const key = `${entry.subject}${n}`;
      if (!skip.has(key)) keys.push(key);
    }
    return keys.slice(0, entry.type === 'COURSE_RANGE_CAP' ? Math.min(count, entry.cap) : count);
  }
  return [];
}

function keysForPool(pool, count) {
  const keys = [];
  for (const entry of pool || []) {
    if (keys.length >= count) break;
    keys.push(...keysForEntry(entry, count - keys.length));
  }
  return keys;
}

function planKeysForNode(node, acc) {
  switch (node.type) {
    case 'ALL':
      if (Array.isArray(node.children)) node.children.forEach((child) => planKeysForNode(child, acc));
      else acc.push(...node.courses.slice(0, half(node.courses.length)).map(normalizeCourseKey));
      break;
    case 'ONE_OF':
      if (node.children[0]) planKeysForNode(node.children[0], acc);
      break;
    case 'COUNT':
      (node.atLeast || []).forEach((subset) => acc.push(...keysForPool(subset.pool, half(subset.min))));
      acc.push(...keysForPool(node.pool, half(node.min)));
      break;
    case 'REMAINDER':
      acc.push(...keysForPool(node.pool, half(Math.max(node.totalRequired - 4, 1))));
      break;
    case 'SEQUENCE_GROUP': {
      const courses = node.options[0]?.courses || [];
      acc.push(...courses.slice(0, half(courses.length)).map(normalizeCourseKey));
      break;
    }
    default:
      break; // UNRESOLVED: nothing to complete
  }
  return acc;
}

function syntheticPlan(def) {
  return [...new Set(planKeysForNode(def.tree, []))];
}

// ── Walking results ─────────────────────────────────────────────────────────

function allNodes(node, acc = []) {
  acc.push(node);
  if (Array.isArray(node.children)) node.children.forEach((child) => allNodes(child, acc));
  return acc;
}

// Every courseKey the evaluated tree holds as claimed (a course claimed twice
// shows up twice).
function claimedList(node, acc = []) {
  if (node.waived) {
    acc.push(...(node.matched || []));
    return acc;
  }
  if (node.type === 'ONE_OF' && Array.isArray(node.children)) {
    return claimedList(node.children[node.activeChildIndex], acc);
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => claimedList(child, acc));
    return acc;
  }
  for (const entry of node.matched || []) {
    if (typeof entry === 'string') acc.push(entry);
    else acc.push(...(entry.courseKeys || []));
  }
  return acc;
}

// ── The sweep ───────────────────────────────────────────────────────────────

const created = '2026-03-01T00:00:00.000Z';

// Courses no requirement mentions. The first group is in the plan (so a
// substitution claims it); the second is not (counts without claiming).
const IN_PLAN = Array.from({ length: 16 }, (_, i) => `CASZZ${901 + i}`);
const NOT_IN_PLAN = Array.from({ length: 16 }, (_, i) => `CASZZ${801 + i}`);

// One substitution per unmet slot the node reports, plus one extra.
// `make(n)` builds the n-th substitute (without `for`).
function substitutionsFor(baseResultNode, make) {
  const slots = baseResultNode?.openSlots ?? [];
  const list = [];
  let next = 0;
  for (const slot of slots) {
    const count = slot.count ?? 1;
    for (let i = 0; i < count; i += 1) {
      list.push({ ...make(next), ...(slot.for ? { for: slot.for } : {}) });
      next += 1;
    }
  }
  list.push(make(next));
  return list;
}

function overridesFor(baseResultNode) {
  const overrides = [['legacy whole-node waive', { type: 'waive', createdAt: created }]];
  if (baseResultNode && Array.isArray(baseResultNode.openSlots) && baseResultNode.openSlots.length > 0) {
    const make = {
      'substitute every unmet slot, plan courses (+1 extra)': (n) => ({ courseKey: IN_PLAN[n] }),
      'substitute every unmet slot, outside the plan (+1 extra)': (n) => (
        n % 2 === 0 ? { courseKey: NOT_IN_PLAN[n] } : { label: `Transfer course ${n} — Somewhere` }
      ),
    };
    for (const [kind, build] of Object.entries(make)) {
      overrides.push([kind, { type: 'substitute', substitutions: substitutionsFor(baseResultNode, build), createdAt: created }]);
    }
  }
  return overrides;
}

function findResultNode(tree, id) {
  return allNodes(tree).find((n) => n.id === id);
}

// Every program runs three times: no Marine Semester term in the plan, a
// Marine term (4 placeholder slots), and a plan holding the legacy Marine
// shapes (Step 1's block and the 16-credit note, expanded on read).
// `poolFrom` nodes fill from the slots; everything else must be unaffected.
// The total never depends on a Marine term. (The programs are resolved with
// resolveProgramPools so the synthetic plan sees the data module's pool.)
const legacySemesters = normalizeSemesters([
  [{ kind: 'block', blockType: 'marine', id: 'b1', credits: 16 }],
  [],
  [{ kind: 'note', id: 'w1', text: 'Marine Semester', credits: 16, blockType: 'marine' }],
]);
const MARINE_VARIANTS = [
  { name: 'no Marine term', marineSlots: 0 },
  { name: 'Marine term', marineSlots: 4 },
  { name: 'legacy Marine shapes', marineSlots: legacySemesters.reduce((sum, entries, i) => sum + marineTrackerSlots(entries, i), 0) },
];

for (const { file, def } of programs) for (const variant of MARINE_VARIANTS) {
  test(`petition sweep: ${file} (${variant.name})`, (t) => {
    const options = { marineSlots: variant.marineSlots };
    const plan = [...syntheticPlan(def), ...IN_PLAN];
    const failures = [];
    const fail = (nodeId, kind, message) => failures.push(`${nodeId} [${kind}]: ${message}`);

    const nodes = allNodes(def.tree);
    // Non-counting tracks (and everything inside them) of ONE_OFs with no
    // genuinely complete track.
    const switchesTrack = new Set();
    const ids = nodes.map((n) => n.id);
    assert.ok(ids.every((id) => typeof id === 'string' && id), `${file}: every node needs an id`);
    assert.equal(new Set(ids).size, ids.length, `${file}: node ids must be unique`);

    const base = evaluateRequirementTree(def, plan, {}, options);
    const noBlockTotal = evaluateRequirementTree(def, plan, {}).totalCoursesRequired;
    if (base.totalCoursesRequired !== noBlockTotal) {
      fail('(no override)', 'baseline', `a Marine term changed the total ${noBlockTotal} -> ${base.totalCoursesRequired}`);
    }
    const baseClaimed = new Set(claimedList(base.tree));
    for (const oneOf of allNodes(base.tree).filter((n) => n.type === 'ONE_OF')) {
      if (oneOf.children.some((c) => c.status === 'satisfied' && !c.waived)) continue;
      oneOf.children.forEach((c, i) => {
        if (i !== oneOf.activeChildIndex) allNodes(c).forEach((inner) => switchesTrack.add(inner.id));
      });
    }
    if (base.totalCoursesClaimed > base.totalCoursesRequired) {
      fail('(no override)', 'baseline', `claimed ${base.totalCoursesClaimed} > total ${base.totalCoursesRequired}`);
    }

    for (const node of nodes) {
      for (const [kind, override] of overridesFor(findResultNode(base.tree, node.id))) {
        let result;
        try {
          result = evaluateRequirementTree(def, plan, { [node.id]: override }, options);
        } catch (err) {
          fail(node.id, kind, `threw ${err.message}`);
          continue;
        }
        const trackSwitch = switchesTrack.has(node.id);
        if (trackSwitch) t.diagnostic(`${node.id} [${kind}]: no track is complete, so completing it can make its track the active one`);
        if (!trackSwitch && result.totalCoursesClaimed < base.totalCoursesClaimed) {
          fail(node.id, kind, `numerator went down ${base.totalCoursesClaimed} -> ${result.totalCoursesClaimed}`);
        }
        if (!trackSwitch && override.type === 'substitute' && result.totalCoursesRequired !== base.totalCoursesRequired) {
          fail(node.id, kind, `total changed ${base.totalCoursesRequired} -> ${result.totalCoursesRequired}`);
        }
        if (override.type === 'waive' && result.totalCoursesRequired > base.totalCoursesRequired) {
          fail(node.id, kind, `total went up ${base.totalCoursesRequired} -> ${result.totalCoursesRequired}`);
        }
        if (result.totalCoursesClaimed > result.totalCoursesRequired) {
          fail(node.id, kind, `numerator ${result.totalCoursesClaimed} exceeds total ${result.totalCoursesRequired}`);
        }
        const afterList = claimedList(result.tree);
        const after = new Set(afterList);
        const freed = [...baseClaimed].filter((key) => !after.has(key));
        if (!trackSwitch && freed.length > 0) fail(node.id, kind, `freed completed course(s): ${freed.join(', ')}`);
        const doubled = afterList.filter((key, i) => afterList.indexOf(key) !== i);
        if (doubled.length > 0) fail(node.id, kind, `claimed twice: ${[...new Set(doubled)].join(', ')}`);
      }
    }

    assert.deepEqual(failures, [], `${file}:\n  ${failures.join('\n  ')}`);
  });
}

test('sweep found programs to check', () => {
  assert.ok(programs.length >= 5, `expected the requirements JSONs, found ${programs.length}`);
});
