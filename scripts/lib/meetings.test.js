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

function row(subject, nbr, section, days, start, end, facil, notes, component = 'LEC') {
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
    Component: component,
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

// ── Propagation ("all <COURSE> sections") ───────────────────────────────────
function term(rows, opts) {
  return M.buildTermMeetings(M.groupSections(rows, '2271'), opts);
}
const examsOf = (built) => built.meetings.filter((m) => m.kind === 'exam').map((m) => `${m.daysOfWeek} ${m.startTime}-${m.endTime} ${m.facilId}`);
const id = (subject, nbr, section) => `2271_${subject}${nbr}${section}`;

test('propagation: CS132 A2 (blank notes) gains the exam from A1; labs/discussions do not', () => {
  const rows = [
    row('CAS CS', '132', 'A1', 'Tue Thu', '11:00AM', '12:15PM', 'FLR 123', CS132),
    row('CAS CS', '132', 'A2', 'Tue Thu', '12:30PM', '01:45PM', 'FLR 123', ''),
    row('CAS CS', '132', 'B1', 'Wed', '12:20PM', '01:10PM', 'CAS 324', '', 'DIS'),
    row('CAS CS', '132', 'B2', 'Wed', '01:25PM', '02:15PM', 'MCS B33', '', 'LAB'),
  ];
  const built = term(rows);
  assert.deepEqual(examsOf(built.get(id('CAS CS', '132', 'A1'))), ['Tue 06:30PM-07:45PM NO ROOM']);
  const a2 = built.get(id('CAS CS', '132', 'A2'));
  assert.deepEqual(examsOf(a2), ['Tue 06:30PM-07:45PM NO ROOM']);
  assert.equal(a2.propagatedExamCount, 1);
  assert.equal(a2.propagatedFrom, id('CAS CS', '132', 'A1'));
  assert.equal(a2.patternCount, 2);
  assert.equal(a2.meetings[0].daysOfWeek, 'Tue Thu'); // meetings[0] still the class meeting
  assert.equal(a2.meetings[0].startTime, '12:30PM');
  assert.equal(a2.meetings[1].meetingStartDate, '01/19/2027');
  for (const lab of ['B1', 'B2']) {
    const b = built.get(id('CAS CS', '132', lab));
    assert.deepEqual(examsOf(b), [], lab);
    assert.equal(b.propagatedExamCount, 0, lab);
  }
  // Off: nothing is copied.
  assert.deepEqual(examsOf(term(rows, { propagate: false }).get(id('CAS CS', '132', 'A2'))), []);
});

test('propagation: CS111, CS112, CS131 already have the note on each lecture, so nothing is propagated', () => {
  const cases = [
    ['111', CS111, CS111, 'Wed 06:30PM-07:45PM NO ROOM'],
    ['112', CS112, CS112, 'Wed 06:30PM-08:00PM NO ROOM'],
    ['131', CS131, 'Co-Teach with Assaf Khoury || ' + CS131, 'Thu 06:30PM-07:45PM NO ROOM'],
  ];
  for (const [nbr, a1, a2, want] of cases) {
    const rows = [
      row('CAS CS', nbr, 'A1', 'Tue Thu', '11:00AM', '12:15PM', 'R1', a1),
      row('CAS CS', nbr, 'A2', 'Tue Thu', '12:30PM', '01:45PM', 'R2', a2),
    ];
    const withP = term(rows);
    const without = term(rows, { propagate: false });
    for (const sec of ['A1', 'A2']) {
      const key = id('CAS CS', nbr, sec);
      assert.deepEqual(examsOf(withP.get(key)), [want], `${nbr} ${sec}`);
      assert.equal(withP.get(key).propagatedExamCount, 0, `${nbr} ${sec}`);
      assert.deepEqual(withP.get(key).meetings, without.get(key).meetings, `${nbr} ${sec}`);
    }
  }
});

test('propagation: ENGEK103 A5 (no meeting rows) gets no exam, even from an "all sections" source', () => {
  const blank = { ...row('ENG EK', '103', 'A5', '', '', '', '', ''), 'Days Of The Week': '', 'Start Time': '', 'End Time': '', 'Facil ID': '', 'Meeting Start Date': '', 'Meeting End Date': '' };
  const rows = [
    row('ENG EK', '103', 'A1', 'Tue Thu', '09:30AM', '10:45AM', 'PHO 203', EK103),
    blank,
  ];
  assert.equal(examsOf(term(rows).get(id('ENG EK', '103', 'A5'))).length, 0);
  // Same with a source that does say "all ... sections".
  const rows2 = [
    row('ENG EK', '103', 'A1', 'Tue Thu', '09:30AM', '10:45AM', 'PHO 203', CS132.replace(/CS132/g, 'EK103')),
    blank,
  ];
  const a5 = term(rows2).get(id('ENG EK', '103', 'A5'));
  assert.deepEqual(examsOf(a5), []);
  assert.deepEqual(a5.propagationSkips, ['no meeting rows']);
});

test('propagation: a note without "all <COURSE> sections" is never copied; a lab never sources one', () => {
  const rows = [
    row('ENG EK', '103', 'A1', 'Tue Thu', '09:30AM', '10:45AM', 'PHO 203', EK103),
    row('ENG EK', '103', 'A2', 'Tue Thu', '11:00AM', '12:15PM', 'EPC 205', ''),
  ];
  assert.deepEqual(examsOf(term(rows).get(id('ENG EK', '103', 'A2'))), []);
  const labSource = [
    row('CAS CS', '132', 'A1', 'Tue Thu', '11:00AM', '12:15PM', 'R1', ''),
    row('CAS CS', '132', 'B1', 'Wed', '12:20PM', '01:10PM', 'R2', CS132, 'LAB'),
  ];
  assert.deepEqual(examsOf(term(labSource).get(id('CAS CS', '132', 'A1'))), []);
});

test('propagation: sources that disagree on the time propagate nothing', () => {
  const rows = [
    row('CAS XX', '100', 'A1', 'Tue Thu', '09:00AM', '10:15AM', 'R1', 'Students in all XX100 sections must reserve Tuesday 6:30 - 7:45pm for exams.'),
    row('CAS XX', '100', 'A2', 'Tue Thu', '10:30AM', '11:45AM', 'R2', 'Students in all XX100 sections must reserve Wednesday 6:30 - 7:45pm for exams.'),
    row('CAS XX', '100', 'A3', 'Tue Thu', '12:00PM', '01:15PM', 'R3', ''),
  ];
  const built = term(rows);
  assert.deepEqual(examsOf(built.get(id('CAS XX', '100', 'A3'))), []);
});
