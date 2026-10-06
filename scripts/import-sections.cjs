// import-sections.js
// Imports a term's official schedule CSV (e.g. Fall2026Courses.csv) into
// the `sections` Firestore collection. Collapses duplicate rows (the raw
// CSV repeats a row per instructor / per identical section) into one doc
// per section, with an `instructors` array.
//
// A section can have several meeting rows (e.g. a lecture plus an evening
// exam block); the meeting fields come from the row picked by
// pickPrimaryMeeting below, not just whichever row comes first.
//
// Usage:
//   node import-sections.js ./Fall2026Courses.csv
//   node import-sections.js --dry-run a.csv [b.csv ...]   (read-only: lists
//     sections whose meeting row differs from the old first-row choice;
//     no Firestore connection, no credentials needed)
//
// Requires: firebase-admin, csv-parse

const fs = require('fs');
const { parse } = require('csv-parse/sync');

const DRY_RUN = process.argv.includes('--dry-run');

// Firestore is only set up for a real import, so --dry-run never connects.
let db;
let FieldValue;
if (!DRY_RUN) {
  const admin = require('firebase-admin');
  const firestore = require('firebase-admin/firestore');
  admin.initializeApp({
    credential: admin.applicationDefault(),
  });
  db = firestore.getFirestore();
  FieldValue = firestore.FieldValue;
}

const MEETING_COLUMNS = [
  'Days Of The Week', 'Start Time', 'End Time', 'Facil ID',
  'Meeting Start Date', 'Meeting End Date',
];

function meetingKey(row) {
  return MEETING_COLUMNS.map((c) => row[c]?.trim() || '').join('|');
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

// Picks a section's main meeting among its distinct meeting rows (in file
// order): longest date span (spans within 90% of the longest count as a
// tie), then a daytime start (before 6 PM) over an evening one (no time
// ranks last), then more distinct meeting days per week, then a real room
// over a blank one over "NO ROOM", then the days pattern shared by the most
// rows. Ties keep file order, so a section with one meeting row is unchanged.
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

function describeMeeting(row) {
  return [
    row['Days Of The Week']?.trim() || '-',
    `${row['Start Time']?.trim() || '-'}–${row['End Time']?.trim() || '-'}`,
    `${row['Meeting Start Date']?.trim() || '-'} → ${row['Meeting End Date']?.trim() || '-'}`,
    row['Facil ID']?.trim() || '-',
  ].join(' | ');
}

function normalizeCourseKey(subjectArea, catalogNbr) {
  return `${subjectArea}${catalogNbr}`.replace(/\s+/g, '').toUpperCase();
}

function toInt(val) {
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? 0 : n;
}

function toFloat(val) {
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : n;
}

async function importSections(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });

  // Group by term + Class Nbr to collapse duplicate rows.
  const sectionsByKey = new Map();
  // key -> distinct meeting rows, in file order (first one = old choice).
  const meetingsByKey = new Map();

  for (const row of rows) {
    const term = row['Term']?.trim();
    const classNbr = row['Class Nbr']?.trim();
    if (!term || !classNbr) continue;

    const key = `${term}_${classNbr}`;
    const instructorLast = row["Instructor's Last Name"]?.trim();
    const instructorFirst = row["Instructor's First Name"]?.trim();

    if (!meetingsByKey.has(key)) meetingsByKey.set(key, new Map());
    const meetings = meetingsByKey.get(key);
    if (!meetings.has(meetingKey(row))) meetings.set(meetingKey(row), row);

    if (!sectionsByKey.has(key)) {
      sectionsByKey.set(key, {
        term,
        session: row['Session']?.trim() || '',
        subjectArea: row['Subject Area']?.trim() || '',
        catalogNbr: row['Catalog Nbr']?.trim() || '',
        classSection: row['Class Section']?.trim() || '',
        classNbr,
        description: row['Description']?.trim() || '',
        credits: toFloat(row['Credit Hours']),
        campus: row['Campus']?.trim() || '',
        daysOfWeek: row['Days Of The Week']?.trim() || '',
        startTime: row['Start Time']?.trim() || '',
        endTime: row['End Time']?.trim() || '',
        facilId: row['Facil ID']?.trim() || '',
        meetingStartDate: row['Meeting Start Date']?.trim() || '',
        meetingEndDate: row['Meeting End Date']?.trim() || '',
        capEnrl: toInt(row['Cap Enrl']),
        waitCap: toInt(row['Wait Cap']),
        minEnrl: toInt(row['Min Enrl']),
        totEnrl: toInt(row['Tot Enrl']),
        waitTot: toInt(row['Wait Tot']),
        acadGroup: row['Acad Group']?.trim() || '',
        enrlStat: row['Enrl Stat']?.trim() || '',
        classStat: row['Class Stat']?.trim() || '',
        classType: row['Class Type']?.trim() || '',
        component: row['Component']?.trim() || '',
        componentLabel: row['Component Label']?.trim() || '',
        mode: row['Mode']?.trim() || '',
        notes: row['Notes']?.trim() || '',
        finalExam: row['Final Exam']?.trim() || '',
        instructors: [],
      });
    }

    const section = sectionsByKey.get(key);
    const alreadyHasInstructor = section.instructors.some(
      (i) => i.last === instructorLast && i.first === instructorFirst
    );
    if (instructorLast && !alreadyHasInstructor) {
      section.instructors.push({ first: instructorFirst, last: instructorLast });
    }
  }

  // Meeting fields come from the chosen main meeting row; every other field
  // still comes from the section's first row, as before.
  const changed = [];
  for (const [key, section] of sectionsByKey) {
    const meetings = [...meetingsByKey.get(key).values()];
    const primary = pickPrimaryMeeting(meetings);
    if (primary === meetings[0]) continue;
    changed.push({ section, oldRow: meetings[0], newRow: primary });
    section.daysOfWeek = primary['Days Of The Week']?.trim() || '';
    section.startTime = primary['Start Time']?.trim() || '';
    section.endTime = primary['End Time']?.trim() || '';
    section.facilId = primary['Facil ID']?.trim() || '';
    section.meetingStartDate = primary['Meeting Start Date']?.trim() || '';
    section.meetingEndDate = primary['Meeting End Date']?.trim() || '';
  }

  if (DRY_RUN) {
    console.log(`\n=== ${csvPath}: ${sectionsByKey.size} sections, ${changed.length} with a different meeting row than before`);
    for (const { section, oldRow, newRow } of changed) {
      console.log(`${section.classNbr}  ${section.subjectArea} ${section.catalogNbr} ${section.classSection}  (${section.description})`);
      console.log(`    old: ${describeMeeting(oldRow)}`);
      console.log(`    new: ${describeMeeting(newRow)}`);
    }
    return;
  }

  let batch = db.batch();
  let count = 0;

  for (const [key, section] of sectionsByKey) {
    const courseKey = normalizeCourseKey(section.subjectArea, section.catalogNbr);
    const docRef = db.collection('sections').doc(key);
    batch.set(
      docRef,
      {
        ...section,
        courseKey,
        importedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
      console.log(`Committed ${count} sections...`);
    }
  }

  await batch.commit();
  console.log(`Done. Imported ${count} unique sections from ${rows.length} raw rows.`);
}

const csvPaths = process.argv.slice(2).filter((a) => a !== '--dry-run');
if (csvPaths.length === 0 || (!DRY_RUN && csvPaths.length > 1)) {
  console.error('Usage: node import-sections.js <path-to-csv>');
  console.error('       node import-sections.js --dry-run <path-to-csv> [more.csv ...]');
  process.exit(1);
}

(async () => {
  for (const csvPath of csvPaths) await importSections(csvPath);
})().catch((err) => {
  console.error(DRY_RUN ? 'Dry run failed:' : 'Import failed:', err);
  process.exit(1);
});
