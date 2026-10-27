// Run with: node --test src/utils/sequenceSeed.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  seedSequence, validateSequence, placeWithTakeover, removeCourseGivingBack, pickTakeover,
  nodeAcceptsCourse, placeholderLabelFor, sequenceSlots, seedMessage,
} from './sequenceSeed.js';
import { createUndo } from './undoToast.js';
import {
  createFillsPlaceholder, createMarineTerm, entryCourseKey, entryFills, isNoteEntry, normalizeCourseEntry,
  normalizeSemesters, semestersFromFirestore, isFillsId,
} from './courseEntry.js';
import { requirementsPlanKeys } from './requirementsKeys.js';
import { sanitizePlanBlob } from './planImport.js';
import { buildPlanPayload } from './planPdfModel.js';

const dir = new URL('../data/requirements/', import.meta.url);
const programs = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(new URL(`${d.name}/`, dir)).map((f) => JSON.parse(readFileSync(new URL(`${d.name}/${f}`, dir), 'utf8'))));
const EE = programs.find((p) => p.bulletinUrl === 'https://www.bu.edu/academics/eng/programs/electrical-engineering/bs/');
const catalog = JSON.parse(readFileSync(new URL('../../public/courses.json', import.meta.url), 'utf8'));
const catalogIds = new Set(catalog.map((c) => c.id));

const empty = () => Array.from({ length: 8 }, () => []);
const keysAt = (semesters, i) => semesters[i].map(entryCourseKey).filter(Boolean);
const notesAt = (semesters, i) => semesters[i].filter(isNoteEntry);
const allKeys = (semesters) => semesters.flatMap((_, i) => keysAt(semesters, i));
const countFills = (semesters, id) => semesters.flat().filter((e) => isNoteEntry(e) && entryFills(e) === id).length;
const seed = (semesters, extra = {}) => seedSequence({ programDef: EE, semesters, ...extra });

test('every program sequence is valid: keys in the catalog, fills are node ids or "hub"', () => {
  assert.ok(EE, 'EE program found');
  for (const program of programs.filter((p) => p.sequence)) {
    assert.deepEqual(validateSequence(program, catalogIds), [], program.bulletinUrl);
  }
  assert.equal(sequenceSlots(EE).length, 8);
});

test('validateSequence catches a missing key and an unknown fills id', () => {
  const bad = { ...EE, sequence: { slots: [{ courses: ['CASMA99999'], placeholders: [{ label: 'x', fills: 'nope' }, { label: 'y', fills: 'Bad Id' }] }] } };
  const problems = validateSequence(bad, catalogIds);
  assert.equal(problems.length, 3);
});

test('empty plan: the whole path, 23 required courses and 12 placeholders', () => {
  const r = seed(empty());
  assert.equal(r.addedCourses.length, 23);
  assert.equal(r.addedPlaceholders, 12);
  assert.deepEqual(keysAt(r.semesters, 0), ['CASMA123', 'CASWR120', 'ENGEK100', 'ENGEK125']);
  assert.equal(countFills(r.semesters, 'hub'), 4);
  assert.equal(countFills(r.semesters, 'ee-bs-core-electives'), 3);
  assert.equal(countFills(r.semesters, 'ee-bs-technical-electives'), 3);
  assert.equal(countFills(r.semesters, 'ee-bs-computer-elective'), 1);
  assert.equal(countFills(r.semesters, 'ee-bs-natural-science'), 1);
  assert.equal(notesAt(r.semesters, 5).length, 4);
});

test('only fills what is missing: nothing is moved or removed', () => {
  const semesters = empty();
  semesters[2] = [normalizeCourseEntry('CASMA123'), createFillsPlaceholder('Mine', undefined)];
  const r = seed(semesters);
  assert.deepEqual(keysAt(r.semesters, 2).slice(0, 1), ['CASMA123']);
  assert.equal(allKeys(r.semesters).filter((k) => k === 'CASMA123').length, 1);
  assert.ok(r.semesters[2].some((e) => isNoteEntry(e) && e.text === 'Mine'));
  assert.equal(semesters[2].length, 2, 'input not mutated');
});

test('a held alternative skips its slot: WR 152 skips WR 151', () => {
  const semesters = empty();
  semesters[1] = [normalizeCourseEntry('CASWR152'), normalizeCourseEntry('CASMA242')];
  const r = seed(semesters);
  const keys = allKeys(r.semesters);
  assert.ok(!keys.includes('CASWR151'));
  assert.ok(!keys.includes('ENGEK103'), 'MA 242 fills the EK 103 slot');
  assert.equal(keys.filter((k) => k === 'CASWR152').length, 1);
  assert.deepEqual(keysAt(r.semesters, 1).filter((k) => k !== 'CASWR152' && k !== 'CASMA242'), ['CASMA124', 'CASPY211', 'ENGEK131']);
});

test('EK 121 + 122 held skips EK 125', () => {
  const semesters = empty();
  semesters[0] = [normalizeCourseEntry('ENGEK121'), normalizeCourseEntry('ENGEK122')];
  const keys = allKeys(seed(semesters).semesters);
  assert.ok(!keys.includes('ENGEK125'));
});

test('AP Calc BC (stored "A+B") skips MA 123 and MA 124 and leaves the slots empty', () => {
  const externalCredits = [{ type: 'ap', courseKey: 'CASMA123+CASMA124' }];
  const r = seed(empty(), { externalCredits });
  const keys = allKeys(r.semesters);
  assert.ok(!keys.includes('CASMA123') && !keys.includes('CASMA124'));
  assert.deepEqual(keysAt(r.semesters, 0), ['CASWR120', 'ENGEK100', 'ENGEK125'], 'later courses do not shift');
  assert.deepEqual(keysAt(r.semesters, 1), ['CASPY211', 'CASWR151', 'ENGEK103', 'ENGEK131']);
});

test('a petition (substitution) fills its slot, so seeding skips it', () => {
  const overrides = { 'ee-bs-required': { type: 'substitute', substitutions: [{ label: 'Transfer calc', for: 'CASMA124' }] } };
  const keys = allKeys(seed(empty(), { overrides }).semesters);
  assert.ok(!keys.includes('CASMA124'));
});

test('two EE Core electives already planned: one placeholder, not three', () => {
  const semesters = empty();
  semesters[4] = [normalizeCourseEntry('ENGEC402'), normalizeCourseEntry('ENGEC412')];
  const r = seed(semesters);
  assert.equal(countFills(r.semesters, 'ee-bs-core-electives'), 1);
});

test('placeholders already in the plan count: a second click adds nothing', () => {
  const once = seed(empty());
  const twice = seed(once.semesters);
  assert.equal(twice.changed, false);
  assert.equal(countFills(twice.semesters, 'hub'), 4);
  const fewer = once.semesters.map((e) => [...e]);
  fewer[5] = fewer[5].filter((e) => entryFills(e) !== 'hub');
  assert.equal(countFills(seed(fewer).semesters, 'hub'), 4, 'a removed Hub placeholder comes back once');
});

test('past terms are not seeded; current and future are', () => {
  const r = seed(empty(), { isSlotSeedable: (i) => i >= 3 });
  for (const i of [0, 1, 2]) assert.deepEqual(r.semesters[i], []);
  assert.deepEqual(keysAt(r.semesters, 3), ['CASMA226', 'CASPY313', 'ENGEK301']);
});

test('a Marine term is never seeded into', () => {
  const semesters = empty();
  semesters[4] = createMarineTerm();
  const r = seed(semesters);
  assert.equal(r.semesters[4].length, semesters[4].length);
  assert.ok(!keysAt(r.semesters, 4).length);
});

test('a program without a sequence is left alone', () => {
  const cs = programs.find((p) => !p.sequence);
  const r = seedSequence({ programDef: cs, semesters: empty() });
  assert.equal(r.changed, false);
});

test('takeover: EC 541 takes one EE Core placeholder, a non-eligible course adds normally', () => {
  const entries = seed(empty()).semesters[5];
  const ctx = { programDef: EE, hasHubUnits: false };
  const placed = placeWithTakeover(entries, 'ENGEC541', 5, ctx);
  assert.equal(placed.took.fills, 'ee-bs-core-electives');
  assert.equal(placed.entries.length, entries.length);
  assert.equal(entryCourseKey(placed.entries.find((e) => entryCourseKey(e))), 'ENGEC541');
  assert.equal(entryFills(placed.entries.find((e) => entryCourseKey(e))), 'ee-bs-core-electives');
  const plain = placeWithTakeover(entries, 'CASMA123', 5, ctx);
  assert.equal(plain.took, null);
  assert.equal(plain.entries.length, entries.length + 1);
});

test('takeover priority: Core before Technical before Hub; Hub only with HUB units', () => {
  const entries = [
    createFillsPlaceholder('Hub Elective', 'hub'),
    createFillsPlaceholder('Technical Elective', 'ee-bs-technical-electives'),
    createFillsPlaceholder('EE Core Elective', 'ee-bs-core-electives'),
  ];
  assert.equal(pickTakeover(entries, 'ENGEC541', { programDef: EE, hasHubUnits: true }), 2);
  assert.equal(pickTakeover(entries, 'ENGEC500', { programDef: EE, hasHubUnits: true }), 1, 'any EC counts as technical');
  assert.equal(pickTakeover(entries, 'CASAN101', { programDef: EE, hasHubUnits: true }), 0);
  assert.equal(pickTakeover(entries, 'CASAN101', { programDef: EE, hasHubUnits: false }), -1);
  assert.equal(pickTakeover([createFillsPlaceholder('x', undefined)], 'ENGEC541', { programDef: EE }), -1, 'no fills: never taken');
});

test('takeover uses the engine pool: EC 327 fits Computer, PY 451 fits Natural Science', () => {
  assert.equal(nodeAcceptsCourse(EE, 'ee-bs-computer-elective', 'ENGEC327'), true);
  assert.equal(nodeAcceptsCourse(EE, 'ee-bs-computer-elective', 'ENGEC541'), false);
  assert.equal(nodeAcceptsCourse(EE, 'ee-bs-natural-science', 'CASPY451'), true);
  assert.equal(nodeAcceptsCourse(EE, 'ee-bs-technical-electives', 'ENGBE350'), true);
});

test('removing a course that took a placeholder over gives the placeholder back in place', () => {
  const start = seed(empty()).semesters[5];
  const placed = placeWithTakeover(start, 'ENGEC541', 5, { programDef: EE }).entries;
  const index = placed.findIndex((e) => entryCourseKey(e) === 'ENGEC541');
  const back = removeCourseGivingBack(placed, 'ENGEC541', 5, EE);
  assert.equal(back.length, placed.length);
  assert.equal(entryFills(back[index]), 'ee-bs-core-electives');
  assert.equal(back[index].text, 'EE Core Elective');
  const plainRemoved = removeCourseGivingBack([normalizeCourseEntry('CASMA123')], 'CASMA123', 0, EE);
  assert.deepEqual(plainRemoved, []);
  assert.equal(placeholderLabelFor(EE, 'hub'), 'Hub Elective');
});

test('fills survives normalize, the Firestore round trip and junk is dropped', () => {
  assert.equal(isFillsId('ee-bs-core-electives'), true);
  assert.equal(isFillsId('hub'), true);
  for (const junk of ['', 'A B', '../x', 5, null, undefined, 'x'.repeat(80), '-x']) assert.equal(isFillsId(junk), false);
  const stored = { 0: [createFillsPlaceholder('Hub Elective', 'hub'), { ...normalizeCourseEntry('CASMA123'), fills: 'ee-bs-natural-science' }, { kind: 'note', id: 'n', text: 'x', credits: 4, fills: '<script>' }] };
  const read = semestersFromFirestore(JSON.parse(JSON.stringify(stored)));
  assert.equal(entryFills(read[0][0]), 'hub');
  assert.equal(entryFills(read[0][1]), 'ee-bs-natural-science');
  assert.equal(entryFills(read[0][2]), null);
  assert.equal(read[0][2].fills, undefined);
  assert.deepEqual(normalizeSemesters(read).map((e) => e.length), read.map((e) => e.length));
});

test('plan PDF payload round trip keeps fills (and rejects junk on import)', () => {
  const semesters = seed(empty()).semesters;
  const placed = placeWithTakeover(semesters[5], 'ENGEC541', 5, { programDef: EE });
  semesters[5] = placed.entries;
  const serialized = Object.fromEntries(semesters.map((entries, i) => [i, entries]));
  serialized[7] = [...serialized[7], { kind: 'note', id: 'bad', text: 'junk', credits: 4, fills: 'Not An Id' }];
  const payload = buildPlanPayload({
    now: new Date('2026-10-09T00:00:00Z'), planName: 'EE', majorBulletinUrl: EE.bulletinUrl, isTransfer: false,
    serializedSemesters: serialized, gridSummerTerms: {}, extraTerms: [], stash: [], requirementOverrides: {},
    completedCourseKeys: [], externalCredits: [],
  });
  const blob = JSON.parse(JSON.stringify(payload));
  const r = sanitizePlanBlob(blob, { catalogIds, programs: { urls: new Set([EE.bulletinUrl]), requirements: [EE] } });
  assert.deepEqual(r.errors, []);
  const imported = r.plan.semesters;
  assert.equal(imported[5].filter((e) => isNoteEntry(e) && entryFills(e)).length, 3);
  assert.equal(entryFills(imported[5].find((e) => entryCourseKey(e) === 'ENGEC541')), 'ee-bs-core-electives');
  assert.equal(imported[0].filter((e) => entryCourseKey(e)).length, 4);
  const junk = imported[7].find((e) => isNoteEntry(e) && e.text === 'junk');
  assert.equal(junk.fills, undefined);
});

// ── Skip report ─────────────────────────────────────────────────────────────

const skip = (result, courseKey) => result.skipped.find((item) => item.courseKey === courseKey);
const labelOf = (i) => ['Fall 2026', 'Spring 2027', 'Fall 2027'][i] ?? `slot ${i}`;
const msg = (result, why = () => 'before your start') => seedMessage(result, { slotLabel: labelOf, codeOf: (k) => k.replace(/^[A-Z]{3}/, '').replace(/([A-Z]+)(\d+)/, '$1 $2'), whyText: why });

test('skip reason "past": a past or before-start term is reported, its unmet courses are stashed', () => {
  const r = seed(empty(), { isSlotSeedable: (i) => i >= 1 });
  assert.deepEqual(r.semesters[0], []);
  for (const key of ['CASMA123', 'CASWR120', 'ENGEK100', 'ENGEK125']) {
    const item = skip(r, key);
    assert.equal(item.reason, 'past', key);
    assert.equal(item.why, 'past');
    assert.equal(item.unmet, true);
    assert.equal(item.slot, 0);
  }
  assert.deepEqual(r.stashAdd, ['CASMA123', 'CASWR120', 'ENGEK100', 'ENGEK125']);
  const placeholder = r.skipped.find((item) => item.type === 'placeholder' && item.slot === 0);
  assert.equal(placeholder.reason, 'past');
  assert.equal(placeholder.label, 'Natural Science Elective');
  assert.equal(r.changed, true);
});

test('skip reason "past" for a Marine term, and the courses are stashed too', () => {
  const semesters = empty();
  semesters[4] = createMarineTerm();
  const r = seed(semesters);
  const item = skip(r, 'ENGEC311');
  assert.equal(item.reason, 'past');
  assert.equal(item.why, 'marine');
  assert.ok(r.stashAdd.includes('ENGEC311'));
});

test('skip reason "in-plan": a course already anywhere in the plan, and a repeated plain placeholder', () => {
  const semesters = empty();
  semesters[6] = [normalizeCourseEntry('CASMA123')];
  const r = seed(semesters);
  assert.equal(skip(r, 'CASMA123').reason, 'in-plan');
  const program = { ...EE, sequence: { slots: [{ placeholders: [{ label: 'Free' }] }] } };
  const again = seedSequence({ programDef: program, semesters: [[createFillsPlaceholder('Free', undefined)]] });
  assert.equal(again.skipped[0].reason, 'in-plan');
  assert.equal(again.changed, false);
});

test('skip reason "satisfied": by a course in the plan (WR 152 for WR 151)', () => {
  const semesters = empty();
  semesters[1] = [normalizeCourseEntry('CASWR152')];
  const item = skip(seed(semesters), 'CASWR151');
  assert.equal(item.reason, 'satisfied');
  assert.equal(item.by, 'course');
  assert.deepEqual(item.via, ['CASWR152']);
});

test('skip reason "satisfied": by external credit (AP Calc BC) or substitution', () => {
  const credit = skip(seed(empty(), { externalCredits: [{ courseKey: 'CASMA123+CASMA124' }] }), 'CASMA124');
  assert.deepEqual([credit.reason, credit.by, credit.via], ['satisfied', 'credit', ['CASMA124']]);
  const overrides = { 'ee-bs-required': { type: 'substitute', substitutions: [{ label: 'Transfer calc', for: 'CASMA124' }] } };
  const petition = skip(seed(empty(), { overrides }), 'CASMA124');
  assert.deepEqual([petition.reason, petition.by], ['satisfied', 'substitution']);
});

test('skip reason "no-need": placeholders beyond what the engine still has open', () => {
  const semesters = empty();
  semesters[4] = [normalizeCourseEntry('ENGEC402'), normalizeCourseEntry('ENGEC412')];
  const r = seed(semesters);
  const core = r.skipped.filter((item) => item.type === 'placeholder' && item.fills === 'ee-bs-core-electives');
  assert.equal(core.length, 2);
  assert.ok(core.every((item) => item.reason === 'no-need'));
});

test('skip reason "duplicate": a course listed twice in the sequence', () => {
  const program = { ...EE, sequence: { slots: [{ courses: ['CASMA123'] }, { courses: ['CASMA123'] }] } };
  const r = seedSequence({ programDef: program, semesters: empty() });
  assert.equal(r.addedCourses.length, 1);
  assert.equal(r.skipped[0].reason, 'duplicate');
});

test('a past term with a satisfied course: reported as satisfied, NOT stashed (AP Calc BC)', () => {
  const r = seed(empty(), { externalCredits: [{ courseKey: 'CASMA123+CASMA124' }], isSlotSeedable: (i) => i >= 1 });
  assert.equal(skip(r, 'CASMA123').reason, 'satisfied');
  assert.ok(!r.stashAdd.includes('CASMA123'));
  assert.ok(r.stashAdd.includes('CASWR120'));
});

test('stash dedupe: a skipped course already stashed is not added again', () => {
  const r = seed(empty(), { isSlotSeedable: (i) => i >= 1, stash: ['CASMA123'] });
  assert.ok(!r.stashAdd.includes('CASMA123'));
  assert.deepEqual(r.stashAlready, ['CASMA123']);
  assert.equal(new Set(r.stashAdd).size, r.stashAdd.length);
});

test('nothing skipped: a start-term plan with every term open reports no skips for term reasons', () => {
  const r = seed(empty());
  assert.ok(r.skipped.every((item) => item.reason !== 'past'));
  assert.deepEqual(r.stashAdd, []);
  assert.deepEqual(r.filledSlots, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('toast copy: filled terms, the skipped term with its courses and placeholder, stash note, covered count', () => {
  const r = seed(empty(), { isSlotSeedable: (i) => i >= 1, externalCredits: [{ courseKey: 'CASMA124' }] });
  const text = msg(r);
  assert.equal(text, 'Filled 7 terms. Skipped Fall 2026 (before your start): MA 123, WR 120, EK 100, EK 125, plus a Natural Science elective. Added the courses to Paw-tential Courses. 1 already covered.');
  assert.equal(msg(seed(empty())), 'Filled 8 terms.');
  assert.equal(msg(seed(seed(empty()).semesters)), 'Your plan already has everything from the standard plan.');
  const already = msg(seed(empty(), { isSlotSeedable: (i) => i >= 1, stash: ['CASMA123', 'CASWR120', 'ENGEK100', 'ENGEK125'] }));
  assert.match(already, /already in Paw-tential Courses/);
});

test('Undo state keeps the stash from before the change', () => {
  const undo = createUndo(1, [[]], ['CASMA123']);
  assert.deepEqual(undo.stash, ['CASMA123']);
  assert.equal(createUndo(2, [[]]).stash, null);
});

// ── Seeding counts what the tracker counts ──────────────────────────────────

test('a course in completedCourseKeys but not in the plan is placed like any other', () => {
  // completedCourseKeys is not an input: it only locks plan courses, it never satisfies a slot.
  const r = seed(empty(), { completedCourseKeys: ['CASMA242', 'CASMA581', 'CASMA226'] });
  const keys = allKeys(r.semesters);
  for (const key of ['ENGEK103', 'ENGEK381', 'CASMA226']) assert.ok(keys.includes(key), key);
  assert.ok(!r.skipped.some((item) => item.by === 'completed'));
  assert.equal(r.addedCourses.length, 23);
});

test('the same course satisfied by an external credit is skipped', () => {
  const r = seed(empty(), { externalCredits: [{ courseKey: 'CASMA226' }, { manualCourses: ['CASMA242'] }] });
  assert.ok(!allKeys(r.semesters).includes('CASMA226'));
  assert.equal(skip(r, 'CASMA226').by, 'credit');
  assert.equal(skip(r, 'ENGEK103').by, 'credit', 'MA 242 (a manual override) fills the EK 103 slot');
});

test('a plan that already contains MA 242 skips EK 103', () => {
  const semesters = empty();
  semesters[3] = [normalizeCourseEntry('CASMA242')];
  const item = skip(seed(semesters), 'ENGEK103');
  assert.deepEqual([item.reason, item.by, item.via], ['satisfied', 'course', ['CASMA242']]);
});

test('the toast counts credits, plan courses and substitutions as covered, not completed courses', () => {
  const text = msg(seed(empty(), { completedCourseKeys: ['CASMA242', 'CASMA226'], externalCredits: [{ courseKey: 'CASMA124' }] }));
  assert.equal(text, 'Filled 8 terms. 1 already covered.');
});

test('seeding and the tracker use the same key list: requirementsPlanKeys', () => {
  const input = {
    semesters: [[normalizeCourseEntry('CASMA123')], [createFillsPlaceholder('x', undefined)]],
    gridSummerTerms: { 0: [normalizeCourseEntry('CASPY211')] },
    extraTerms: [{ term: 'Summer 2021', season: 'summer', courseKeys: ['CASWR120'] }],
    externalCredits: [{ courseKey: 'CASMA124+CASMA225' }, { manualCourseKey: 'ENGEK210' }, { courseKey: null }],
  };
  assert.deepEqual(requirementsPlanKeys(input), ['CASMA123', 'CASWR120', 'CASPY211', 'CASMA124', 'CASMA225', 'ENGEK210']);
  const r = seed(input.semesters, { gridSummerTerms: input.gridSummerTerms, extraTerms: input.extraTerms, externalCredits: input.externalCredits });
  const placed = allKeys(r.semesters);
  for (const key of requirementsPlanKeys(input)) assert.equal(placed.filter((k) => k === key).length <= 1, true, key);
  for (const key of ['CASMA124', 'CASMA225', 'ENGEK210', 'CASPY211', 'CASWR120']) {
    assert.ok(!r.addedCourses.some((c) => c.courseKey === key), `${key} not re-added`);
  }
  const planner = readFileSync(new URL('../pages/PlannerPage.jsx', import.meta.url), 'utf8');
  assert.match(planner, /requirementsCourseKeys = useMemo\(\s*\(\) => requirementsPlanKeys\(/);
  assert.doesNotMatch(planner, /externalCredits\.flatMap\(externalCreditCourseKeys\)/);
});

test('view nodes take no placeholders: a fills naming one (or a node inside one) fails validation, takeover never picks it', () => {
  const program = {
    programName: 'T', degree: 'BS', totalCoursesRequired: 2,
    tree: {
      id: 'root', type: 'ALL', label: 'Root', children: [
        { id: 'electives', type: 'COUNT', label: 'Electives', min: 2, pool: [{ type: 'COURSE_RANGE', subject: 'QSTFE', min: 300, max: 599 }] },
        { id: 'conc', type: 'ALL', label: 'Concentration', claims: 'view', viewOf: ['electives'], children: [
          { id: 'conc-b', type: 'COUNT', label: 'B', min: 1, pool: ['QSTFE449'] },
        ] },
      ],
    },
    sequence: { slots: [{ placeholders: [
      { label: 'Elective', fills: 'electives' },
      { label: 'Concentration', fills: 'conc' },
      { label: 'Concentration B', fills: 'conc-b' },
    ] }] },
  };
  assert.deepEqual(validateSequence(program), [
    'slot 0: fills "conc" is not a node id of this program',
    'slot 0: fills "conc-b" is not a node id of this program',
  ]);
  assert.equal(nodeAcceptsCourse(program, 'conc-b', 'QSTFE449'), false);
  assert.equal(nodeAcceptsCourse(program, 'electives', 'QSTFE449'), true);
});
