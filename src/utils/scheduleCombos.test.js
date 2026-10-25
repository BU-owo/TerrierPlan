// Run with: node --test src/utils/scheduleCombos.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationSlots, generateSchedules, generateSchedulesAsync, pinInGroup, scheduleStats, sortSchedules, scheduleSummary, scheduleChipLabel, bookmarkChipStates, bookmarkStep, MAX_EXPLORED, MAX_RESULTS } from './scheduleCombos.js';
import { UNKNOWN_KEY } from './sectionComponents.js';
import { sectionsConflict } from './sectionTime.js';

const sec = (id, component, daysOfWeek, startTime, endTime) => ({
  id, courseKey: 'A', component, componentLabel: component, daysOfWeek, startTime, endTime,
});

// l0 and l1 overlap; l2 doesn't overlap either. One discussion, no overlap.
const sections = [
  sec('l0', 'LEC', 'Mon Wed', '10:10AM', '11:00AM'),
  sec('l1', 'LEC', 'Mon Wed', '10:30AM', '11:20AM'),
  sec('l2', 'LEC', 'Tue Thu', '10:10AM', '11:00AM'),
  sec('d0', 'DIS', 'Fri', '02:30PM', '03:20PM'),
  sec('o0', '', 'Mon', '05:00PM', '06:00PM'),
  sec('o1', '', 'Tue', '05:00PM', '06:00PM'),
];
const sectionsById = Object.fromEntries(sections.map((s) => [s.id, s]));
const sectionsByCourse = { A: sections };
const isLec = (id) => sectionsById[id].component === 'LEC';

test('pinning a second LEC replaces the first, which goes back to checked', () => {
  let course = { courseKey: 'A', considering: { LEC: ['l0', 'l1'], DIS: ['d0'] }, locked: [] };
  course = pinInGroup(course, 'LEC', 'l0', sectionsById);
  assert.deepEqual(course.locked, ['l0']);
  assert.deepEqual(course.considering.LEC, []);
  course = pinInGroup(course, 'LEC', 'l2', sectionsById);
  assert.deepEqual(course.locked, ['l2']);
  assert.deepEqual(course.considering.LEC, ['l0']);
  assert.deepEqual(course.considering.DIS, ['d0']);
});

test('pins in other components are kept', () => {
  let course = { courseKey: 'A', considering: {}, locked: ['d0', 'l0'] };
  course = pinInGroup(course, 'LEC', 'l1', sectionsById);
  assert.deepEqual(course.locked, ['d0', 'l1']);
});

test('two pins in the "Other" group both stay', () => {
  let course = { courseKey: 'A', considering: { [UNKNOWN_KEY]: ['o1'] }, locked: [] };
  course = pinInGroup(course, UNKNOWN_KEY, 'o0', sectionsById);
  course = pinInGroup(course, UNKNOWN_KEY, 'o1', sectionsById);
  assert.deepEqual(course.locked, ['o0', 'o1']);
  assert.deepEqual(course.considering[UNKNOWN_KEY], []);
});

test('two pinned LECs (old draft) generate schedules with exactly one LEC', () => {
  const draft = [{ courseKey: 'A', considering: { DIS: ['d0'], [UNKNOWN_KEY]: ['o0'] }, locked: ['l0', 'l2'] }];
  const slots = buildGenerationSlots(draft, sectionsByCourse, sectionsById);
  assert.deepEqual(slots.map((s) => s.options), [['l0', 'l2'], ['d0'], ['o0']]);
  const { schedules } = generateSchedules(slots, sectionsById);
  assert.equal(schedules.length, 2);
  for (const ids of schedules) assert.equal(ids.filter(isLec).length, 1);
});

test('overlapping pinned LECs still produce schedules', () => {
  const draft = [{ courseKey: 'A', considering: { DIS: ['d0'], [UNKNOWN_KEY]: ['o0'] }, locked: ['l0', 'l1'] }];
  const { schedules } = generateSchedules(buildGenerationSlots(draft, sectionsByCourse, sectionsById), sectionsById);
  assert.equal(schedules.length, 2);
  for (const ids of schedules) assert.equal(ids.filter(isLec).length, 1);
});

test('one pin stays forced; "Other" pins are each forced', () => {
  const draft = [{ courseKey: 'A', considering: { LEC: ['l1'], DIS: ['d0'] }, locked: ['l0', 'o0', 'o1'] }];
  const slots = buildGenerationSlots(draft, sectionsByCourse, sectionsById);
  assert.deepEqual(slots.map((s) => s.options), [['l0'], ['d0'], ['o0'], ['o1']]);
});

test('same picks in a different click order give identical ordered results', () => {
  const a = { courseKey: 'A', considering: { LEC: ['l0', 'l1', 'l2'], DIS: ['d0'] }, locked: ['o0', 'o1'] };
  const b = { courseKey: 'A', considering: { LEC: ['l2', 'l0', 'l1'], DIS: ['d0'] }, locked: ['o1', 'o0'] };
  const run = (course) => generateSchedules(buildGenerationSlots([course], sectionsByCourse, sectionsById), sectionsById);
  const first = run(a);
  assert.ok(first.schedules.length > 1);
  assert.deepEqual(run(b), first);
});

// The search generateSchedules used before fewest-options-first and forward
// checking, kept here only as a reference: slot by slot in the given order,
// each candidate checked against everything already picked.
function referenceSearch(slots, sectionsById, limit = MAX_RESULTS) {
  const lists = slots.filter((s) => s.options.length > 0).map((s) => s.options);
  const schedules = [];
  let explored = 0;
  let truncated = false;
  function backtrack(i, chosen) {
    if (i === lists.length) {
      schedules.push([...chosen]);
      if (schedules.length >= limit) truncated = true;
      return;
    }
    for (const sectionId of lists[i]) {
      if (truncated) return;
      explored++;
      if (explored > MAX_EXPLORED) {
        truncated = true;
        return;
      }
      const candidate = sectionsById[sectionId];
      if (!candidate) continue;
      if (chosen.some((id) => sectionsConflict(sectionsById[id], candidate))) continue;
      chosen.push(sectionId);
      backtrack(i + 1, chosen);
      chosen.pop();
    }
  }
  if (lists.length > 0) backtrack(0, []);
  return { schedules, truncated, explored };
}

const asSet = (schedules) => schedules.map((ids) => ids.join('|')).sort();

// Same set as the reference search, sorted by id tuple, and the async
// version returns exactly what the sync one does.
async function assertMatchesReference(slots, byId, yieldEvery = 3) {
  const expected = referenceSearch(slots, byId);
  const actual = generateSchedules(slots, byId);
  assert.equal(expected.truncated, false);
  assert.equal(actual.truncated, false);
  assert.deepEqual(asSet(actual.schedules), asSet(expected.schedules));
  const keys = actual.schedules.map((ids) => ids.join('|'));
  assert.deepEqual(keys, [...keys].sort());
  assert.deepEqual(await generateSchedulesAsync(slots, byId, { yieldEvery }), actual);
  return { expected, actual };
}

test('new search finds the same schedules: checked sections only', async () => {
  const draft = [{ courseKey: 'A', considering: { LEC: ['l2', 'l0', 'l1'], DIS: ['d0'], [UNKNOWN_KEY]: ['o1', 'o0'] }, locked: [] }];
  const { actual } = await assertMatchesReference(buildGenerationSlots(draft, sectionsByCourse, sectionsById), sectionsById);
  assert.ok(actual.schedules.length > 1);
});

test('new search finds the same schedules: locked sections', async () => {
  const draft = [{ courseKey: 'A', considering: { LEC: ['l1', 'l2'], DIS: ['d0'] }, locked: ['o0', 'o1'] }];
  const { actual } = await assertMatchesReference(buildGenerationSlots(draft, sectionsByCourse, sectionsById), sectionsById);
  for (const ids of actual.schedules) assert.ok(ids.includes('o0') && ids.includes('o1'));
});

test('new search finds the same schedules: pinned pick-one slot', async () => {
  const draft = [{ courseKey: 'A', considering: { DIS: ['d0'], [UNKNOWN_KEY]: ['o0'] }, locked: ['l1', 'l0', 'l2'] }];
  const slots = buildGenerationSlots(draft, sectionsByCourse, sectionsById);
  assert.deepEqual(slots[0].options, ['l0', 'l1', 'l2']);
  const { actual } = await assertMatchesReference(slots, sectionsById);
  assert.equal(actual.schedules.length, 3);
});

test('new search finds the same schedules: zero-option slot and a missing section', async () => {
  const slots = [{ options: ['l0', 'l2', 'gone'] }, { options: [] }, { options: ['d0'] }];
  const { actual } = await assertMatchesReference(slots, sectionsById);
  assert.deepEqual(actual.schedules, [['l0', 'd0'], ['l2', 'd0']]);
});

test('new search finds the same schedules: no schedule possible', async () => {
  // l0 and l1 overlap and each is the only option in its slot.
  const { actual } = await assertMatchesReference([{ options: ['d0'] }, { options: ['l0'] }, { options: ['l1'] }], sectionsById);
  assert.deepEqual(actual.schedules, []);
});

// 7 courses (4 LECs and 6 DISs each), sections spread over a few
// days and start times so lots of picks conflict. Deterministic, and sized
// so the reference search finishes under MAX_EXPLORED (~107k nodes).
function heavyFixture() {
  let seed = 12345;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const dayPatterns = ['Mon Wed', 'Tue Thu', 'Mon Wed Fri', 'Fri', 'Wed'];
  const clock = (min) => {
    const h = Math.floor(min / 60);
    return `${String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}${h >= 12 ? 'PM' : 'AM'}`;
  };
  const byId = {};
  const slots = [];
  for (let c = 0; c < 7; c++) {
    for (const [kind, count, length] of [['LEC', 4, 75], ['DIS', 6, 50]]) {
      const options = [];
      for (let s = 0; s < count; s++) {
        const id = `c${c}-${kind}-${s}`;
        const start = 8 * 60 + rand(7) * 60;
        byId[id] = { id, courseKey: `C${c}`, component: kind, daysOfWeek: dayPatterns[rand(dayPatterns.length)], startTime: clock(start), endTime: clock(start + length) };
        options.push(id);
      }
      slots.push({ options });
    }
  }
  return { slots, byId };
}

test('heavy draft: same schedules as the reference, visiting fewer nodes', async () => {
  const { slots, byId } = heavyFixture();
  const { expected, actual } = await assertMatchesReference(slots, byId, 500);
  assert.ok(actual.schedules.length > 0);
  assert.ok(actual.explored < expected.explored, `new ${actual.explored} vs reference ${expected.explored}`);
});

// ── Schedule sort ────────────────────────────────────────────────────────────
const mk = (id, daysOfWeek, startTime, endTime, extra = {}) => ({ id, courseKey: 'S', daysOfWeek, startTime, endTime, ...extra });
const sortSecs = [
  mk('mwf9', 'Mon Wed Fri', '09:00AM', '09:50AM'),
  mk('tr2', 'Tue Thu', '02:00PM', '03:15PM'),
  mk('mwf1', 'Mon Wed Fri', '01:00PM', '01:50PM'),
  mk('tr8', 'Tue Thu', '08:00AM', '09:15AM'),
  mk('exam', '', '', '', { meetings: [{ kind: 'exam', daysOfWeek: 'Mon', startTime: '08:00AM', endTime: '10:00AM' }] }),
  mk('tba', '', '', ''),
  // overlapping meetings on Monday: 9-12, 10-10:50, 11-12
  mk('big', 'Mon', '09:00AM', '12:00PM'),
  mk('mid', 'Mon', '10:00AM', '10:50AM'),
  mk('late', 'Mon', '11:00AM', '12:00PM'),
  mk('mon2', 'Mon', '01:00PM', '02:00PM'),
  mk('fri8', 'Fri', '08:00AM', '08:50AM'),
  mk('mwf10', 'Mon Wed Fri', '10:00AM', '10:50AM'),
  mk('tr10', 'Tue Thu', '10:00AM', '11:15AM'),
  mk('mon9', 'Mon', '09:00AM', '09:50AM'),
  mk('mwf9b', 'Mon Wed Fri', '09:00AM', '09:50AM'),
];
const byId = Object.fromEntries(sortSecs.map((s) => [s.id, s]));

test('scheduleStats: MWF + TR mix counts a MWF section on each of its days', () => {
  const st = scheduleStats(['mwf9', 'tr2'], byId);
  assert.equal(st.days, 5);
  assert.equal(st.firstStart, 540);
  assert.equal(st.lastEnd, 915);
  // Mon/Wed/Fri start 9:00 (540), Tue/Thu start 14:00 (840)
  assert.equal(st.avgStart, (3 * 540 + 2 * 840) / 5);
  // Mon/Wed/Fri end 9:50 (590), Tue/Thu end 15:15 (915)
  assert.equal(st.avgFinish, (3 * 590 + 2 * 915) / 5);
  assert.equal(st.gap, 0);
});

test('scheduleStats: gap sums per weekday, then across weekdays', () => {
  // MWF 9:00-9:50 and 1:00-1:50 -> 190 min gap on each of 3 days
  assert.equal(scheduleStats(['mwf9', 'mwf1'], byId).gap, 3 * 190);
});

test('scheduleStats: overlapping meetings use the latest end so far', () => {
  // 9-12, 10-10:50, 11-12, then 1pm: only the 12->1 hour is a gap
  assert.equal(scheduleStats(['big', 'mid', 'late', 'mon2'], byId).gap, 60);
  // Order of ids doesn't matter
  assert.equal(scheduleStats(['mon2', 'late', 'mid', 'big'], byId).gap, 60);
});

test('scheduleStats: exam-only and no-meeting sections are ignored', () => {
  assert.equal(scheduleStats(['exam', 'tba'], byId), null);
  assert.deepEqual(scheduleStats(['exam', 'tba', 'tr2'], byId), scheduleStats(['tr2'], byId));
  assert.equal(scheduleStats(['missing'], byId), null);
});

test('scheduleStats: does not mutate the cached meetings', () => {
  scheduleStats(['mon2', 'big'], byId);
  scheduleStats(['mon2', 'big'], byId);
  assert.equal(scheduleStats(['big'], byId).avgStart, 540);
});

const MODES = ['latestFirstStart', 'earliestLastEnd', 'fewestDays', 'leastGap'];

test('scheduleStats: firstStart / lastEnd are week-wide extremes', () => {
  const st = scheduleStats(['fri8', 'tr2'], byId);
  assert.equal(st.firstStart, 480);
  assert.equal(st.lastEnd, 915);
});

test('latest start: one early day beats several moderately late days (not the mean)', () => {
  const x = ['fri8', 'tr2']; // one 8am day, rest at 2pm: avg start 720, first start 480
  const y = ['mwf10', 'tr10']; // every day at 10am: avg start 600, first start 600
  assert.deepEqual(sortSchedules([x, y], 'latestFirstStart', byId), [y, x]);
});

test('latest start: equal first start is broken by the mean of daily first starts, descending', () => {
  const p = ['mon9', 'tr2']; // first start 540, avg (540+840+840)/3 = 740
  const q = ['mwf9', 'tr2']; // first start 540, avg 660
  assert.deepEqual(sortSchedules([p, q], 'latestFirstStart', byId), [p, q]);
});

test('earliest end: latest end of the week first, tie broken by mean daily last end', () => {
  const d = ['fri8']; // last end 530
  const a = ['mon9', 'tr8']; // last end 590, avg finish (590+555+555)/3 ~ 566.7
  const b = ['mwf9', 'tr8']; // last end 590, avg finish (3*590+2*555)/5 = 576
  const c = ['tr2']; // last end 915
  assert.deepEqual(sortSchedules([c, b, a, d], 'earliestLastEnd', byId), [d, a, b, c]);
});

test('fewest days and least time between classes', () => {
  const one = ['tr8', 'tr2']; // 2 days, gap 2 * (840 - 555)
  const mwf = ['mwf9', 'mwf1']; // 3 days, gap 3 * 190
  const mix = ['mwf9', 'tr2']; // 5 days, no gap
  assert.deepEqual(sortSchedules([mix, mwf, one], 'fewestDays', byId), [one, mwf, mix]);
  assert.deepEqual(sortSchedules([one, mwf, mix], 'leastGap', byId), [mix, mwf, one]);
});

test('ties on every key keep the id-tuple order, whatever the incoming order', () => {
  const a = ['mwf9', 'tr2'];
  const b = ['mwf9b', 'tr2']; // identical times
  for (const mode of MODES) {
    assert.deepEqual(sortSchedules([b, a], mode, byId), [a, b], mode);
    assert.deepEqual(sortSchedules([a, b], mode, byId), [a, b], mode);
  }
});

test('a schedule with no timed classes is last in every mode', () => {
  const untimed = ['exam', 'tba'];
  for (const mode of MODES) {
    assert.deepEqual(sortSchedules([untimed, ['tr2'], ['mwf9']], mode, byId).at(-1), untimed, mode);
    assert.deepEqual(sortSchedules([['tr2'], untimed], mode, byId)[1], untimed, mode);
  }
});

test('default is the id-tuple order, an unknown or removed mode falls back to it, and input is not mutated', () => {
  const input = [['tr8', 'tr2'], ['mwf1', 'tr8'], ['mwf9', 'tr2']];
  const copy = input.map((x) => [...x]);
  const expected = [['mwf1', 'tr8'], ['mwf9', 'tr2'], ['tr8', 'tr2']];
  assert.deepEqual(sortSchedules(input, 'default', byId), expected);
  assert.deepEqual(sortSchedules(input, 'earliestFinish', byId), expected);
  assert.deepEqual(sortSchedules(input, 'earliestFirstStart', byId), expected);
  assert.deepEqual(sortSchedules(input, 'nonsense', byId), expected);
  assert.deepEqual(input, copy);
});

test('scheduleSummary: days and first start to last end', () => {
  // MWF 9:00-9:50 and 1:00-1:50: 3 days, 9:00am to 1:50pm
  assert.equal(scheduleSummary(['mwf9', 'mwf1'], byId), '3 days · 9:00am–1:50pm');
  // Single day uses the singular
  assert.equal(scheduleSummary(['big', 'mid', 'late'], byId), '1 day · 9:00am–12:00pm');
  // Gap time no longer appears in the summary
  assert.equal(scheduleSummary(['mon9', 'mon2'], byId), '1 day · 9:00am–2:00pm');
});

test('scheduleSummary: nothing for a schedule with no timed classes', () => {
  assert.equal(scheduleSummary(['exam', 'tba'], byId), '');
  assert.equal(scheduleSummary([], byId), '');
});

test('scheduleChipLabel: numbered, compact, am/pm dropped from the start when it matches the end', () => {
  // 9:00am-1:50pm differs, so both keep their am/pm
  assert.equal(scheduleChipLabel(['mwf9', 'mwf1'], byId, 1), '1 · 3d · 9:00am–1:50pm');
  // 9:00am-12:00pm differs too
  assert.equal(scheduleChipLabel(['big', 'mid', 'late'], byId, 2), '2 · 1d · 9:00am–12:00pm');
  // 1:00pm-3:15pm share pm: "1:00–3:15pm"
  assert.equal(scheduleChipLabel(['mwf1', 'tr2'], byId, 3), '3 · 5d · 1:00–3:15pm');
  // 8:00-9:15am share am
  assert.equal(scheduleChipLabel(['tr8'], byId, 4), '4 · 2d · 8:00–9:15am');
});

test('scheduleChipLabel: "No times" with no timed classes, and no number when omitted', () => {
  assert.equal(scheduleChipLabel(['exam', 'tba'], byId, 5), '5 · No times');
  assert.equal(scheduleChipLabel([], byId, 1), '1 · No times');
  assert.equal(scheduleChipLabel(['tr8'], byId), '2d · 8:00–9:15am');
});

const bm = (ids) => ({ key: [...ids].sort().join('|'), sectionIds: ids });

test('bookmarkChipStates: in results and fine', () => {
  const states = bookmarkChipStates([bm(['mwf9', 'tr2'])], new Set(['mwf9|tr2']), byId, new Set(['S']));
  assert.deepEqual(states['mwf9|tr2'], { inBatch: true, stale: false, staleReason: null });
});

test('bookmarkChipStates: not in the current results', () => {
  const states = bookmarkChipStates([bm(['mwf9', 'tr2'])], new Set(['other']), byId, new Set(['S']));
  assert.deepEqual(states['mwf9|tr2'], { inBatch: false, stale: false, staleReason: null });
});

test('bookmarkChipStates: a null batch counts everything as in results', () => {
  const states = bookmarkChipStates([bm(['mwf9'])], null, byId, new Set(['S']));
  assert.equal(states.mwf9.inBatch, true);
});

test('bookmarkChipStates: course removed from the draft', () => {
  const states = bookmarkChipStates([bm(['mwf9'])], new Set(['mwf9']), byId, new Set(['OTHER']));
  assert.deepEqual(states.mwf9, { inBatch: true, stale: true, staleReason: 'course removed' });
});

test('bookmarkChipStates: a missing or cancelled section is "section changed"', () => {
  const withCancelled = { ...byId, tr2: { ...byId.tr2, classStat: 'Cancelled' } };
  assert.equal(bookmarkChipStates([bm(['mwf9', 'tr2'])], null, withCancelled, new Set(['S']))['mwf9|tr2'].staleReason, 'section changed');
  assert.equal(bookmarkChipStates([bm(['mwf9', 'gone'])], null, byId, new Set(['S']))['gone|mwf9'].staleReason, 'section changed');
});

test('bookmarkStep: in the middle, first and last', () => {
  assert.deepEqual(bookmarkStep(['a', 'b', 'c'], 'b'), { n: 2, prevKey: 'a', nextKey: 'c' });
  assert.deepEqual(bookmarkStep(['a', 'b', 'c'], 'a'), { n: 1, prevKey: null, nextKey: 'b' });
  assert.deepEqual(bookmarkStep(['a', 'b', 'c'], 'c'), { n: 3, prevKey: 'b', nextKey: null });
});

test('bookmarkStep: not bookmarked goes to the first (Next) and last (Prev)', () => {
  assert.deepEqual(bookmarkStep(['a', 'b', 'c'], 'zzz'), { n: 0, prevKey: 'c', nextKey: 'a' });
  assert.deepEqual(bookmarkStep(['a', 'b'], null), { n: 0, prevKey: 'b', nextKey: 'a' });
});

test('bookmarkStep: one bookmark and none', () => {
  assert.deepEqual(bookmarkStep(['a'], 'a'), { n: 1, prevKey: null, nextKey: null });
  assert.deepEqual(bookmarkStep(['a'], 'x'), { n: 0, prevKey: 'a', nextKey: 'a' });
  assert.deepEqual(bookmarkStep([], 'a'), { n: 0, prevKey: null, nextKey: null });
});
