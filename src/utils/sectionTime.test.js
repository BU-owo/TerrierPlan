// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDays,
  parseTimeToMinutes,
  sectionMeeting,
  sectionsConflict,
  describeSectionTime,
  describeExamTime,
  compareSectionsByTime,
  getMeetings,
  classMeetings,
  examMeetings,
  sectionMeetings,
  formatClock,
  DAY_ORDER,
} from './sectionTime.js';
import { overlapMinutes, describeSectionSet } from './scheduleCombos.js';
import { passesGlobalFilter, EMPTY_GLOBAL_FILTERS } from './sectionFilters.js';

// ── The single-meeting implementations from before multi-meeting support,
//    copied verbatim, to compare against on sections with no `meetings`. ────
const DAY_LETTER = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'Th', Fri: 'F', Sat: 'Sa', Sun: 'Su' };

function oldSectionMeeting(section) {
  const days = parseDays(section?.daysOfWeek);
  const startMin = parseTimeToMinutes(section?.startTime);
  const endMin = parseTimeToMinutes(section?.endTime);
  if (days.length === 0 || startMin == null || endMin == null) return null;
  return { days, startMin, endMin };
}

function oldSectionsConflict(a, b) {
  const meetingA = oldSectionMeeting(a);
  const meetingB = oldSectionMeeting(b);
  if (!meetingA || !meetingB) return false;
  const sharesDay = meetingA.days.some((d) => meetingB.days.includes(d));
  if (!sharesDay) return false;
  return meetingA.startMin < meetingB.endMin && meetingB.startMin < meetingA.endMin;
}

function oldDescribeSectionTime(section) {
  const meeting = oldSectionMeeting(section);
  if (!meeting) return 'No scheduled meeting';
  const dayLetters = meeting.days.map((d) => DAY_LETTER[d] ?? d).join('');
  return `${dayLetters} ${formatClock(meeting.startMin)}–${formatClock(meeting.endMin)}`;
}

function oldCompareSectionsByTime(a, b) {
  const meetingA = oldSectionMeeting(a);
  const meetingB = oldSectionMeeting(b);
  if (!meetingA && !meetingB) return (a.classSection || '').localeCompare(b.classSection || '');
  if (!meetingA) return 1;
  if (!meetingB) return -1;
  const dayA = Math.min(...meetingA.days.map((d) => DAY_ORDER.indexOf(d)));
  const dayB = Math.min(...meetingB.days.map((d) => DAY_ORDER.indexOf(d)));
  if (dayA !== dayB) return dayA - dayB;
  if (meetingA.startMin !== meetingB.startMin) return meetingA.startMin - meetingB.startMin;
  return (a.classSection || '').localeCompare(b.classSection || '');
}

function oldOverlapMinutes(a, b) {
  const ma = oldSectionMeeting(a);
  const mb = oldSectionMeeting(b);
  if (!ma || !mb) return 0;
  const sharedDays = ma.days.filter((d) => mb.days.includes(d)).length;
  const perDay = Math.min(ma.endMin, mb.endMin) - Math.max(ma.startMin, mb.startMin);
  return sharedDays > 0 && perDay > 0 ? sharedDays * perDay : 0;
}

function oldPassesGlobalFilter(section, globalFilter) {
  const dayBoundsActive = (b) => Boolean(b && (b.startMin != null || b.endMin != null));
  const active = dayBoundsActive(globalFilter.global)
    || (globalFilter.mode === 'custom' && DAY_ORDER.some((d) => dayBoundsActive(globalFilter.perDay[d])));
  if (!active) return true;
  const meeting = oldSectionMeeting(section);
  if (!meeting) return false;
  return meeting.days.every((day) => {
    const bounds = globalFilter.mode === 'custom' && dayBoundsActive(globalFilter.perDay[day])
      ? globalFilter.perDay[day]
      : globalFilter.global;
    if (!dayBoundsActive(bounds)) return true;
    if (bounds.startMin != null && meeting.startMin < bounds.startMin) return false;
    if (bounds.endMin != null && meeting.endMin > bounds.endMin) return false;
    return true;
  });
}
// ── end of copied old logic ────────────────────────────────────────────────

// Small seeded PRNG so a failure is reproducible.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIMES = ['08:00AM', '08:30AM', '09:05AM', '10:10AM', '11:15AM', '12:20PM', '01:25PM', '02:30PM', '03:30PM', '05:00PM', '06:30PM'];
const DAY_SETS = ['Mon Wed Fri', 'Tue Thu', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Mon Wed', 'Sat', ''];

function randomLegacySection(rng, i) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const roll = rng();
  let startTime = pick(TIMES);
  let endTime = pick(TIMES);
  if (roll < 0.08) startTime = '';
  else if (roll < 0.14) endTime = 'TBA';
  return {
    id: `s${i}`,
    classSection: pick(['A1', 'A2', 'B1', 'C1', 'D1']),
    daysOfWeek: pick(DAY_SETS),
    startTime,
    endTime,
    facilId: pick(['', 'SCI 109', 'NO ROOM']),
  };
}

const section = (id, meetings, extra = {}) => ({ id, classSection: id, meetings, ...extra });
const meeting = (daysOfWeek, startTime, endTime, kind) => ({
  daysOfWeek, startTime, endTime, facilId: 'X 1', meetingStartDate: '01/19/2027', meetingEndDate: '04/29/2027', ...(kind ? { kind } : {}),
});

test('no `meetings` field: identical to the old single-meeting functions', () => {
  const rng = makeRng(20270119);
  const sections = Array.from({ length: 300 }, (_, i) => randomLegacySection(rng, i));

  for (const s of sections) {
    assert.deepEqual(sectionMeeting(s), oldSectionMeeting(s));
    assert.equal(describeSectionTime(s), oldDescribeSectionTime(s));
    assert.equal(describeExamTime(s), '');
  }
  let pairs = 0;
  for (let i = 0; i < sections.length; i++) {
    for (let j = 0; j < sections.length; j += 7) {
      if (i === j) continue; // a section never conflicts with itself (new rule)
      pairs++;
      assert.equal(sectionsConflict(sections[i], sections[j]), oldSectionsConflict(sections[i], sections[j]));
      assert.equal(overlapMinutes(sections[i], sections[j]), oldOverlapMinutes(sections[i], sections[j]));
      assert.equal(Math.sign(compareSectionsByTime(sections[i], sections[j])), Math.sign(oldCompareSectionsByTime(sections[i], sections[j])));
    }
  }
  assert.ok(pairs > 10000);

  // Same result when sorting.
  assert.deepEqual(
    [...sections].sort(compareSectionsByTime).map((s) => s.id),
    [...sections].sort(oldCompareSectionsByTime).map((s) => s.id),
  );

  const filters = [
    EMPTY_GLOBAL_FILTERS,
    { mode: 'same', global: { startMin: 11 * 60, endMin: null, activePreset: null }, perDay: EMPTY_GLOBAL_FILTERS.perDay },
    { mode: 'same', global: { startMin: null, endMin: 17 * 60, activePreset: null }, perDay: EMPTY_GLOBAL_FILTERS.perDay },
    { mode: 'same', global: { startMin: 12 * 60, endMin: 17 * 60, activePreset: null }, perDay: EMPTY_GLOBAL_FILTERS.perDay },
    {
      mode: 'custom',
      global: { startMin: 9 * 60, endMin: null, activePreset: null },
      perDay: { ...EMPTY_GLOBAL_FILTERS.perDay, Fri: { startMin: null, endMin: 13 * 60, activePreset: null } },
    },
  ];
  for (const f of filters) {
    for (const s of sections) assert.equal(passesGlobalFilter(s, f), oldPassesGlobalFilter(s, f));
  }
});

test('QST SM 131 GA conflicts with a Friday 8:30 class', () => {
  const ga = section('GA', [meeting('Tue Thu', '08:00AM', '09:15AM'), meeting('Fri', '08:00AM', '08:50AM')]);
  const friday = { id: 'other', daysOfWeek: 'Fri', startTime: '08:30AM', endTime: '09:20AM' };
  assert.equal(sectionsConflict(ga, friday), true);
  assert.equal(sectionsConflict(friday, ga), true);
  assert.ok(overlapMinutes(ga, friday) > 0);
  assert.equal(describeSectionTime(ga), 'TTh 8:00am–9:15am · F 8:00am–8:50am');
  // Doesn't touch a Monday class.
  assert.equal(sectionsConflict(ga, { id: 'm', daysOfWeek: 'Mon', startTime: '08:30AM', endTime: '09:20AM' }), false);
});

test('an exam-kind meeting never conflicts', () => {
  const lecture = section('L', [meeting('Mon Wed Fri', '09:05AM', '09:55AM', 'class'), meeting('Tue', '06:30PM', '08:30PM', 'exam')]);
  const evening = { id: 'e', daysOfWeek: 'Tue', startTime: '07:00PM', endTime: '08:00PM' };
  assert.equal(sectionsConflict(lecture, evening), false);
  assert.equal(sectionsConflict(evening, lecture), false);
  assert.equal(overlapMinutes(lecture, evening), 0);
  // Two exams at the same time don't conflict either.
  const other = section('O', [meeting('Tue', '06:30PM', '08:30PM', 'exam'), meeting('Thu', '09:00AM', '09:50AM')]);
  assert.equal(sectionsConflict(lecture, other), false);
  // ...and the exam is reported separately.
  assert.equal(describeSectionTime(lecture), 'MWF 9:05am–9:55am');
  assert.equal(describeExamTime(lecture), 'T 6:30pm–8:30pm');
  assert.equal(examMeetings(lecture).length, 1);
  assert.equal(classMeetings(lecture).length, 1);
  assert.equal(sectionMeetings(lecture).length, 2);
});

test('two class meetings in one section never conflict with each other', () => {
  const s = section('CASBI576', [meeting('Mon Wed', '02:30PM', '03:45PM'), meeting('Wed', '02:30PM', '03:20PM')]);
  assert.equal(sectionsConflict(s, s), false);
  assert.equal(overlapMinutes(s, s), 0);
  // A different object with the same id is the same section.
  assert.equal(sectionsConflict(s, { ...s }), false);
});

test('malformed `meetings` falls back to the legacy fields', () => {
  const legacy = { daysOfWeek: 'Tue Thu', startTime: '09:30AM', endTime: '10:45AM', facilId: 'HAR 1' };
  for (const bad of [null, 'x', 5, {}, [], [null], ['x', 3, null, []], [undefined]]) {
    const s = { id: 'b', ...legacy, meetings: bad };
    assert.deepEqual(sectionMeeting(s), oldSectionMeeting(legacy), `meetings = ${JSON.stringify(bad)}`);
    assert.equal(describeSectionTime(s), 'TTh 9:30am–10:45am');
    assert.equal(getMeetings(s).length, 1);
    assert.equal(getMeetings(s)[0].kind, 'class');
  }
  // Malformed entries are skipped; good ones still count.
  const mixed = { id: 'm', ...legacy, meetings: ['x', null, meeting('Fri', '08:00AM', '08:50AM')] };
  assert.equal(describeSectionTime(mixed), 'F 8:00am–8:50am');
  // Unknown kind means class; unparseable times are dropped.
  const odd = { id: 'o', meetings: [meeting('Mon', '09:00AM', '09:50AM', 'lab'), meeting('Tue', 'TBA', '')] };
  assert.equal(classMeetings(odd).length, 1);
  assert.equal(describeSectionTime(odd), 'M 9:00am–9:50am');
  // No class meeting at all.
  assert.equal(describeSectionTime({ id: 'n', meetings: [meeting('Tue', '06:30PM', '08:30PM', 'exam')] }), 'No scheduled meeting');
  assert.equal(sectionMeeting({ id: 'n', meetings: [meeting('Tue', '06:30PM', '08:30PM', 'exam')] }), null);
  assert.equal(sectionMeeting(null), null);
});

test('compareSectionsByTime uses the earliest class meeting', () => {
  const late = section('late', [meeting('Thu', '09:00AM', '09:50AM'), meeting('Tue', '03:00PM', '03:50PM')]);
  const mon = section('mon', [meeting('Mon', '04:00PM', '04:50PM')]);
  assert.ok(compareSectionsByTime(mon, late) < 0); // Mon beats Tue
  const examFirst = section('x', [meeting('Mon', '06:30PM', '08:30PM', 'exam'), meeting('Wed', '09:00AM', '09:50AM')]);
  assert.ok(compareSectionsByTime(examFirst, mon) > 0); // exam on Mon is ignored
});

test('passesGlobalFilter needs every class meeting to pass; exams are ignored', () => {
  const noMornings = { mode: 'same', global: { startMin: 11 * 60, endMin: null, activePreset: null }, perDay: EMPTY_GLOBAL_FILTERS.perDay };
  const ga = section('GA', [meeting('Tue Thu', '12:30PM', '01:45PM'), meeting('Fri', '08:00AM', '08:50AM')]);
  assert.equal(passesGlobalFilter(ga, noMornings), false);
  const afternoon = section('A', [meeting('Tue Thu', '12:30PM', '01:45PM'), meeting('Fri', '12:20PM', '01:10PM')]);
  assert.equal(passesGlobalFilter(afternoon, noMornings), true);
  const withExam = section('E', [meeting('Tue Thu', '12:30PM', '01:45PM'), meeting('Mon', '08:00AM', '09:00AM', 'exam')]);
  assert.equal(passesGlobalFilter(withExam, noMornings), true);
  // Per-day bounds apply per meeting's own days.
  const custom = {
    mode: 'custom',
    global: { startMin: null, endMin: null, activePreset: null },
    perDay: { ...EMPTY_GLOBAL_FILTERS.perDay, Fri: { startMin: 11 * 60, endMin: null, activePreset: null } },
  };
  assert.equal(passesGlobalFilter(ga, custom), false); // Friday 8am fails the Friday bound
  assert.equal(passesGlobalFilter(section('T', [meeting('Tue Thu', '08:00AM', '09:15AM'), meeting('Fri', '12:20PM', '01:10PM')]), custom), true);
  // No class meeting: fails an active filter, passes an inactive one.
  assert.equal(passesGlobalFilter({ id: 'n' }, noMornings), false);
  assert.equal(passesGlobalFilter({ id: 'n' }, EMPTY_GLOBAL_FILTERS), true);
});

test('describeSectionSet follows describeSectionTime', () => {
  const ga = section('GA', [meeting('Tue Thu', '08:00AM', '09:15AM'), meeting('Fri', '08:00AM', '08:50AM')], { courseKey: 'QSTSM131', classSection: 'GA', component: 'DIS', componentLabel: 'Discussion Section' });
  const { lines } = describeSectionSet(['GA'], { GA: ga }, { QSTSM131: { courseNumber: 'QST SM 131' } });
  assert.deepEqual(lines, ['QST SM 131 DIS GA (TTh 8:00am–9:15am · F 8:00am–8:50am)']);
});
