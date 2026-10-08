// meetings.cjs
// Turns a section's CSV rows into a `meetings` array: one entry per distinct
// recurring weekly pattern, primary class meeting first. Pure functions, no
// Firestore and no file access, so build-meetings-plan.cjs, backfill-meetings.cjs
// and (later) import-sections.cjs can all share them.
//
// Entry shape (same field names/formats as the section docs):
//   { daysOfWeek, startTime, endTime, facilId, meetingStartDate, meetingEndDate, kind }
//   kind: 'class' | 'exam'
//
// Requires: nothing (rows come from csv-parse, columns: true)

const MEETING_COLUMNS = [
  'Days Of The Week', 'Start Time', 'End Time', 'Facil ID',
  'Meeting Start Date', 'Meeting End Date',
];

// Firestore field <- CSV column, as import-sections.cjs stores them.
const MEETING_FIELDS = {
  daysOfWeek: 'Days Of The Week',
  startTime: 'Start Time',
  endTime: 'End Time',
  facilId: 'Facil ID',
  meetingStartDate: 'Meeting Start Date',
  meetingEndDate: 'Meeting End Date',
};

// Every ENGEK 125 meeting is a class meeting, except the shared Fri 4:30-6:15 PM
// row below: it's an exam block (confirmed on MyBU). A1/A2 list it with a real
// room and A3 with NO ROOM, so the NO ROOM sibling logic can't be trusted here.
const ALL_CLASS_COURSES = new Set(['ENGEK125']);
// courseKey -> patternKeys (days|start|end, as in the CSV) that are exam blocks.
// Checked before ALL_CLASS_COURSES.
const FORCED_EXAM_PATTERNS = new Map([
  ['ENGEK125', new Set(['Fri|04:30PM|06:15PM'])],
]);
// Same for single sections whose "NO ROOM" row is a real class meeting.
const ALL_CLASS_DOC_IDS = new Set(['2271_10107']); // COM CM 581 A1

const EXAM_NOTES = /exam|midterm/i;
const EVENING_MINUTES = 18 * 60;

function normalizeCourseKey(subjectArea, catalogNbr) {
  return `${subjectArea}${catalogNbr}`.replace(/\s+/g, '').toUpperCase();
}

function cell(row, column) {
  return row[column]?.trim() || '';
}

function meetingKey(row) {
  return MEETING_COLUMNS.map((c) => cell(row, c)).join('|');
}

// days+start+end: what makes two meetings "the same pattern".
function patternKey(row) {
  return [cell(row, 'Days Of The Week'), cell(row, 'Start Time'), cell(row, 'End Time')].join('|');
}

function dayList(row) {
  return cell(row, 'Days Of The Week').split(/\s+/).filter(Boolean);
}

// "MM/DD/YYYY" pair -> length in days (0 if either is missing).
function dateSpanDays(row) {
  const toDate = (s) => {
    const [m, d, y] = (s?.trim() || '').split('/').map(Number);
    return y ? Date.UTC(y, m - 1, d) : null;
  };
  const start = toDate(row['Meeting Start Date']);
  const end = toDate(row['Meeting End Date']);
  return start != null && end != null ? (end - start) / 86400000 + 1 : 0;
}

// "09:05AM" -> minutes since midnight, or null.
function startMinutes(row) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(row['Start Time']?.trim() || '');
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + parseInt(m[2], 10);
}

// ── Copied verbatim from import-sections.cjs on origin/meeting-patch and
//    scripts/patch-meeting-rows.cjs. Keep in sync if the importer changes. ──
function pickPrimaryMeeting(meetings) {
  const daysCount = new Map();
  for (const m of meetings) {
    const days = m['Days Of The Week']?.trim() || '';
    daysCount.set(days, (daysCount.get(days) || 0) + 1);
  }
  const maxSpan = Math.max(...meetings.map(dateSpanDays));
  const rank = (m) => {
    const start = startMinutes(m);
    const facil = m['Facil ID']?.trim() || '';
    const days = m['Days Of The Week']?.trim() || '';
    const span = dateSpanDays(m);
    return [
      span >= 0.9 * maxSpan ? -maxSpan : -span,
      start == null ? 2 : start < 18 * 60 ? 0 : 1,
      -new Set(days.split(/\s+/).filter(Boolean)).size,
      facil === 'NO ROOM' ? 2 : facil ? 0 : 1,
      -daysCount.get(days),
    ];
  };
  let best = meetings[0];
  let bestRank = rank(best);
  for (const m of meetings.slice(1)) {
    const r = rank(m);
    const i = r.findIndex((v, idx) => v !== bestRank[idx]);
    if (i !== -1 && r[i] < bestRank[i]) {
      best = m;
      bestRank = r;
    }
  }
  return best;
}
// ── end of copied logic ─────────────────────────────────────────────────────

// CSV row -> the six meeting fields as the importer stores them.
function toFields(row) {
  const out = {};
  for (const [field, column] of Object.entries(MEETING_FIELDS)) out[field] = cell(row, column);
  return out;
}

// The six fields as stored on a doc or a meetings entry (missing -> '').
function pickFields(data) {
  const out = {};
  for (const field of Object.keys(MEETING_FIELDS)) out[field] = data?.[field] ?? '';
  return out;
}

function sameFields(a, b) {
  return Object.keys(MEETING_FIELDS).every((f) => (a?.[f] ?? '') === (b?.[f] ?? ''));
}

function describeFields(f) {
  return `${f.daysOfWeek || '-'} | ${f.startTime || '-'}–${f.endTime || '-'} | ${f.meetingStartDate || '-'} → ${f.meetingEndDate || '-'} | ${f.facilId || '-'}`;
}

// Which sections get a `meetings` array: undergrad only; OTPMS, MED and LAW
// subject areas are left out.
function inMeetingsScope(section) {
  return section.career === 'Undergrad' && section.subjectArea !== 'OTPMS' && !/^(MED|LAW)/.test(section.subjectArea);
}

// Rows -> Map docId -> section { docId, term, classNbr, courseKey, ... rows }.
// `rows` keeps every CSV row of the section in file order (so rows[0] is what
// the importer stores in the top-level fields).
function groupSections(csvRows, term) {
  const sections = new Map();
  for (const row of csvRows) {
    const rowTerm = cell(row, 'Term');
    const classNbr = cell(row, 'Class Nbr');
    if (!rowTerm || !classNbr || (term && rowTerm !== term)) continue;
    const docId = `${rowTerm}_${classNbr}`;
    if (!sections.has(docId)) {
      const subjectArea = cell(row, 'Subject Area');
      const catalogNbr = cell(row, 'Catalog Nbr');
      sections.set(docId, {
        docId,
        term: rowTerm,
        classNbr,
        subjectArea,
        catalogNbr,
        classSection: cell(row, 'Class Section'),
        career: cell(row, 'Career'),
        courseKey: normalizeCourseKey(subjectArea, catalogNbr),
        label: `${subjectArea} ${catalogNbr} ${cell(row, 'Class Section')}`,
        rows: [],
      });
    }
    sections.get(docId).rows.push(row);
  }
  return sections;
}

// courseKey -> Set of patternKeys that are "NO ROOM" in any section of that course.
function noRoomPatternsByCourse(sections) {
  const out = new Map();
  for (const section of sections.values()) {
    for (const row of section.rows) {
      if (cell(row, 'Facil ID') !== 'NO ROOM' || !dayList(row).length) continue;
      if (!out.has(section.courseKey)) out.set(section.courseKey, new Set());
      out.get(section.courseKey).add(patternKey(row));
    }
  }
  return out;
}

// Recurring = has days and a date span longer than 7 days. Shorter spans are
// dated one-offs. One row per days+start+end; if the same pattern shows up with
// different rooms/dates, the longest span wins (ties: first in file).
function recurringRows(section) {
  const byPattern = new Map();
  let collisions = 0;
  const seenKeys = new Set();
  for (const row of section.rows) {
    if (!dayList(row).length || dateSpanDays(row) <= 7) continue;
    const mk = meetingKey(row);
    if (seenKeys.has(mk)) continue;
    seenKeys.add(mk);
    const pk = patternKey(row);
    const prev = byPattern.get(pk);
    if (!prev) {
      byPattern.set(pk, row);
    } else {
      collisions++;
      if (dateSpanDays(row) > dateSpanDays(prev)) byPattern.set(pk, row);
    }
  }
  return { rows: [...byPattern.values()], collisions };
}

function isEveningSingleDay(row) {
  const start = startMinutes(row);
  return dayList(row).length === 1 && start != null && start >= EVENING_MINUTES;
}

function classifyKind(section, row, noRoomPatterns) {
  if (ALL_CLASS_DOC_IDS.has(section.docId)) return 'class';
  if (FORCED_EXAM_PATTERNS.get(section.courseKey)?.has(patternKey(row))) return 'exam';
  if (ALL_CLASS_COURSES.has(section.courseKey)) return 'class';
  if (cell(row, 'Facil ID') === 'NO ROOM') return 'exam';
  if (noRoomPatterns?.has(patternKey(row))) return 'exam';
  if (isEveningSingleDay(row) && section.rows.some((r) => EXAM_NOTES.test(cell(r, 'Notes')))) return 'exam';
  return 'class';
}

// The row the section doc's top-level fields come from. Today's importer keeps
// the first row; `storedPick: true` means the doc was patched to the
// pickPrimaryMeeting row instead (the 22 allowlisted Class Nbrs).
function storedRow(section, { storedPick = false } = {}) {
  if (!storedPick) return section.rows[0];
  const distinct = new Map();
  for (const row of section.rows) if (!distinct.has(meetingKey(row))) distinct.set(meetingKey(row), row);
  return pickPrimaryMeeting([...distinct.values()]);
}

// Builds a section's meetings. Returns
//   { meetings, recurringCount, collisions, stored, primaryIsExam }
// `stored` is the row the top-level fields hold; the stored row's pattern goes
// first when it's a class meeting, then the rest of the class meetings, then
// exam blocks (file order inside each group).
function buildMeetings(section, { noRoomPatterns, storedPick = false } = {}) {
  const { rows, collisions } = recurringRows(section);
  const stored = storedRow(section, { storedPick });
  const entries = rows.map((row) => ({ row, kind: classifyKind(section, row, noRoomPatterns) }));

  const storedPattern = patternKey(stored);
  const rank = ({ row, kind }) => (kind === 'exam' ? 2 : patternKey(row) === storedPattern ? 0 : 1);
  const ordered = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map(({ e }) => e);

  const meetings = ordered.map(({ row, kind }) => ({ ...toFields(row), kind }));
  return {
    meetings,
    recurringCount: rows.length,
    collisions,
    stored: toFields(stored),
    primaryIsExam: meetings.length > 0 && meetings[0].kind === 'exam',
  };
}

module.exports = {
  MEETING_COLUMNS,
  MEETING_FIELDS,
  normalizeCourseKey,
  meetingKey,
  patternKey,
  dateSpanDays,
  startMinutes,
  pickPrimaryMeeting,
  toFields,
  pickFields,
  sameFields,
  describeFields,
  inMeetingsScope,
  groupSections,
  noRoomPatternsByCourse,
  recurringRows,
  classifyKind,
  storedRow,
  buildMeetings,
};
