// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlanPayload, creditLabel, extraTermsCredits, summarizeTerm, termTitle, termsCreditTotal, totalsFootnote,
  visibleEntries, yearMinHeight,
} from './planPdfModel.js';
import { createMarineTerm, isMarineTerm, normalizeSemesters, placeCourse } from './courseEntry.js';
import { sanitizePlanBlob } from './planImport.js';

const FALL = 0;
const SPRING = 1;
const ph = (id, credits = 4, text = 'Marine Semester course') => ({ kind: 'note', id, text, credits });
const note = (id, text, credits) => ({ kind: 'note', id, text, credits });
const course = (courseKey) => ({ courseKey, locked: false, source: 'manual' });
const marker = { kind: 'note', id: 'm', text: 'Marine Semester', credits: 0, blockType: 'marine' };
const creditsMap = { CASBI511: 4, CASBI569: 4, CASCS111: 4, CASMA123: 4 };

test('the Marine marker is never a printed row; placeholders and courses are', () => {
  const entries = [marker, course('CASBI511'), ph('a'), ph('b'), ph('c')];
  const shown = visibleEntries(entries, FALL);
  assert.equal(shown.length, 4);
  assert.ok(!shown.some((e) => e.blockType === 'marine'));
  const t = summarizeTerm(entries, creditsMap, FALL);
  assert.equal(t.rows.length, 4);
  assert.ok(t.rows.every((r) => r.entry.blockType !== 'marine'));
});

test('a degraded marker (a plain note) is hidden in a Marine term, and only there', () => {
  const degraded = { kind: 'note', id: 'd', text: 'Marine Semester', credits: 0 };
  assert.deepEqual(visibleEntries([degraded, ph('a')], FALL), [ph('a')]);
  assert.equal(visibleEntries([degraded], FALL).length, 1, 'alone it is not a Marine term: just a note');
  assert.equal(visibleEntries([degraded, ph('a')], SPRING).length, 2);
});

test('the Marine label uses the board derivation: marker, Marine-only courses, mixed terms', () => {
  assert.equal(summarizeTerm(createMarineTerm(), creditsMap, FALL).marine, true);
  assert.equal(summarizeTerm([course('CASBI511')], creditsMap, FALL).marine, true, 'Marine-only course, no marker');
  assert.equal(summarizeTerm([marker, ph('a'), course('CASCS111')], creditsMap, FALL).marine, true, 'mixed term');
  assert.equal(summarizeTerm([course('CASCS111')], creditsMap, FALL).marine, false);
  assert.equal(summarizeTerm([marker, ph('a')], creditsMap, SPRING).marine, false, 'only Falls');
  assert.equal(summarizeTerm([course('CASBI511')], creditsMap, SPRING).marine, false);
  assert.equal(summarizeTerm([course('CASBI511')], creditsMap).marine, false, 'Summer halves have no slot');
  // Always agrees with isMarineTerm.
  for (const entries of [[], [marker], [marker, ph('a')], ['CASBI511'], [course('CASEE557')]]) {
    for (const slot of [FALL, SPRING, 2, 3]) {
      assert.equal(summarizeTerm(entries, creditsMap, slot).marine, isMarineTerm(entries, slot));
    }
  }
  assert.deepEqual(termTitle('Fall', true), { name: 'FALL', label: 'Marine Semester' });
  assert.deepEqual(termTitle('Spring', false), { name: 'SPRING', label: null });
});

test('term credits: a Marine term is 16 (marker 0, placeholders once); a course replaces a placeholder', () => {
  assert.equal(summarizeTerm(createMarineTerm(), creditsMap, FALL).known, 16);
  const withCourse = placeCourse(createMarineTerm(), 'CASBI511', FALL).entries;
  assert.equal(summarizeTerm(withCourse, creditsMap, FALL).known, 16);
  // Even an unnormalized marker still carrying 16 adds nothing.
  assert.equal(summarizeTerm([{ ...marker, credits: 16 }, ph('a')], creditsMap, FALL).known, 4);
  // An unknown course makes the total a lower bound.
  const unknown = summarizeTerm([course('CASZZ999'), ph('a')], creditsMap, FALL);
  assert.deepEqual([unknown.known, unknown.unknown], [4, 1]);
  assert.equal(creditLabel(unknown.known, unknown.unknown), '4+ cr');
  assert.equal(creditLabel(0, 0), '0 cr', 'an empty term prints 0 cr');
  assert.equal(summarizeTerm([], creditsMap, SPRING).known, 0);
});

// The plan from the report: Year 1 Fall 16 + Year 1 Spring 12 + Year 2 Fall 16 + Year 2 Spring 8 = 52,
// with 4 cr of external credit making the planner header say 56.
function reportPlan() {
  const semesters = [
    createMarineTerm(),
    [course('CASCS111'), course('CASMA123'), note('n1', 'Elective', 4)],
    placeCourse(createMarineTerm(), 'CASBI511', FALL).entries,
    [note('n2', 'Elective', 4), note('n3', 'Elective', 4)],
    [], [], [], [],
  ];
  return semesters;
}

test('the term totals of the report plan add up to 52, and the footnote explains the extra 4', () => {
  const semesters = reportPlan();
  const per = semesters.map((e, i) => summarizeTerm(e, creditsMap, i).known);
  assert.deepEqual(per.slice(0, 4), [16, 12, 16, 8]);
  const terms = termsCreditTotal(semesters, {}, creditsMap);
  assert.deepEqual(terms, { known: 52, unknown: 0 });
  // Planner total 56 = 52 + 4 external.
  assert.equal(
    totalsFootnote({ totalCredits: 56, termsKnown: 52, externalTotal: 4 }),
    'Total credits: 52 cr in terms + 4 cr AP/IB/transfer credit.',
  );
  // Without the external figure the leftover is reported, not hidden.
  assert.equal(totalsFootnote({ totalCredits: 56, termsKnown: 52 }), 'Total credits: 52 cr in terms + 4 cr other credit.');
  // Summer/Winter courses count in the total but aren't drawn.
  assert.equal(
    totalsFootnote({ totalCredits: 56, termsKnown: 52, extraKnown: 4, externalTotal: 0 }),
    'Total credits: 52 cr in terms + 4 cr in Summer/Winter terms (not shown).',
  );
  assert.equal(
    totalsFootnote({ totalCredits: 60, termsKnown: 52, extraKnown: 4, externalTotal: 4 }),
    'Total credits: 52 cr in terms + 4 cr in Summer/Winter terms (not shown) + 4 cr AP/IB/transfer credit.',
  );
});

test('no footnote when the numbers already agree; a lower bound keeps its "+"', () => {
  assert.equal(totalsFootnote({ totalCredits: 52, termsKnown: 52, externalTotal: 0 }), null);
  assert.equal(totalsFootnote({ totalCredits: 0, termsKnown: 0 }), null);
  assert.equal(totalsFootnote({ totalCredits: 56, termsKnown: 52, termsUnknown: 1, externalTotal: 4 }), 'Total credits: 52+ cr in terms + 4 cr AP/IB/transfer credit.');
});

test('every credit is counted once: header total = term totals + extra + external for the report plan', () => {
  const semesters = reportPlan();
  const terms = termsCreditTotal(semesters, { 0: [note('s', 'Summer course', 4)] }, creditsMap);
  const extra = extraTermsCredits([{ term: 'Winter 2028', courseKeys: ['CASCS111', 'CASZZ999'] }], creditsMap);
  assert.equal(terms.known, 56);
  assert.equal(extra, 4, 'unknown credits count 0');
  assert.equal(terms.known + extra + 4, 64);
});

test('an empty year is at least as tall as its rotated label', () => {
  // "YEAR 3" in 8.5pt Helvetica-Bold is about 33pt long; an empty year body is ~29pt.
  const labelWidth = 33;
  assert.ok(yearMinHeight(labelWidth, 1) >= labelWidth + 12);
  assert.equal(yearMinHeight(33, 1), 47);
  assert.ok(yearMinHeight(33, 0.76) < yearMinHeight(33, 1), 'scales with the page scale');
  assert.ok(yearMinHeight(0, 1) > 0);
});

test('PDF round trip: the embedded plan keeps the marker and re-import recreates the Marine term exactly', () => {
  const semesters = normalizeSemesters([
    placeCourse(createMarineTerm(), 'CASBI511', FALL).entries,
    ['CASCS111'],
  ]);
  const serialized = Object.fromEntries(semesters.map((e, i) => [i, e]));
  const payload = buildPlanPayload({
    now: new Date('2026-10-26T12:00:00Z'), planName: 'My Plan 3', majorBulletinUrl: null, isTransfer: false,
    serializedSemesters: serialized, gridSummerTerms: {}, extraTerms: [], stash: [], requirementOverrides: {},
    completedCourseKeys: [], externalCredits: [{ type: 'ap', credits: 4, advisorNote: 'secret' }],
  });
  // The visible rows have no marker, but the attachment does.
  assert.ok(payload.semesters[0].some((e) => e.blockType === 'marine'));
  assert.equal(visibleEntries(semesters[0], FALL).some((e) => e.blockType === 'marine'), false);
  assert.ok(!('advisorNote' in payload.student.externalCredits[0]));
  const imported = sanitizePlanBlob(JSON.parse(JSON.stringify(payload)), { catalogIds: new Set(['CASBI511', 'CASCS111']), programs: [] });
  assert.deepEqual(imported.errors, []);
  const term = imported.plan.semesters[0];
  assert.equal(term.length, 5);
  assert.equal(term.filter((e) => e.blockType === 'marine').length, 1);
  assert.equal(term.find((e) => e.blockType === 'marine').credits, 0);
  assert.deepEqual(term.filter((e) => e.courseKey).map((e) => e.courseKey), ['CASBI511']);
  assert.equal(term.filter((e) => e.kind === 'note' && !e.blockType && e.text === 'Marine Semester course' && e.credits === 4).length, 3);
  assert.equal(isMarineTerm(term, FALL), true);
  assert.deepEqual(imported.plan.semesters[1].map((e) => e.courseKey), ['CASCS111']);
});

test('legacy shapes in an old PDF still expand to marker + placeholders on import', () => {
  for (const legacy of [{ kind: 'block', blockType: 'marine', id: 'b', credits: 16 }, { kind: 'note', id: 'w', text: 'Marine Semester', credits: 16, blockType: 'marine' }]) {
    const payload = buildPlanPayload({ now: new Date(), planName: 'x', serializedSemesters: { 0: [legacy, 'CASCS111'] } });
    const imported = sanitizePlanBlob(JSON.parse(JSON.stringify(payload)), { catalogIds: new Set(['CASCS111']), programs: [] });
    const term = imported.plan.semesters[0];
    assert.equal(term.filter((e) => e.blockType === 'marine').length, 1);
    assert.equal(term.filter((e) => e.kind === 'note' && !e.blockType).length, 4, 'CS 111 is not a Marine slot course');
    assert.equal(visibleEntries(term, FALL).length, 5, 'four placeholders and the course; no marker row');
  }
});
