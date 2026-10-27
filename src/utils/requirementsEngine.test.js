// Run with: node --test src/utils/requirementsEngine.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveRequiredTotal, evaluateRequirementTree, normalizeSubstitutions, rangeMatchesSubject, resolvePoolFrom, resolveProgramPools } from './requirementsEngine.js';
import { marinePool } from '../data/marineSemester.js';

const biology = JSON.parse(readFileSync(new URL('../data/requirements/cas/biology-ba.json', import.meta.url), 'utf8'));
const econ = JSON.parse(readFileSync(new URL('../data/requirements/cas/economics-ba.json', import.meta.url), 'utf8'));
const math = JSON.parse(readFileSync(new URL('../data/requirements/cas/mathematics-ba.json', import.meta.url), 'utf8'));
const csBa = JSON.parse(readFileSync(new URL('../data/requirements/cas/computer-science-ba.json', import.meta.url), 'utf8'));
const waive = (extra = {}) => ({ type: 'waive', note: null, createdAt: '2026-03-01T00:00:00.000Z', ...extra });
const child = (result, id) => result.tree.children.find((c) => c.id === id);

// root: [box (container: leaf L [A B C] + COUNT C1 min 2 of [D E]), X (COUNT min 1 of [A Q]), Z (leaf [Z1])]
// X comes after the box and also wants A, so a waived box releasing A would show up there.
const box = {
  id: 'box',
  type: 'ALL',
  label: 'Box',
  children: [
    { id: 'L', type: 'ALL', label: 'L', courses: ['CASXX001', 'CASXX002', 'CASXX003'] },
    { id: 'C1', type: 'COUNT', label: 'C1', min: 2, pool: ['CASXX004', 'CASXX005'] },
  ],
};
const containerProgram = {
  programName: 'T', degree: 'BA', totalCoursesRequired: 99,
  tree: {
    id: 'root', type: 'ALL', label: 'Root',
    children: [
      box,
      { id: 'X', type: 'COUNT', label: 'X', min: 1, pool: ['CASXX001', 'CASXX009'] },
      { id: 'Z', type: 'ALL', label: 'Z', courses: ['CASXX010'] },
    ],
  },
};

test('container waive with partial completion: completed stay claimed, total drops by the unmet part', () => {
  const plan = ['CASXX001', 'CASXX002', 'CASXX004', 'CASXX010'];
  const base = evaluateRequirementTree(containerProgram, plan, {});
  assert.equal(base.totalCoursesRequired, 7); // box 5 + X 1 + Z 1
  assert.equal(base.totalCoursesClaimed, 4);

  const r = evaluateRequirementTree(containerProgram, plan, { box: waive() });
  const b = child(r, 'box');
  assert.equal(b.waived, true);
  assert.equal(b.status, 'satisfied');
  assert.equal(b.required, 3);
  assert.equal(b.satisfiedCount, 3);
  assert.deepEqual([...b.matched].sort(), ['CASXX001', 'CASXX002', 'CASXX004']);
  assert.equal(r.totalCoursesRequired, 3 + 1 + 1); // box 3 + X 1 + Z 1
  assert.equal(r.totalCoursesClaimed, 4);
  // CASXX001 stays with the box, so X (evaluated after it) can't take it.
  assert.equal(child(r, 'X').satisfiedCount, 0);
});

test('nothing completed: waived node reads satisfied at 0, total drops by the whole node', () => {
  const r = evaluateRequirementTree(containerProgram, ['CASXX010'], { box: waive() });
  const b = child(r, 'box');
  assert.equal(b.status, 'satisfied');
  assert.equal(b.required, 0);
  assert.equal(b.satisfiedCount, 0);
  assert.equal(r.totalCoursesRequired, 2); // X 1 + Z 1
  assert.equal(r.totalCoursesClaimed, 1);
});

test('ONE_OF waive keeps the active track claimed', () => {
  const program = {
    programName: 'T', degree: 'BA', totalCoursesRequired: 99,
    tree: {
      id: 'root', type: 'ALL', label: 'Root',
      children: [{
        id: 'pick', type: 'ONE_OF', label: 'Pick',
        children: [
          { id: 't1', type: 'ALL', label: 'T1', courses: ['CASXX001', 'CASXX002'] },
          { id: 't2', type: 'ALL', label: 'T2', courses: ['CASXX003', 'CASXX004'] },
        ],
      }],
    },
  };
  const r = evaluateRequirementTree(program, ['CASXX001'], { pick: waive() });
  const p = child(r, 'pick');
  assert.equal(p.waived, true);
  assert.equal(p.status, 'satisfied');
  assert.equal(p.required, 1);
  assert.deepEqual(p.matched, ['CASXX001']);
  assert.equal(r.totalCoursesRequired, 1);
  assert.equal(r.totalCoursesClaimed, 1);
});

test('SEQUENCE_GROUP waive claims a partially held option; a full one counts fully', () => {
  const program = {
    programName: 'T', degree: 'BA', totalCoursesRequired: 99,
    tree: {
      id: 'root', type: 'ALL', label: 'Root',
      children: [
        {
          id: 'seq', type: 'SEQUENCE_GROUP', label: 'Seq',
          options: [
            { label: 'I', courses: ['CASXX001', 'CASXX002'] },
            { label: 'II', courses: ['CASXX003', 'CASXX004', 'CASXX005'] },
          ],
        },
        { id: 'after', type: 'COUNT', label: 'After', min: 1, pool: ['CASXX001'] },
      ],
    },
  };
  const partial = evaluateRequirementTree(program, ['CASXX001'], { seq: waive() });
  const s = child(partial, 'seq');
  assert.equal(s.status, 'satisfied');
  assert.equal(s.required, 1);
  assert.deepEqual(s.matched, ['CASXX001']);
  assert.equal(child(partial, 'after').satisfiedCount, 0); // not released

  const full = evaluateRequirementTree(program, ['CASXX001', 'CASXX002'], { seq: waive() });
  assert.equal(child(full, 'seq').required, 2);

  const none = evaluateRequirementTree(program, [], { seq: waive() });
  assert.equal(child(none, 'seq').required, 0);
  assert.equal(child(none, 'seq').status, 'satisfied');
});

test('legacy override with no extra fields (CS BA): evaluates with the new whole-node behavior', () => {
  const groupA = csBa.tree.children.find((c) => c.id === 'cs-ba-group-a');
  const have = groupA.courses.slice(0, 3);
  const base = evaluateRequirementTree(csBa, have, {});
  // Exactly the shape saved before per-slot waivers existed.
  const r = evaluateRequirementTree(csBa, have, { 'cs-ba-group-a': { type: 'waive', note: 'advisor ok', createdAt: '2026-01-01T00:00:00.000Z' } });
  const a = child(r, 'cs-ba-group-a');
  assert.equal(a.waived, true);
  assert.equal(a.overrideNote, 'advisor ok');
  assert.equal(a.status, 'satisfied');
  assert.equal(a.required, 3);
  assert.equal(a.satisfiedCount, 3);
  assert.equal(r.totalCoursesRequired, base.totalCoursesRequired - 2);
  assert.equal(r.totalCoursesClaimed, base.totalCoursesClaimed);

  // Nothing completed: reads satisfied, removes the whole node from the total.
  const empty = evaluateRequirementTree(csBa, [], { 'cs-ba-group-a': { type: 'waive', createdAt: 'x' } });
  assert.equal(child(empty, 'cs-ba-group-a').required, 0);
  assert.equal(empty.totalCoursesRequired, evaluateRequirementTree(csBa, [], {}).totalCoursesRequired - 5);
});

test('UNRESOLVED waive stays 0 / 0 and out of the total', () => {
  const base = evaluateRequirementTree(csBa, [], {});
  const r = evaluateRequirementTree(csBa, [], { 'cs-ba-group-d-petition': waive() });
  const n = child(r, 'cs-ba-group-d-petition');
  assert.equal(n.waived, true);
  assert.equal(n.required, 0);
  assert.equal(r.totalCoursesRequired, base.totalCoursesRequired);
});

// ── ONE_OF: a waived track only wins when no other track is genuinely complete ──

// [ONE_OF id, waived (alternative) track id, standard track complete, standard track partial]
const BIOLOGY_ONE_OFS = [
  ['bio-ba-chem', 'bio-ba-chem-alt-track', ['CASCH109', 'CASCH110', 'CASCH203'], ['CASCH109', 'CASCH110']],
  ['bio-ba-physics', 'bio-ba-physics-alt-track', ['CASPY105', 'CASPY106'], ['CASPY105']],
];

for (const [oneOfId, altId, complete, partial] of BIOLOGY_ONE_OFS) {
  test(`${oneOfId}: standard track complete + alt-track waive changes nothing`, () => {
    const base = evaluateRequirementTree(biology, complete, {});
    const r = evaluateRequirementTree(biology, complete, { [altId]: waive() });
    const oneOf = child(r, oneOfId);
    assert.equal(child(base, oneOfId).status, 'satisfied');
    assert.equal(oneOf.activeChildIndex, 0);
    assert.equal(oneOf.children[0].waived, undefined);
    assert.equal(oneOf.children[1].waived, true);
    assert.equal(r.totalCoursesRequired, base.totalCoursesRequired);
    assert.equal(r.totalCoursesClaimed, base.totalCoursesClaimed);
  });

  test(`${oneOfId}: standard track partial + alt-track waive makes the alt track active and satisfied`, () => {
    const base = evaluateRequirementTree(biology, partial, {});
    assert.equal(child(base, oneOfId).status, 'unsatisfied');
    assert.equal(child(base, oneOfId).activeChildIndex, 0);
    const r = evaluateRequirementTree(biology, partial, { [altId]: waive() });
    const oneOf = child(r, oneOfId);
    assert.equal(oneOf.activeChildIndex, 1);
    assert.equal(oneOf.status, 'satisfied');
    assert.equal(oneOf.children[1].waived, true);
    assert.equal(oneOf.children[1].status, 'satisfied');
  });

  test(`${oneOfId}: nothing complete + alt-track waive makes the alt track active`, () => {
    const r = evaluateRequirementTree(biology, [], { [altId]: waive() });
    const oneOf = child(r, oneOfId);
    assert.equal(oneOf.activeChildIndex, 1);
    assert.equal(oneOf.status, 'satisfied');
  });

  test(`${oneOfId}: waiving the standard track while the alt track is genuinely complete keeps the alt track`, () => {
    const standardId = child(evaluateRequirementTree(biology, [], {}), oneOfId).children[0].id;
    const altKeys = oneOfId === 'bio-ba-chem' ? ['CASCH171', 'CASCH172'] : ['CASPY104'];
    const r = evaluateRequirementTree(biology, altKeys, { [standardId]: waive() });
    const oneOf = child(r, oneOfId);
    assert.equal(oneOf.activeChildIndex, 1);
    assert.equal(oneOf.children[1].waived, undefined);
  });
}

// ── Substitutions (petitions) ───────────────────────────────────────────────
// A petition replaces ONE required course with a different course: it fills
// one unmet slot of its node, the denominator never changes, the substitute is
// claimed by that node (+1 numerator) and can't be claimed again elsewhere.

const sub = (substitutions, extra = {}) => ({ type: 'substitute', substitutions, createdAt: '2026-03-01T00:00:00.000Z', ...extra });
const groupA = csBa.tree.children.find((c) => c.id === 'cs-ba-group-a');

test('normalizeSubstitutions: courseKey and/or label, legacy single courseKey, junk', () => {
  assert.deepEqual(normalizeSubstitutions(sub([
    { courseKey: 'cas ma 123', for: 'casCS111' },
    { courseKey: 'CASMA123' }, // duplicate
    { label: '  ECON 1115 —  Northeastern \n', for: 'CASCS112' },
    { label: 'econ 1115 — northeastern' }, // duplicate label (case-insensitive)
    { courseKey: 'CASCS330', label: 'Study abroad' },
    { courseKey: '' },
    { label: '   ' },
    { label: 'x'.repeat(200) },
    null,
  ])), [
    { courseKey: 'CASMA123', for: 'CASCS111' },
    { label: 'ECON 1115 — Northeastern', for: 'CASCS112' },
    { courseKey: 'CASCS330', label: 'Study abroad' },
    { label: 'x'.repeat(80) },
  ]);
  assert.deepEqual(normalizeSubstitutions({ type: 'substitute', courseKey: 'CASMA123', note: null, createdAt: 'x' }), [{ courseKey: 'CASMA123' }]);
  assert.deepEqual(normalizeSubstitutions({ type: 'waive', createdAt: 'x' }), []);
  assert.deepEqual(normalizeSubstitutions(undefined), []);
});

test('ALL leaf: substitute fills the named course; numerator +1, denominator unchanged, claimed once', () => {
  const have = groupA.courses.slice(0, 3); // 3 of 5
  const plan = [...have, 'CASXX900'];
  const base = evaluateRequirementTree(csBa, plan, {});
  const r = evaluateRequirementTree(csBa, plan, { 'cs-ba-group-a': sub([{ courseKey: 'CASXX900', for: groupA.courses[4] }]) });
  const a = child(r, 'cs-ba-group-a');
  assert.equal(a.required, 5);
  assert.equal(a.satisfiedCount, 4);
  assert.deepEqual(a.substitutions, [{ courseKey: 'CASXX900', for: groupA.courses[4], status: 'applied', replaces: groupA.courses[4], entryIndex: null }]);
  assert.ok(!a.missing.includes(groupA.courses[4]));
  assert.ok(a.missing.includes(groupA.courses[3])); // the other unmet course stays open
  assert.equal(a.openSlots.length, 1);
  assert.equal(r.totalCoursesRequired, base.totalCoursesRequired);
  assert.equal(r.totalCoursesClaimed, base.totalCoursesClaimed + 1);
});

test('ALL leaf: substitution is inert once the real course is completed, and its course is released', () => {
  const plan = [...groupA.courses, 'CASXX900']; // all five real courses + the substitute
  const r = evaluateRequirementTree(csBa, plan, { 'cs-ba-group-a': sub([{ courseKey: 'CASXX900', for: groupA.courses[4] }]) });
  const a = child(r, 'cs-ba-group-a');
  assert.equal(a.satisfiedCount, 5);
  assert.equal(a.substitutions[0].status, 'real-course-completed');
  assert.ok(!a.matched.includes('CASXX900'));
  assert.equal(r.totalCoursesClaimed, 5);
});

test('ALL leaf: substitution with no `for` fills the first unmet course; extras beyond the unmet slots are inert', () => {
  const plan = [...groupA.courses.slice(0, 4), 'CASXX900', 'CASXX901'];
  const r = evaluateRequirementTree(csBa, plan, { 'cs-ba-group-a': sub([{ courseKey: 'CASXX900' }, { courseKey: 'CASXX901' }]) });
  const a = child(r, 'cs-ba-group-a');
  assert.equal(a.satisfiedCount, 5);
  assert.deepEqual(a.substitutions.map((x) => x.status), ['applied', 'no-open-slot']);
  assert.equal(r.totalCoursesClaimed, 5);
});

test('COUNT with named either/or slots (Economics core): only the named slot fills', () => {
  const plan = ['CASEC322'];
  const base = evaluateRequirementTree(econ, plan, {});
  const r = evaluateRequirementTree(econ, plan, { 'econ-ba-core': sub([{ courseKey: 'CASEC322', for: 'CASEC201' }]) });
  const core = child(r, 'econ-ba-core');
  assert.equal(core.required, 4);
  assert.equal(core.satisfiedCount, 1);
  assert.equal(core.status, 'unsatisfied');
  const filled = core.matched.find((m) => m.substituted);
  assert.equal(filled.entryIndex, 0); // the EC 201 / EC 221 slot
  assert.deepEqual(core.openSlots.map((slot) => slot.for), ['CASEC202', 'CASEC203', 'CASEC204']);
  assert.equal(r.totalCoursesRequired, base.totalCoursesRequired);
  // EC 322 is now the core's, so the electives (evaluated later) can't also claim it.
  assert.equal(child(r, 'econ-ba-electives').satisfiedCount, 0);
  assert.equal(child(base, 'econ-ba-electives').satisfiedCount, 1);
});

test('COUNT with named slots: a `for` that names a slot already filled by the real course is inert', () => {
  const r = evaluateRequirementTree(econ, ['CASEC201', 'CASEC322'], { 'econ-ba-core': sub([{ courseKey: 'CASEC322', for: 'CASEC221' }]) });
  const core = child(r, 'econ-ba-core');
  assert.equal(core.substitutions[0].status, 'real-course-completed');
  assert.equal(core.satisfiedCount, 1);
  assert.equal(child(r, 'econ-ba-electives').satisfiedCount, 1); // EC 322 released to the electives
});

test('COUNT with a range pool (electives): substitutions fill open slots, capped at the unmet ones', () => {
  const outside = ['CASEC303', 'CASEC304', 'CASEC305', 'CASEC306', 'CASEC307', 'CASEC308'];
  const base = evaluateRequirementTree(econ, outside, {});
  const r = evaluateRequirementTree(econ, outside, { 'econ-ba-electives': sub(outside.map((courseKey) => ({ courseKey }))) });
  const e = child(r, 'econ-ba-electives');
  assert.equal(e.required, 5);
  assert.equal(e.satisfiedCount, 5);
  assert.equal(e.status, 'satisfied');
  assert.deepEqual(e.substitutions.map((x) => x.status), ['applied', 'applied', 'applied', 'applied', 'applied', 'no-open-slot']);
  assert.deepEqual(e.openSlots, []);
  assert.equal(r.totalCoursesRequired, base.totalCoursesRequired);
  assert.equal(r.totalCoursesClaimed, 5);
});

test('a substitute that is not in the plan still counts +1 and claims nothing; a plan course counted elsewhere stays inert', () => {
  // Catalog course not in the plan.
  const base = evaluateRequirementTree(econ, [], {});
  const outside = evaluateRequirementTree(econ, [], { 'econ-ba-core': sub([{ courseKey: 'CASEC322', for: 'CASEC201' }]) });
  const core = child(outside, 'econ-ba-core');
  assert.equal(core.substitutions[0].status, 'applied');
  assert.equal(core.satisfiedCount, 1);
  assert.equal(core.required, 4);
  assert.equal(outside.totalCoursesClaimed, 1); // counted in the numerator...
  assert.deepEqual(core.matched.flatMap((m) => m.courseKeys), []); // ...but claims no real course
  assert.equal(outside.totalCoursesRequired, base.totalCoursesRequired);
  // Plan course already counted by another node (the prerequisites are evaluated first).
  const taken = evaluateRequirementTree(econ, ['CASEC101'], { 'econ-ba-core': sub([{ courseKey: 'CASEC101', for: 'CASEC201' }]) });
  assert.equal(child(taken, 'econ-ba-core').substitutions[0].status, 'already-counted');
  assert.equal(child(taken, 'econ-ba-core').satisfiedCount, 0);
  assert.equal(taken.totalCoursesClaimed, 1);
});

test('label-only substitution (a transfer / study-abroad course): fills one slot on every node type, claims nothing', () => {
  const label = 'ECON 1115 — Northeastern';
  // ALL leaf
  const plan = groupA.courses.slice(0, 3);
  const leaf = evaluateRequirementTree(csBa, plan, { 'cs-ba-group-a': sub([{ label, for: groupA.courses[4] }]) });
  const a = child(leaf, 'cs-ba-group-a');
  assert.equal(a.satisfiedCount, 4);
  assert.equal(a.required, 5);
  assert.equal(a.substitutions[0].status, 'applied');
  assert.ok(!a.missing.includes(groupA.courses[4]));
  assert.equal(leaf.totalCoursesClaimed, 4);
  assert.equal(leaf.totalCoursesRequired, evaluateRequirementTree(csBa, plan, {}).totalCoursesRequired);
  // COUNT with named slots (Economics core): only that slot fills, total stays 11.
  const named = evaluateRequirementTree(econ, [], { 'econ-ba-core': sub([{ label, for: 'CASEC201' }]) });
  const core = child(named, 'econ-ba-core');
  assert.equal(core.satisfiedCount, 1);
  assert.deepEqual(core.openSlots.map((slot) => slot.for), ['CASEC202', 'CASEC203', 'CASEC204']);
  assert.equal(named.totalCoursesRequired, 11);
  assert.equal(named.totalCoursesClaimed, 1);
  // COUNT with a range pool (electives): capped at the 5 unmet slots.
  const range = evaluateRequirementTree(econ, [], { 'econ-ba-electives': sub(Array.from({ length: 6 }, (_, i) => ({ label: `Course ${i}` }))) });
  const e = child(range, 'econ-ba-electives');
  assert.deepEqual(e.substitutions.map((x) => x.status), ['applied', 'applied', 'applied', 'applied', 'applied', 'no-open-slot']);
  assert.equal(e.status, 'satisfied');
  assert.equal(range.totalCoursesClaimed, 5);
  // REMAINDER
  const rem = evaluateRequirementTree(csBa, [], { 'cs-ba-group-d': sub([{ label }]) });
  assert.equal(child(rem, 'cs-ba-group-d').satisfiedCount, 1);
  assert.equal(rem.totalCoursesRequired, evaluateRequirementTree(csBa, [], {}).totalCoursesRequired);
  // SEQUENCE_GROUP: satisfied when the rest of the option is there, pending otherwise (nothing claimed).
  const seqNode = 'bio-ba-physics-standard';
  const done = evaluateRequirementTree(biology, ['CASPY105'], { [seqNode]: sub([{ label, for: 'CASPY106' }]) });
  const s1 = child(done, 'bio-ba-physics').children[0];
  assert.equal(s1.status, 'satisfied');
  assert.equal(s1.substitutions[0].status, 'applied');
  assert.deepEqual(s1.matched, ['CASPY105']);
  assert.equal(done.totalCoursesClaimed, evaluateRequirementTree(biology, ['CASPY105'], {}).totalCoursesClaimed + 2); // PY 105 + the outside course (+ nothing else)
  const pending = evaluateRequirementTree(biology, [], { [seqNode]: sub([{ label, for: 'CASPY106' }]) });
  const s2 = child(pending, 'bio-ba-physics').children[0];
  assert.equal(s2.status, 'unsatisfied');
  assert.equal(s2.substitutions[0].status, 'pending');
  assert.equal(pending.totalCoursesClaimed, 0);
});

test('a label-only or outside substitution goes inert when the real course is completed', () => {
  const r = evaluateRequirementTree(econ, ['CASEC201'], { 'econ-ba-core': sub([{ label: 'ECON 1115 — Northeastern', for: 'CASEC201' }]) });
  const core = child(r, 'econ-ba-core');
  assert.equal(core.substitutions[0].status, 'real-course-completed');
  assert.equal(core.satisfiedCount, 1); // just the real EC 201
  assert.equal(r.totalCoursesClaimed, 1);
  const outsideKey = evaluateRequirementTree(econ, ['CASEC201'], { 'econ-ba-core': sub([{ courseKey: 'CASEC322', for: 'CASEC201' }]) });
  assert.equal(child(outsideKey, 'econ-ba-core').substitutions[0].status, 'real-course-completed');
  assert.equal(outsideKey.totalCoursesClaimed, 1);
});

test('REMAINDER: a substitution fills one open slot; the denominator is unchanged', () => {
  const plan = ['CASMA225'];
  const base = evaluateRequirementTree(csBa, plan, {});
  const r = evaluateRequirementTree(csBa, plan, { 'cs-ba-group-d': sub([{ courseKey: 'CASMA225' }]) });
  const d = child(r, 'cs-ba-group-d');
  assert.equal(d.satisfiedCount, 1);
  assert.equal(d.required, child(base, 'cs-ba-group-d').required);
  assert.equal(d.substitutions[0].status, 'applied');
  assert.equal(d.openSlots[0].count, d.required - 1);
  assert.equal(r.totalCoursesRequired, base.totalCoursesRequired);
});

test('SEQUENCE_GROUP: a substitute replaces one course of the option; inert once the real course is taken', () => {
  const seqNode = 'bio-ba-physics-standard';
  const full = evaluateRequirementTree(biology, ['CASPY105', 'CASXX900'], { [seqNode]: sub([{ courseKey: 'CASXX900', for: 'CASPY106' }]) });
  const seq = child(full, 'bio-ba-physics').children[0];
  assert.equal(seq.status, 'satisfied');
  assert.equal(seq.matchedOption, 'PY 105 + PY 106');
  assert.deepEqual(seq.matched, ['CASPY105', 'CASXX900']);
  assert.equal(seq.substitutions[0].status, 'applied');
  assert.equal(child(full, 'bio-ba-physics').status, 'satisfied');
  assert.equal(full.totalCoursesClaimed, evaluateRequirementTree(biology, ['CASPY105', 'CASXX900'], {}).totalCoursesClaimed + 2);

  // Option unfinished: nothing is claimed yet (sequences are all-or-nothing); the substitute shows as pending.
  const partial = evaluateRequirementTree(biology, ['CASXX900'], { [seqNode]: sub([{ courseKey: 'CASXX900', for: 'CASPY106' }]) });
  const p = child(partial, 'bio-ba-physics').children[0];
  assert.equal(p.status, 'unsatisfied');
  assert.equal(p.substitutions[0].status, 'pending');
  assert.deepEqual(p.partialMatch.haveKeys, ['CASXX900']);
  assert.deepEqual(p.openSlots.map((slot) => slot.for), ['CASPY105']);
  assert.equal(partial.totalCoursesClaimed, 0);

  // Real course completed: substitution is inert and CASXX900 is released.
  const inert = evaluateRequirementTree(biology, ['CASPY105', 'CASPY106', 'CASXX900'], { [seqNode]: sub([{ courseKey: 'CASXX900', for: 'CASPY106' }]) });
  const i = child(inert, 'bio-ba-physics').children[0];
  assert.equal(i.substitutions[0].status, 'real-course-completed');
  assert.deepEqual(i.matched, ['CASPY105', 'CASPY106']);
});

test('ONE_OF: a substitution on the active child counts; the container itself has none', () => {
  const r = evaluateRequirementTree(biology, ['CASPY105', 'CASXX900'], { 'bio-ba-physics-standard': sub([{ courseKey: 'CASXX900', for: 'CASPY106' }]) });
  const oneOf = child(r, 'bio-ba-physics');
  assert.equal(oneOf.activeChildIndex, 0);
  assert.equal(oneOf.substitutions, undefined);
  // A substitution keyed on the container is ignored.
  const ignored = evaluateRequirementTree(biology, ['CASPY105', 'CASXX900'], { 'bio-ba-physics': sub([{ courseKey: 'CASXX900', for: 'CASPY106' }]) });
  assert.equal(child(ignored, 'bio-ba-physics').status, 'unsatisfied');
  assert.equal(ignored.totalCoursesClaimed, evaluateRequirementTree(biology, ['CASPY105', 'CASXX900'], {}).totalCoursesClaimed);
});

test('legacy single-course substitute (no `for`) fills one open slot; an older whole-node waive still evaluates as before', () => {
  const plan = ['CASEC322'];
  const base = evaluateRequirementTree(econ, plan, {});
  const legacy = evaluateRequirementTree(econ, plan, { 'econ-ba-core': { type: 'substitute', courseKey: 'CASEC322', note: null, createdAt: 'x' } });
  const core = child(legacy, 'econ-ba-core');
  assert.equal(core.satisfiedCount, 1);
  assert.equal(core.required, 4);
  assert.equal(legacy.totalCoursesRequired, base.totalCoursesRequired);
  assert.equal(core.substitutions[0].status, 'applied');
  // Older saved UNRESOLVED substitute (the old "Count a different course") still claims its course.
  const unresolved = evaluateRequirementTree(csBa, ['CASXX900'], { 'cs-ba-group-d-petition': { type: 'substitute', courseKey: 'CASXX900', createdAt: 'x' } });
  const u = child(unresolved, 'cs-ba-group-d-petition');
  assert.equal(u.substituted, true);
  assert.equal(u.satisfiedCount, 1);
  assert.equal(unresolved.totalCoursesClaimed, 1);
});

// ── Mathematics BA, Applied focus areas: five labeled groups, one COUNT (min 4) ──
const findNode = (node, id) => {
  if (node.id === id) return node;
  for (const c of Array.isArray(node.children) ? node.children : []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
};
const focusKeys = (plan) => {
  const focus = findNode(evaluateRequirementTree(math, plan, {}).tree, 'math-ba-applied-focus');
  return { focus, keys: focus.matched.flatMap((m) => m.courseKeys) };
};

test('Applied focus areas: MA 573 is in two areas but counts once', () => {
  const alone = focusKeys(['CASMA573']);
  assert.equal(alone.focus.satisfiedCount, 1);
  assert.equal(alone.focus.required, 4);
  const four = focusKeys(['CASMA573', 'CASMA565', 'CASMA561', 'CASMA562']);
  assert.equal(four.focus.satisfiedCount, 4);
  assert.equal(four.focus.status, 'satisfied');
  assert.deepEqual(four.keys.filter((k) => k === 'CASMA573'), ['CASMA573']);
  assert.equal(new Set(four.keys).size, four.keys.length);
});

test('Applied focus areas: only one of MA 411 and MA 511 counts', () => {
  const both = focusKeys(['CASMA411', 'CASMA511']);
  assert.equal(both.focus.satisfiedCount, 1);
  assert.deepEqual(both.keys, ['CASMA511']);
  const only411 = focusKeys(['CASMA411', 'CASMA412']);
  assert.equal(only411.focus.satisfiedCount, 2);
});

test('Applied focus areas: pool is the five labeled areas in the bulletin order, display fields set', () => {
  const { focus } = focusKeys([]);
  const titles = focus.pool.map((e) => e.label);
  assert.deepEqual(titles, [
    'Mathematical analysis', 'Mathematical analysis',
    'Mathematical methods in the biological/life sciences',
    'Mathematical modeling and analysis in the physical sciences',
    'Numerical analysis and methods of computational mathematics',
    'Probability and mathematical statistics',
  ]);
  assert.equal(focus.pool[1].continues, true);
  assert.equal(focus.subtitle, 'Choose two areas below and take at least two courses in each.');
  assert.equal(focus.noteStyle, 'caption');
  assert.equal(focus.required, 4);
});

// ── poolFrom: "marineSemester" (the Marine Semester card) ───────────────────

const marineBa = JSON.parse(readFileSync(new URL('../data/requirements/cas/marine-science-ba.json', import.meta.url), 'utf8'));
const marineSemester = (result) => child(result, 'marine-ba-semester');
const subs = (...items) => ({ type: 'substitute', substitutions: items, createdAt: '2026-03-01T00:00:00.000Z' });

test('poolFrom: the pool is the data module list, twins as one slot; the JSON has no pool of its own', () => {
  const authored = marineBa.tree.children.find((c) => c.id === 'marine-ba-semester');
  assert.equal(authored.poolFrom, 'marineSemester');
  assert.ok(!('pool' in authored));
  assert.ok(!('filledByBlock' in authored));
  const node = marineSemester(evaluateRequirementTree(marineBa, []));
  assert.deepEqual(node.pool, marinePool());
  assert.deepEqual(resolveProgramPools(marineBa).tree.children.find((c) => c.id === 'marine-ba-semester').pool, marinePool());
  // A node with an authored pool, or no poolFrom, is left alone.
  const own = { id: 'x', type: 'COUNT', min: 1, poolFrom: 'marineSemester', pool: ['CASCS111'] };
  assert.equal(resolvePoolFrom(own), own);
  const plain = { id: 'y', type: 'COUNT', min: 1, pool: [] };
  assert.equal(resolvePoolFrom(plain), plain);
  assert.equal(resolvePoolFrom({ ...plain, poolFrom: 'nope' }).pool.length, 0);
});

test('poolFrom: nothing in the plan -> 0/4, total 17', () => {
  const r = evaluateRequirementTree(marineBa, []);
  const node = marineSemester(r);
  assert.equal(node.status, 'unsatisfied');
  assert.equal(node.satisfiedCount, 0);
  assert.equal(node.required, 4);
  assert.equal(r.totalCoursesRequired, 17);
  assert.equal(r.totalCoursesClaimed, 0);
  // marineSlots of 0 / junk changes nothing.
  for (const marineSlots of [0, -3, NaN, 'x', undefined]) {
    assert.equal(marineSemester(evaluateRequirementTree(marineBa, [], {}, { marineSlots })).satisfiedCount, 0);
  }
});

test('poolFrom: real pool courses count, a cross-listed twin pair counts once', () => {
  const two = marineSemester(evaluateRequirementTree(marineBa, ['CASBI511', 'CASBI569']));
  assert.equal(two.satisfiedCount, 2);
  const twins = marineSemester(evaluateRequirementTree(marineBa, ['CASBI578', 'CASEE578']));
  assert.equal(twins.satisfiedCount, 1);
  const withBoth = marineSemester(evaluateRequirementTree(marineBa, ['CASBI523', 'CASEE523', 'CASBI511']));
  assert.equal(withBoth.satisfiedCount, 2);
  // EE 557 and MR 500 are in the bulletin list; BI/EE 423 are Breadth courses, not Marine Semester ones.
  assert.equal(marineSemester(evaluateRequirementTree(marineBa, ['CASEE557', 'CASMR500'])).satisfiedCount, 2);
  const breadth = evaluateRequirementTree(marineBa, ['CASBI423']);
  assert.equal(marineSemester(breadth).satisfiedCount, 0);
  assert.equal(child(breadth, 'marine-ba-breadth').satisfiedCount, 1);
});

test('poolFrom: marineSlots fill the unmet slots, capped at 4; total stays 17', () => {
  const full = evaluateRequirementTree(marineBa, [], {}, { marineSlots: 4 });
  const node = marineSemester(full);
  assert.equal(node.status, 'satisfied');
  assert.equal(node.satisfiedCount, 4);
  assert.equal(node.required, 4);
  assert.equal(full.totalCoursesRequired, 17);
  assert.equal(full.totalCoursesClaimed, 4);
  assert.deepEqual(node.matched.map((m) => [m.marineSlots, m.courseKeys.length]), [[4, 0]]);

  // 1 real + 3 placeholders (the planner's count) = 4; 2 real + 2 placeholders = 4.
  const one = marineSemester(evaluateRequirementTree(marineBa, ['CASBI511'], {}, { marineSlots: 3 }));
  assert.equal(one.satisfiedCount, 4);
  assert.equal(one.status, 'satisfied');
  const partial = marineSemester(evaluateRequirementTree(marineBa, ['CASBI511'], {}, { marineSlots: 2 }));
  assert.equal(partial.satisfiedCount, 3);
  assert.equal(partial.status, 'unsatisfied');
  // More slots than needed: capped, never over 4.
  const over = evaluateRequirementTree(marineBa, ['CASBI511', 'CASBI569'], {}, { marineSlots: 9 });
  assert.equal(marineSemester(over).satisfiedCount, 4);
  assert.equal(over.totalCoursesClaimed, 4);
  assert.equal(over.totalCoursesRequired, 17);
});

test('poolFrom: substitutions fill open slots, and go inert once the slots are held', () => {
  const four = subs({ label: 'BI 539 (transcript)' }, { label: 'BI 541' }, { label: 'EE 544' }, { label: 'MR 500' });
  const without = evaluateRequirementTree(marineBa, [], { 'marine-ba-semester': four });
  assert.equal(marineSemester(without).satisfiedCount, 4);
  assert.equal(marineSemester(without).status, 'satisfied');
  assert.equal(without.totalCoursesClaimed, 4);

  const two = subs({ label: 'BI 539' }, { label: 'BI 541' });
  const partial = evaluateRequirementTree(marineBa, [], { 'marine-ba-semester': two });
  assert.equal(marineSemester(partial).satisfiedCount, 2);
  assert.equal(marineSemester(partial).openSlots.reduce((n, o) => n + o.count, 0), 2);

  const withSlots = evaluateRequirementTree(marineBa, ['CASBI541'], { 'marine-ba-semester': four }, { marineSlots: 3 });
  const node = marineSemester(withSlots);
  assert.equal(node.satisfiedCount, 4);
  assert.ok(node.substitutions.every((s) => s.status === 'no-open-slot'));
  assert.equal(withSlots.totalCoursesClaimed, 4);
  assert.equal(withSlots.totalCoursesRequired, 17);
});

test('poolFrom: a full 17-course plan with a Marine term', () => {
  const plan = ['CASBI260', 'CASEE144', 'CASBI107', 'CASBI108', 'CASCH171', 'CASCH172', 'CASPY211',
    'CASMA121', 'CASMA213', 'CASCS108', 'CASAN518', 'CASEE360', 'CASBI423'];
  const r = evaluateRequirementTree(marineBa, plan, {}, { marineSlots: 4 });
  assert.equal(r.status, 'satisfied');
  assert.equal(r.totalCoursesClaimed, 17);
  assert.equal(r.totalCoursesRequired, 17);
});

test('poolFrom: programs without it are unchanged by marineSlots', () => {
  const plan = ['CASBI107', 'CASBI108', 'CASBI203'];
  const a = evaluateRequirementTree(biology, plan);
  const b = evaluateRequirementTree(biology, plan, {}, { marineSlots: 4 });
  assert.equal(b.totalCoursesClaimed, a.totalCoursesClaimed);
  assert.equal(b.totalCoursesRequired, a.totalCoursesRequired);
});

// ── options.forcedTracks: pin a ONE_OF's active child (the selected track tab) ──
// root: [tracks (ONE_OF: A = leaf [A1 A2], B = COUNT 2 of [B1 B2 S]), later (COUNT 1 of [S L1])]
// S fits track B and the later group, so whichever runs first claims it.
const trackProgram = {
  programName: 'T', degree: 'BA', totalCoursesRequired: 99,
  tree: {
    id: 'root', type: 'ALL', label: 'Root',
    children: [
      {
        id: 'tracks', type: 'ONE_OF', label: 'Tracks', presentation: 'tracks',
        children: [
          { id: 'A', type: 'ALL', label: 'Track A', courses: ['CASXX101', 'CASXX102'] },
          { id: 'B', type: 'COUNT', label: 'Track B', min: 2, pool: ['CASXX201', 'CASXX202', 'CASXX900'] },
        ],
      },
      { id: 'later', type: 'COUNT', label: 'Later', min: 1, pool: ['CASXX900', 'CASXX300'] },
    ],
  },
};
const trackPlan = ['CASXX101', 'CASXX102', 'CASXX900', 'CASXX201'];

test('forcedTracks: forcing the auto-picked track is identical to no override', () => {
  const auto = evaluateRequirementTree(trackProgram, trackPlan, {});
  assert.equal(child(auto, 'tracks').activeChildIndex, 0);
  assert.equal(child(auto, 'tracks').autoChildIndex, 0);
  assert.deepEqual(evaluateRequirementTree(trackProgram, trackPlan, {}, { forcedTracks: { tracks: 0 } }), auto);
  // Same on a real tracks program, for whichever track it auto-picks.
  const mathPlan = ['CASMA123', 'CASMA124', 'CASMA225', 'CASMA242'];
  const mathAuto = evaluateRequirementTree(math, mathPlan, {});
  const hoisted = mathAuto.tree.children.find((n) => n.presentation === 'tracks');
  assert.ok(hoisted, 'mathematics-ba has a tracks ONE_OF');
  assert.deepEqual(
    evaluateRequirementTree(math, mathPlan, {}, { forcedTracks: { [hoisted.id]: hoisted.activeChildIndex } }),
    mathAuto,
  );
});

test('forcedTracks: a non-active track gives that track\'s totals', () => {
  const auto = evaluateRequirementTree(trackProgram, trackPlan, {});
  assert.equal(auto.status, 'satisfied');
  assert.equal(auto.totalCoursesRequired, 3);
  assert.equal(auto.totalCoursesClaimed, 3);

  const forced = evaluateRequirementTree(trackProgram, trackPlan, {}, { forcedTracks: { tracks: 1 } });
  const tracks = child(forced, 'tracks');
  assert.equal(tracks.activeChildIndex, 1);
  assert.equal(tracks.autoChildIndex, 0); // still reports the best match
  assert.equal(forced.totalCoursesRequired, 3); // B needs 2 + later 1
  assert.equal(forced.totalCoursesClaimed, 2); // B1 + S; later finds nothing left
  assert.equal(forced.status, 'unsatisfied');
});

test('forcedTracks: a course claimed by the forced track is not claimed again later', () => {
  const auto = evaluateRequirementTree(trackProgram, trackPlan, {});
  assert.equal(child(auto, 'later').status, 'satisfied'); // track A active: S goes to "later"
  const forced = evaluateRequirementTree(trackProgram, trackPlan, {}, { forcedTracks: { tracks: 1 } });
  const trackB = child(forced, 'tracks').children[1];
  assert.ok(JSON.stringify(trackB.matched).includes('CASXX900'));
  const later = child(forced, 'later');
  assert.equal(later.status, 'unsatisfied');
  assert.ok(!JSON.stringify(later.matched).includes('CASXX900'));
});

test('forcedTracks: invalid values are ignored; waived tracks behave as before', () => {
  const auto = evaluateRequirementTree(trackProgram, trackPlan, {});
  for (const bad of [-1, 2, 1.5, '1', null]) {
    assert.deepEqual(evaluateRequirementTree(trackProgram, trackPlan, {}, { forcedTracks: { tracks: bad } }), auto);
  }
  assert.deepEqual(evaluateRequirementTree(trackProgram, trackPlan, {}, { forcedTracks: { nope: 1 } }), auto);
  // Waiving track B while A is genuinely complete: auto still picks A...
  const waivedB = { B: waive() };
  const autoWaived = evaluateRequirementTree(trackProgram, trackPlan, waivedB);
  assert.equal(child(autoWaived, 'tracks').activeChildIndex, 0);
  // ...and forcing B shows the waived track as the active one, satisfied.
  const forcedWaived = evaluateRequirementTree(trackProgram, trackPlan, waivedB, { forcedTracks: { tracks: 1 } });
  assert.equal(child(forcedWaived, 'tracks').activeChildIndex, 1);
  assert.equal(child(forcedWaived, 'tracks').children[1].waived, true);
  assert.equal(child(forcedWaived, 'tracks').status, 'satisfied');
});

// ── COURSE_RANGE subjectPrefix / excludeSubjectPrefixes ─────────────────────

const prefixProgram = (entry, min = 3) => ({
  programName: 'T', degree: 'BS', totalCoursesRequired: 99,
  tree: { id: 'root', type: 'ALL', label: 'Root', children: [{ id: 'P', type: 'COUNT', label: 'P', min, pool: [entry] }] },
});
const prefixPlan = ['QSTFE323', 'QSTES310', 'QSTMK499', 'QSTFE600', 'CASEC101', 'ENGEK100'];

test('rangeMatchesSubject: exact subject wins, prefix covers every subject that starts with it, excluded prefixes never match', () => {
  assert.equal(rangeMatchesSubject({ subject: 'CASCS' }, 'CASCS'), true);
  assert.equal(rangeMatchesSubject({ subject: 'CASCS' }, 'CASCSX'), false);
  assert.equal(rangeMatchesSubject({ subject: 'CASCS', subjectPrefix: 'QST' }, 'QSTFE'), false);
  assert.equal(rangeMatchesSubject({ subjectPrefix: 'QST' }, 'QSTFE'), true);
  assert.equal(rangeMatchesSubject({ subjectPrefix: 'QST', excludeSubjectPrefixes: ['QSTES'] }, 'QSTES'), false);
  assert.equal(rangeMatchesSubject({ subjectPrefix: '' }, 'ENGEK'), true);
  assert.equal(rangeMatchesSubject({ subjectPrefix: '', excludeSubjectPrefixes: ['QST'] }, 'QSTFE'), false);
  assert.equal(rangeMatchesSubject({}, 'CASCS'), false); // no subject, no prefix: matches nothing (as before)
});

test('COURSE_RANGE subjectPrefix: claims across subjects in the number range, minus excluded subjects and keys', () => {
  const qst = evaluateRequirementTree(prefixProgram({
    type: 'COURSE_RANGE', subjectPrefix: 'QST', excludeSubjectPrefixes: ['QSTES'], min: 300, max: 599,
  }), prefixPlan, {});
  assert.deepEqual(child(qst, 'P').matched.flatMap((m) => m.courseKeys), ['QSTFE323', 'QSTMK499']);
  assert.equal(child(qst, 'P').satisfiedCount, 2);

  const nonQst = evaluateRequirementTree(prefixProgram({
    type: 'COURSE_RANGE', subjectPrefix: '', excludeSubjectPrefixes: ['QST'], min: 0, max: 999, exclude: ['ENGEK100'],
  }), prefixPlan, {});
  assert.deepEqual(child(nonQst, 'P').matched.flatMap((m) => m.courseKeys), ['CASEC101']);

  const any = evaluateRequirementTree(prefixProgram({ type: 'COURSE_RANGE', subjectPrefix: '', min: 0, max: 999 }, 10), prefixPlan, {});
  assert.equal(child(any, 'P').satisfiedCount, prefixPlan.length);

  const capped = evaluateRequirementTree(prefixProgram({ type: 'COURSE_RANGE_CAP', subjectPrefix: 'QST', min: 0, max: 999, cap: 1 }), prefixPlan, {});
  assert.equal(child(capped, 'P').satisfiedCount, 1);
});

test('COURSE_RANGE: missing range reports the prefix fields only when authored (plain ranges unchanged)', () => {
  const wide = evaluateRequirementTree(prefixProgram({
    type: 'COURSE_RANGE', subjectPrefix: '', excludeSubjectPrefixes: ['QST'], min: 0, max: 999,
  }), [], {});
  assert.deepEqual(child(wide, 'P').missing[0].range, {
    subject: undefined, subjectPrefix: '', excludeSubjectPrefixes: ['QST'], min: 0, max: 999, exclude: [], include: [],
  });
  const plain = evaluateRequirementTree(prefixProgram({ type: 'COURSE_RANGE', subject: 'CASCS', min: 300, max: 599 }), [], {});
  assert.deepEqual(child(plain, 'P').missing[0].range, { subject: 'CASCS', min: 300, max: 599, exclude: [], include: [] });
});

// ── Business Administration BS (Questrom) ───────────────────────────────────

const bsba = JSON.parse(readFileSync(new URL('../data/requirements/qst/business-administration-bsba.json', import.meta.url), 'utf8'));
const trackNode = (result, index) => child(result, 'bsba-tracks').children[index];
const trackChild = (result, index, id) => trackNode(result, index).children.find((c) => c.id === id);
const keysOf = (node) => (node.matched || []).flatMap((m) => (typeof m === 'string' ? [m] : m.courseKeys || []));

const bsbaTrackA = [
  'QSTAC221', 'QSTBA221', 'QSTBA222', 'QSTFE223', 'QSTIS223', 'QSTLA245', 'QSTMK223', 'QSTMO221', 'QSTOM223',
  'QSTSI422', 'QSTSM131', 'QSTSM275', 'QSTXP298', 'QSTXP301',
  'QSTES110', 'QSTES210', 'QSTES310', 'QSTBE101', 'QSTBE102', 'CASMA121', 'CASWR120',
  'QSTFE425', 'QSTFE449', 'QSTMK465', 'QSTOB345', 'QSTSI480',
  'CASCS111', 'CASPS101', 'CASHI101', 'CASAR100', 'COMCM101', 'ENGEK100', 'SARHS201',
  'QSTFE360', 'CASPH100', 'QSTES311',
];

test('BSBA Track A: a full plan is satisfied, 36 courses (ES 110 + 210 is two), electives claimed in order', () => {
  const r = evaluateRequirementTree(bsba, bsbaTrackA, {});
  assert.equal(child(r, 'bsba-tracks').activeChildIndex, 0);
  assert.equal(trackNode(r, 0).status, 'satisfied');
  assert.equal(r.totalCoursesRequired, 36);
  assert.equal(r.totalCoursesClaimed, 36);
  assert.equal(keysOf(trackChild(r, 0, 'bsba-a-questrom-electives')).length, 5);
  // A sixth upper-level QST course is a free elective, never a non-Questrom one.
  assert.ok(!keysOf(trackChild(r, 0, 'bsba-a-non-questrom-electives')).some((k) => k.startsWith('QST')));
  assert.equal(keysOf(trackChild(r, 0, 'bsba-a-free-electives')).length, 3);
});

test('BSBA Track A: ES and XP courses are never Questrom electives; a second "only one counts" course is no elective', () => {
  const r = evaluateRequirementTree(bsba, [...bsbaTrackA, 'QSTES410', 'QSTXP401', 'CASEC101', 'QSTBA223'], {});
  const qstElectives = keysOf(trackChild(r, 0, 'bsba-a-questrom-electives'));
  assert.ok(!qstElectives.some((k) => k.startsWith('QSTES') || k.startsWith('QSTXP')));
  const electives = keysOf(trackChild(r, 0, 'bsba-a-non-questrom-electives')).concat(keysOf(trackChild(r, 0, 'bsba-a-free-electives')));
  assert.ok(!electives.includes('CASEC101'));
  assert.ok(!electives.includes('QSTBA223'));
});

test('BSBA Track B: SM 323 alone satisfies the Cross-Functional Core; stats-overlap courses never count as electives', () => {
  const plan = [
    'QSTSM131', 'QSTSM132', 'QSTAC221', 'QSTAC222', 'QSTQM221', 'QSTQM222', 'QSTMO221', 'QSTIS223', 'QSTLA245', 'QSTSM275', 'QSTSI422',
    'QSTSM323', 'CASMA213', 'CASEC203', 'CASPS211',
  ];
  const r = evaluateRequirementTree(bsba, plan, {});
  assert.equal(child(r, 'bsba-tracks').activeChildIndex, 1);
  const core = trackChild(r, 1, 'bsba-b-cross-functional-core');
  assert.equal(core.status, 'satisfied');
  assert.equal(core.activeChildIndex, 1);
  for (const id of ['bsba-b-questrom-electives', 'bsba-b-cas-electives', 'bsba-b-non-questrom-electives', 'bsba-b-free-electives']) {
    assert.deepEqual(keysOf(trackChild(r, 1, id)), [], id);
  }
});

test('BSBA Track A pools keep the stats-overlap courses (that rule is Track B only)', () => {
  const r = evaluateRequirementTree(bsba, [...bsbaTrackA.filter((k) => k !== 'CASCS111'), 'CASMA213'], {});
  assert.ok(keysOf(trackChild(r, 0, 'bsba-a-non-questrom-electives')).includes('CASMA213'));
});

// ── View nodes (`claims: "view"`) and `selection: "student"` ────────────────

// root: [V (view of E), E (COUNT 2 of A B C), K (core leaf), R (REMAINDER, any QST)]
// V is listed first but evaluates last; it may re-read E's and R's courses but
// never K's (not in viewOf), and may also take a plan course nobody counts.
const viewProgram = (viewOf = ['E', 'R'], extra = {}) => ({
  programName: 'T', degree: 'BS', totalCoursesRequired: 99,
  tree: {
    id: 'root', type: 'ALL', label: 'Root', children: [
      { id: 'V', type: 'ALL', label: 'View', claims: 'view', viewOf, children: [
        { id: 'V1', type: 'COUNT', label: 'V1', min: 4, pool: [{ type: 'COURSE_LIST', courses: ['CASXX001', 'CASXX003', 'CASXX009', 'QSTXX500', 'CASXX005'] }] },
      ], ...extra },
      { id: 'E', type: 'COUNT', label: 'E', min: 2, pool: ['CASXX001', 'CASXX002', 'CASXX003'] },
      { id: 'K', type: 'ALL', label: 'K', courses: ['CASXX009'] },
      { id: 'R', type: 'REMAINDER', label: 'R', totalRequired: 4, pool: [{ type: 'COURSE_RANGE', subjectPrefix: 'QST', min: 0, max: 999 }] },
    ],
  },
});
const viewPlan = ['CASXX001', 'CASXX002', 'CASXX003', 'CASXX009', 'QSTXX500', 'CASXX005'];
const withoutView = (program) => ({ ...program, tree: { ...program.tree, children: program.tree.children.filter((c) => c.id !== 'V') } });

test('view node: re-reads viewOf courses (also the REMAINDER\'s), never a core course; totals and claims unchanged', () => {
  const program = viewProgram();
  const r = evaluateRequirementTree(program, viewPlan, {});
  const base = evaluateRequirementTree(withoutView(program), viewPlan, {});
  const v = child(r, 'V').children[0];
  // E claims 001 + 002, K claims 009, R claims QST 500; 003 and 005 are counted nowhere.
  assert.deepEqual(keysOf(v).sort(), ['CASXX001', 'CASXX003', 'CASXX005', 'QSTXX500']);
  assert.ok(!keysOf(v).includes('CASXX009'));
  assert.equal(v.status, 'satisfied');
  assert.equal(r.totalCoursesClaimed, base.totalCoursesClaimed);
  assert.equal(r.totalCoursesRequired, base.totalCoursesRequired);
  assert.deepEqual(keysOf(child(r, 'E')), keysOf(child(base, 'E')));
  assert.deepEqual(keysOf(child(r, 'R')), keysOf(child(base, 'R')));
  // Its own total still reads n/N when asked directly.
  assert.equal(deriveRequiredTotal(child(r, 'V')), 4);
});

test('view node: a course counted by a sibling outside viewOf stays out; an unsatisfied view never blocks its parent', () => {
  const r = evaluateRequirementTree(viewProgram(['R']), viewPlan, {});
  // E is not in viewOf now: 001 is invisible (003 isn't counted by E, so it is free).
  assert.ok(!keysOf(child(r, 'V').children[0]).includes('CASXX001'));
  const short = evaluateRequirementTree(viewProgram(), ['CASXX001', 'CASXX002', 'CASXX009', 'QSTXX500', 'QSTXX501', 'QSTXX502'], {});
  assert.equal(child(short, 'V').status, 'unsatisfied');
  assert.equal(short.status, 'satisfied'); // E, K and R are done; the view doesn't hold the root back
});

test('view node: petitions and waives inside it stay private', () => {
  const program = viewProgram();
  const base = evaluateRequirementTree(withoutView(program), viewPlan, {});
  const sub = evaluateRequirementTree(program, viewPlan, { V1: { type: 'substitute', substitutions: [{ label: 'Study abroad course' }] } });
  assert.equal(sub.totalCoursesClaimed, base.totalCoursesClaimed);
  const waived = evaluateRequirementTree(program, viewPlan, { V: { type: 'waive' } });
  assert.equal(waived.totalCoursesClaimed, base.totalCoursesClaimed);
  assert.equal(waived.totalCoursesRequired, base.totalCoursesRequired);
});

const pickProgram = {
  programName: 'T', degree: 'BS', totalCoursesRequired: 99,
  tree: { id: 'root', type: 'ALL', label: 'Root', children: [
    { id: 'P', type: 'ONE_OF', selection: 'student', label: 'Pick', children: [
      { id: 'P0', type: 'ALL', label: 'P0', courses: ['CASXX001'] },
      { id: 'P1', type: 'ALL', label: 'P1', courses: ['CASXX002', 'CASXX003'] },
    ] },
  ] },
};

test('selection "student": no pick = nothing active or claimed; a pick (forcedTracks) is the active child; bad picks are ignored', () => {
  const none = evaluateRequirementTree(pickProgram, ['CASXX001'], {});
  assert.equal(child(none, 'P').activeChildIndex, null);
  assert.equal(child(none, 'P').autoChildIndex, 0);
  assert.equal(child(none, 'P').status, 'unsatisfied');
  assert.equal(none.totalCoursesClaimed, 0);
  assert.equal(deriveRequiredTotal(child(none, 'P')), 0);
  const picked = evaluateRequirementTree(pickProgram, ['CASXX001'], {}, { forcedTracks: { P: 1 } });
  assert.equal(child(picked, 'P').activeChildIndex, 1);
  assert.equal(picked.totalCoursesRequired, 2);
  assert.equal(picked.totalCoursesClaimed, 0);
  for (const bad of [-1, 2, 0.5, '1']) {
    assert.equal(child(evaluateRequirementTree(pickProgram, [], {}, { forcedTracks: { P: bad } }), 'P').activeChildIndex, null);
  }
});

// BSBA concentrations (phase 2a): view of the elective cards, picked per track.
const pickA = (index) => ({ forcedTracks: { 'bsba-tracks': 0, 'bsba-a-concentration-pick': index } });
const concNames = (track) => trackChild(evaluateRequirementTree(bsba, [], {}), track, `bsba-${track ? 'b' : 'a'}-concentration-set`)
  .children[0].children.map((c) => c.label);

test('BSBA concentrations: 12 per cohort in bulletin order; Independent and the overlap rule are advisor cards', () => {
  const names = [
    'Accounting', 'Business Analytics', 'Business Law & Policy', 'Finance', 'Global Business', 'Information Systems',
    'Innovation & Entrepreneurship', 'Management & Organizations', 'Marketing', 'Operations & Supply Chain Management', 'Real Estate', 'Strategy',
  ];
  assert.deepEqual(concNames(0), names);
  assert.deepEqual(concNames(1), names);
  for (const track of [0, 1]) {
    const set = trackChild(evaluateRequirementTree(bsba, [], {}), track, `bsba-${track ? 'b' : 'a'}-concentration-set`);
    assert.equal(set.claims, 'view');
    assert.deepEqual(set.children.slice(1).map((c) => c.type), ['UNRESOLVED', 'UNRESOLVED']);
  }
});

test('BSBA concentrations: picking one never changes the totals (A 36 with ES 110 + 210, B 35 with the four-course core)', () => {
  const plan = [...bsbaTrackA, 'QSTFE445', 'QSTFE325', 'QSTFE454', 'QSTFE458'];
  const none = evaluateRequirementTree(bsba, plan, {}, { forcedTracks: { 'bsba-tracks': 0 } });
  for (let i = 0; i < 12; i += 1) {
    const r = evaluateRequirementTree(bsba, plan, {}, pickA(i));
    assert.equal(r.totalCoursesRequired, 36);
    assert.equal(r.totalCoursesClaimed, none.totalCoursesClaimed);
  }
  assert.equal(evaluateRequirementTree(bsba, [], {}, { forcedTracks: { 'bsba-tracks': 1, 'bsba-b-concentration-pick': 3 } }).totalCoursesRequired, 35);
});

test('BSBA Finance (Fall 2025+): required + X-list + 3 B = 5, the same courses still fill Questrom electives', () => {
  const plan = ['QSTFE445', 'QSTFE325', 'QSTFE449', 'QSTFE454', 'QSTFE458'];
  const r = evaluateRequirementTree(bsba, plan, {}, pickA(3));
  const set = trackChild(r, 0, 'bsba-a-concentration-set');
  const finance = set.children[0].children[3];
  assert.equal(finance.label, 'Finance');
  assert.equal(finance.status, 'satisfied');
  assert.equal(deriveRequiredTotal(set), 5);
  assert.deepEqual(keysOf(trackChild(r, 0, 'bsba-a-questrom-electives')).sort(), [...plan].sort());
});

test('BSBA Global Business: outside courses count for the concentration (cap 2) but never as Questrom electives', () => {
  const plan = ['QSTIM345', 'QSTFE325', 'CASIR322', 'CASIR399', 'CASEC391', 'QSTMK467'];
  const r = evaluateRequirementTree(bsba, plan, {}, pickA(4));
  const gb = trackChild(r, 0, 'bsba-a-concentration-set').children[0].children[4];
  const b = gb.children.find((c) => c.id.endsWith('-b'));
  assert.equal(b.status, 'satisfied');
  assert.equal(keysOf(b).filter((k) => k.startsWith('CAS')).length, 2);
  assert.ok(!keysOf(trackChild(r, 0, 'bsba-a-questrom-electives')).some((k) => k.startsWith('CAS')));
});

test('BSBA Marketing: the A-list course is not also a B-list course; the other A option can be', () => {
  const marketing = 8;
  const r = evaluateRequirementTree(bsba, ['QSTMK345', 'QSTMK542', 'QSTMK447', 'QSTMK487'], {}, pickA(marketing));
  const mk = trackChild(r, 0, 'bsba-a-concentration-set').children[0].children[marketing];
  const [a, , b] = mk.children;
  assert.deepEqual(keysOf(a), ['QSTMK345']);
  assert.deepEqual(keysOf(b).sort(), ['QSTMK487', 'QSTMK542']);
});

// ── Bundle slots count their courses (SEQUENCE_GROUP pool entries) ──────────

const ee = JSON.parse(readFileSync(new URL('../data/requirements/eng/electrical-engineering-bs.json', import.meta.url), 'utf8'));

test('bundle slots: a complete plan using EK 121 + 122 reads N of N, never N+1 of N; one missing slot leaves 1 to add', () => {
  const keys = [...new Set(JSON.stringify(ee.tree).match(/"[A-Z]{5}\d{3}"/g).map((s) => s.slice(1, -1)))];
  const complete = keys.filter((k) => k !== 'ENGEK125');
  const full = evaluateRequirementTree(ee, complete, {});
  const req = child(full, 'ee-bs-required');
  assert.equal(req.status, 'satisfied');
  assert.equal(`${req.satisfiedCount}/${req.required}`, '24/24'); // 23 slots, the programming slot is 2 courses
  assert.equal(full.totalCoursesRequired, 32);
  assert.equal(full.totalCoursesClaimed, full.totalCoursesRequired);
  // Drop one other required course: exactly one still to add.
  const short = evaluateRequirementTree(ee, complete.filter((k) => k !== 'ENGEC464'), {});
  assert.ok(short.totalCoursesClaimed <= short.totalCoursesRequired);
  assert.equal(short.totalCoursesRequired - short.totalCoursesClaimed, 1);
  // EK 125 instead: the slot is one course again.
  const ek125 = evaluateRequirementTree(ee, keys.filter((k) => k !== 'ENGEK121' && k !== 'ENGEK122'), {});
  assert.equal(child(ek125, 'ee-bs-required').required, 23);
  assert.equal(ek125.totalCoursesRequired, 31);
});

test('bundle slots: a pick-N card adds only the bundles it actually counts (BMB advanced lab)', () => {
  const bmb = JSON.parse(readFileSync(new URL('../data/requirements/cas/biochemistry-molecular-biology-ba.json', import.meta.url), 'utf8'));
  const empty = evaluateRequirementTree(bmb, [], {});
  const bundle = evaluateRequirementTree(bmb, ['CASBB401', 'CASBB402'], {});
  const lab = (r) => r.tree.children.flatMap(function all(n) { return [n, ...(n.children || []).flatMap(all)]; }).find((n) => n.id === 'bmb-ba-adv-lab-elective');
  assert.equal(`${lab(empty).satisfiedCount}/${lab(empty).required}`, '0/1');
  assert.equal(`${lab(bundle).satisfiedCount}/${lab(bundle).required}`, '2/2');
  assert.equal(bundle.totalCoursesRequired, empty.totalCoursesRequired + 1);
  assert.ok(bundle.totalCoursesClaimed <= bundle.totalCoursesRequired);
});

test('BSBA Career (both tracks): nothing = 2, ES 110 + 210 = 3, ES 215 = 2; the total follows', () => {
  for (const [track, id] of [[0, 'bsba-a-career'], [1, 'bsba-b-career']]) {
    const run = (plan) => {
      const r = evaluateRequirementTree(bsba, plan, {}, { forcedTracks: { 'bsba-tracks': track } });
      const c = trackChild(r, track, id);
      return { card: `${c.satisfiedCount}/${c.required}`, status: c.status, total: r.totalCoursesRequired, claimed: r.totalCoursesClaimed };
    };
    assert.deepEqual(run([]), { card: '0/2', status: 'unsatisfied', total: 35, claimed: 0 });
    assert.deepEqual(run(['QSTES110', 'QSTES210']), { card: '2/3', status: 'unsatisfied', total: 36, claimed: 2 });
    assert.deepEqual(run(['QSTES215']), { card: '1/2', status: 'unsatisfied', total: 35, claimed: 1 });
    assert.deepEqual(run(['QSTES110', 'QSTES210', 'QSTES310']), { card: '3/3', status: 'satisfied', total: 36, claimed: 3 });
    assert.deepEqual(run(['QSTES215', 'QSTES310']), { card: '2/2', status: 'satisfied', total: 35, claimed: 2 });
  }
});

test('BSBA Track A: every slot filled but ES 310 (bundle used) leaves 1 to add, not 0', () => {
  const plan = [
    'QSTAC221', 'QSTBA221', 'QSTBA222', 'QSTFE223', 'QSTIS223', 'QSTLA245', 'QSTMK223', 'QSTMO221', 'QSTOM223', 'QSTSI422', 'QSTSM131', 'QSTSM275', 'QSTXP298', 'QSTXP301',
    'QSTES110', 'QSTES210', 'QSTBE101', 'QSTBE102', 'CASWR120', 'CASMA123',
    'QSTAC322', 'QSTAC347', 'QSTAC348', 'QSTAC431', 'QSTAC569',
    'CASCS111', 'CASMA124', 'CASAA113', 'CASAH233', 'CASBI414', 'CASLH284', 'CASRN242', 'CASSO306', 'CASWS101', 'CASWS333',
  ];
  const r = evaluateRequirementTree(bsba, plan, {}, { forcedTracks: { 'bsba-tracks': 0, 'bsba-a-concentration-pick': 0 } });
  assert.equal(r.totalCoursesClaimed, 35);
  assert.equal(r.totalCoursesRequired, 36);
  assert.equal(r.status, 'unsatisfied');
  const full = evaluateRequirementTree(bsba, [...plan, 'QSTES310'], {}, { forcedTracks: { 'bsba-tracks': 0 } });
  assert.equal(full.totalCoursesClaimed, full.totalCoursesRequired);
});

test('BSBA core fixes: Track B AC 222 slot takes AC 322; SI 250 counts as a Questrom elective in both tracks', () => {
  const b = evaluateRequirementTree(bsba, ['QSTAC322'], {}, { forcedTracks: { 'bsba-tracks': 1 } });
  assert.ok(keysOf(trackChild(b, 1, 'bsba-b-required')).includes('QSTAC322'));
  for (const track of [0, 1]) {
    const r = evaluateRequirementTree(bsba, ['QSTSI250'], {}, { forcedTracks: { 'bsba-tracks': track } });
    assert.deepEqual(keysOf(trackChild(r, track, `bsba-${track ? 'b' : 'a'}-questrom-electives`)), ['QSTSI250']);
  }
});
