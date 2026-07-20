// import-sections.js
// Imports a term's official schedule CSV (e.g. Fall2026Courses.csv) into
// the `sections` Firestore collection. Collapses duplicate rows (the raw
// CSV repeats a row per instructor / per identical section) into one doc
// per section, with an `instructors` array.
//
// Usage:
//   node import-sections.js ./Fall2026Courses.csv
//
// Requires: firebase-admin, csv-parse

const fs = require('fs');
const { parse } = require('csv-parse/sync');
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

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

  for (const row of rows) {
    const term = row['Term']?.trim();
    const classNbr = row['Class Nbr']?.trim();
    if (!term || !classNbr) continue;

    const key = `${term}_${classNbr}`;
    const instructorLast = row["Instructor's Last Name"]?.trim();
    const instructorFirst = row["Instructor's First Name"]?.trim();

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
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
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

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node import-sections.js <path-to-csv>');
  process.exit(1);
}

importSections(csvPath).catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
