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
//   node import-sections.js --dry-run --meetings-out plan.json a.csv
//     (also writes the `meetings` each section would get, for diffing)
//
// Sections with 2+ recurring weekly patterns (undergrad only; see
// scripts/lib/meetings.cjs) also get a `meetings` array; meetings[0] is the
// same meeting as the top-level meeting fields.
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

const {
  groupSections,
  noRoomPatternsByCourse,
  buildMeetings,
  inMeetingsScope,
  pickPrimaryMeeting,
  sameFields,
  toFields,
  describeFields,
  normalizeCourseKey,
  meetingKey,
} = require('./lib/meetings.cjs');

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--meetings-out');
const MEETINGS_OUT = outIdx !== -1 ? argv[outIdx + 1] : null;
// CSV paths = everything that isn't a flag or the --meetings-out value.
const csvPaths = argv.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1);

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
    Object.assign(section, toFields(primary));
  }

  // `meetings`: only for in-scope sections with 2+ recurring weekly patterns.
  // meetings[0] must be the meeting the top-level fields hold; if it isn't,
  // leave `meetings` off that section rather than write something inconsistent.
  const meetingsByDoc = new Map();
  const inconsistent = [];
  const terms = new Set([...sectionsByKey.values()].map((s) => s.term));
  for (const term of terms) {
    const groups = groupSections(rows, term);
    const noRoom = noRoomPatternsByCourse(groups);
    for (const [docId, group] of groups) {
      if (!inMeetingsScope(group)) continue;
      const built = buildMeetings(group, { noRoomPatterns: noRoom.get(group.courseKey), storedPick: true });
      if (built.recurringCount < 2) continue;
      if (!sameFields(built.meetings[0], sectionsByKey.get(docId))) {
        inconsistent.push({ group, first: built.meetings[0], section: sectionsByKey.get(docId) });
        continue;
      }
      meetingsByDoc.set(docId, built.meetings);
    }
  }
  for (const [key, section] of sectionsByKey) {
    if (meetingsByDoc.has(key)) section.meetings = meetingsByDoc.get(key);
  }

  if (DRY_RUN) {
    console.log(`\n=== ${csvPath}: ${sectionsByKey.size} sections, ${changed.length} with a different meeting row than before`);
    for (const { section, oldRow, newRow } of changed) {
      console.log(`${section.classNbr}  ${section.subjectArea} ${section.catalogNbr} ${section.classSection}  (${section.description})`);
      console.log(`    old: ${describeFields(toFields(oldRow))}`);
      console.log(`    new: ${describeFields(toFields(newRow))}`);
    }
    console.log(`${meetingsByDoc.size} sections would get a \`meetings\` array`);
    for (const { group, first, section } of inconsistent) {
      console.log(`WARNING ${group.docId} ${group.label}: meetings[0] differs from the top-level fields — no \`meetings\` written`);
      console.log(`    top-level:   ${describeFields(section)}`);
      console.log(`    meetings[0]: ${describeFields(first)}`);
    }
    if (MEETINGS_OUT) {
      const out = [...meetingsByDoc].map(([docId, meetings]) => {
        const s = sectionsByKey.get(docId);
        return { classNbr: s.classNbr, docId, courseKey: normalizeCourseKey(s.subjectArea, s.catalogNbr), meetings };
      });
      fs.writeFileSync(MEETINGS_OUT, JSON.stringify(out, null, 2) + '\n');
      console.log(`Wrote ${out.length} sections' meetings to ${MEETINGS_OUT}`);
    }
    return;
  }
  for (const { group } of inconsistent) {
    console.warn(`WARNING ${group.docId} ${group.label}: meetings[0] differs from the top-level fields — no \`meetings\` written`);
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

if (csvPaths.length === 0 || (!DRY_RUN && csvPaths.length > 1)) {
  console.error('Usage: node import-sections.js <path-to-csv>');
  console.error('       node import-sections.js --dry-run [--meetings-out <file.json>] <path-to-csv> [more.csv ...]');
  process.exit(1);
}

(async () => {
  for (const csvPath of csvPaths) await importSections(csvPath);
})().catch((err) => {
  console.error(DRY_RUN ? 'Dry run failed:' : 'Import failed:', err);
  process.exit(1);
});
