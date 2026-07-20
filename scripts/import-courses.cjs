// import-courses.js
// Imports bu_courses_all.csv into the `courses` Firestore collection.
//
// Usage:
//   node import-courses.js ./bu_courses_all.csv
//
// Requires: firebase-admin, csv-parse
// Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing at a service
// account key, or run via `firebase emulators:exec` / gcloud auth.

const fs = require('fs');
const { parse } = require('csv-parse/sync');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

admin.initializeApp({
  credential: admin.applicationDefault(),
});
const db = getFirestore();

// One-hot HUB unit columns as they appear in the CSV header.
const HUB_COLUMNS = [
  'PLM', 'AEX', 'HCO', 'SI1', 'SI2', 'SO1', 'SO2', 'QR1', 'QR2',
  'IIC', 'GCI', 'ETR', 'WIN', 'OSC', 'DME', 'CRT', 'RIL', 'TWC', 'CRI',
];

function normalizeCourseKey(courseNumber) {
  return courseNumber.replace(/\s+/g, '').toUpperCase();
}

async function importCourses(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });

  let batch = db.batch();
  let count = 0;
  let skipped = 0;

  for (const row of rows) {
    const courseNumber = row['Course Number']?.trim();
    if (!courseNumber) {
      skipped++;
      continue;
    }

    const courseKey = normalizeCourseKey(courseNumber);
    const hubUnits = HUB_COLUMNS.filter(
      (col) => (row[col] || '').trim().toUpperCase() === 'X'
    );

    const docRef = db.collection('courses').doc(courseKey);
    batch.set(
      docRef,
      {
        courseNumber,
        name: row['Course Name']?.trim() || '',
        prerequisites: row['Prerequisites']?.trim() || '',
        description: row['Description']?.trim() || '',
        hubUnits,
        lastScraped: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    count++;
    // Firestore batches cap at 500 writes.
    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
      console.log(`Committed ${count} courses...`);
    }
  }

  await batch.commit();
  console.log(`Done. Imported ${count} courses. Skipped ${skipped} rows with no course number.`);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node import-courses.js <path-to-csv>');
  process.exit(1);
}

importCourses(csvPath).catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
