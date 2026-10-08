// Run with: node --test scripts/lib/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const M = createRequire(import.meta.url)('./meetings.cjs');

// Notes below are the real Spring 2027 (2271) CSV notes.
const CS111 = 'Students registering for CS111 must register for both a lecture and a lab section. Students in all CS111 sections must reserve Wednesday 6:30 - 7:45pm for exams during the semester.';
const CS112 = 'Students registering for CS112 must register for both a lecture section and a lab section. Students in all CS112 sections should reserve Wednesday 6:30 - 8:00pm for exams during the semester.';
const CS131 = 'Students in all CS131 sections must reserve Thursday 6:30 - 7:45pm for exams during the semester.';
const CS132 = 'Students registering for CS132 must register for both a lecture section and a discussion section. Students in all CS132 sections must reserve Tuesday 6:30 - 7:45pm for exams during the semester.';
const BB422 = 'Please note that CASBB 422 includes an exam block meeting that take place on Tuesdays from 7:00 p.m. to 9:00 p.m.  All registrants need to reserve that time in their schedules during the spring term.';
const CH102 = 'Exam Block: Tuesdays 6:30-8:00 PM ; Students registering for CAS CH 102 must register for three sections: a Lecture section (A1, A2, A3, or A4); a Discussion section (B...), and a Lab section (C...).';
const EK103 = 'Exams for EK103 take place on Fridays 6-9pm throughout the semester.';
const FIELDWORK = 'Open to the BU community. Reserve Thurs Mornings 8-10 for Fieldwork in local schools. Meets w/ ME 618';

function row(subject, nbr, section, days, start, end, facil, notes) {
  return {
    Term: '2271',
    'Class Nbr': `${subject}${nbr}${section}`,
    'Subject Area': subject,
    'Catalog Nbr': nbr,
    'Class Section': section,
    Career: 'Undergrad',
    'Days Of The Week': days,
    'Start Time': start,
    'End Time': end,
    'Facil ID': facil,
    'Meeting Start Date': '01/19/2027',
    'Meeting End Date': '04/29/2027',
    Notes: notes,
  };
}

function build(rows, opts = {}) {
  const [section] = M.groupSections(rows, '2271').values();
  return M.buildMeetings(section, opts);
}

function parsed(notes) {
  return M.parseNotesExams(notes).exams.map((e) => `${e.days.join(' ')} ${e.startTime}-${e.endTime}`);
}

test('parseNotesExams: real notes parse to one weekday + one range', () => {
  assert.deepEqual(parsed(CS111), ['Wed 06:30PM-07:45PM']);
  assert.deepEqual(parsed(CS112), ['Wed 06:30PM-08:00PM']);
  assert.deepEqual(parsed(CS131), ['Thu 06:30PM-07:45PM']);
  assert.deepEqual(parsed(CS132), ['Tue 06:30PM-07:45PM']);
  assert.deepEqual(parsed(BB422), ['Tue 07:00PM-09:00PM']);
  assert.deepEqual(parsed(CH102), ['Tue 06:30PM-08:00PM']);
});

test('parseNotesExams: weekday and time variants', () => {
  assert.deepEqual(parsed('Exam Block: Thurs 6:30-8:30 PM ;  Mts w/CAS CH204'), ['Thu 06:30PM-08:30PM']);
  assert.deepEqual(parsed('Should reserve Thursdays 6:30-8:30pm for exams throughout the term.'), ['Thu 06:30PM-08:30PM']);
  assert.deepEqual(parsed('Exam block meeting on Fridays from 11 a.m. to 1 p.m.'), ['Fri 11:00AM-01:00PM']);
});

test('parseNotesExams: EK103 "Exams for <course> take place on" (one am/pm applies to both ends)', () => {
  assert.deepEqual(parsed(EK103), ['Fri 06:00PM-09:00PM']);
  assert.deepEqual(parsed('Exams for CS 101 take place on Mondays 10-11am.'), ['Mon 10:00AM-11:00AM']);
  assert.deepEqual(parsed('Exams for EK103 are great on Fridays 6-9pm.'), []);
});

test('parseNotesExams: fieldwork reserve note is not an exam', () => {
  assert.deepEqual(parsed(FIELDWORK), []);
});

test('parseNotesExams: ambiguous notes are rejected, not guessed', () => {
  const two = M.parseNotesExams('Reserve Mondays and Wednesdays 6:30-8:00 PM for exams.');
  assert.equal(two.exams.length, 0);
  assert.match(two.rejected[0].reason, /weekdays/);
  const noWording = M.parseNotesExams('Lab meets Wednesday 6:30-8:00 PM on exam weeks only.');
  assert.equal(noWording.exams.length, 0);
});

test('CS111: synthetic exam appended after class meetings and counts toward the gate', () => {
  const rows = [row('CAS CS', '111', 'A1', 'Mon Wed Fri', '12:20PM', '01:10PM', 'KCB 101', CS111)];
  const before = build(rows);
  assert.equal(before.meetings.length, 1);
  assert.equal(before.patternCount, 1);

  const after = build(rows, { notesExams: true });
  assert.equal(after.recurringCount, 1);
  assert.equal(after.syntheticExamCount, 1);
  assert.equal(after.patternCount, 2);
  assert.deepEqual(after.meetings[0], before.meetings[0]); // meetings[0] still the top-level meeting
  assert.deepEqual(after.meetings[1], {
    daysOfWeek: 'Wed',
    startTime: '06:30PM',
    endTime: '07:45PM',
    facilId: 'NO ROOM',
    meetingStartDate: '01/19/2027',
    meetingEndDate: '04/29/2027',
    kind: 'exam',
  });
});

test('CS112, CS131, CS132, BB422 each gain exactly one exam', () => {
  const cases = [
    ['CS112', CS112, 'Tue Thu', '02:00PM', '03:15PM', 'Wed 06:30PM-08:00PM'],
    ['CS131', CS131, 'Tue Thu', '11:00AM', '12:15PM', 'Thu 06:30PM-07:45PM'],
    ['CS132', CS132, 'Tue Thu', '11:00AM', '12:15PM', 'Tue 06:30PM-07:45PM'],
    ['BB422', BB422, 'Tue Thu', '03:30PM', '05:15PM', 'Tue 07:00PM-09:00PM'],
  ];
  for (const [name, notes, days, start, end, want] of cases) {
    const rows = [row('CAS XX', name, 'A1', days, start, end, 'ROOM 1', notes)];
    const exams = build(rows, { notesExams: true }).meetings.filter((m) => m.kind === 'exam');
    assert.equal(exams.length, 1, name);
    assert.equal(`${exams[0].daysOfWeek} ${exams[0].startTime}-${exams[0].endTime}`, want, name);
  }
});

test('CH102: already has an exam meeting, so it is unchanged', () => {
  const rows = [
    row('CAS CH', '102', 'A1', 'Mon Wed Fri', '09:05AM', '09:55AM', 'SCI 109', CH102),
    row('CAS CH', '102', 'A1', 'Tue', '06:30PM', '08:30PM', 'NO ROOM', CH102),
  ];
  const before = build(rows);
  const after = build(rows, { notesExams: true });
  assert.deepEqual(after.meetings, before.meetings);
  assert.equal(after.syntheticExamCount, 0);
  assert.equal(after.patternCount, before.patternCount);
});

test('CFAME408: fieldwork note produces no exam', () => {
  const rows = [row('CFA ME', '408', 'A1', 'Tue', '06:30PM', '09:15PM', 'CFA 410', FIELDWORK)];
  const after = build(rows, { notesExams: true });
  assert.equal(after.syntheticExamCount, 0);
  assert.equal(after.meetings.length, 1);
  assert.equal(after.meetings[0].kind, 'class');
});

test('notesExams is off by default and skips out-of-scope sections', () => {
  const rows = [row('CAS CS', '111', 'A1', 'Mon Wed Fri', '12:20PM', '01:10PM', 'KCB 101', CS111)];
  assert.equal(build(rows).syntheticExamCount, 0);
  const grad = [{ ...rows[0], Career: 'Graduate' }];
  assert.equal(build(grad, { notesExams: true }).syntheticExamCount, 0);
});

test('an exam already present at that day/time is not duplicated', () => {
  // Class row plus a dated one-off (ignored by buildMeetings) leaves no exam
  // meeting, but a NO ROOM row at the same time as the note must not double up.
  const rows = [
    row('CAS CS', '111', 'A1', 'Mon Wed Fri', '12:20PM', '01:10PM', 'KCB 101', CS111),
    row('CAS CS', '111', 'A1', 'Wed', '06:30PM', '07:45PM', 'NO ROOM', CS111),
  ];
  const after = build(rows, { notesExams: true });
  assert.equal(after.meetings.filter((m) => m.kind === 'exam').length, 1);
  assert.equal(after.syntheticExamCount, 0);
});
