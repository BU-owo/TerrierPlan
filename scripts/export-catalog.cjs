// scripts/export-catalog.cjs
//
// Exports the `courses` collection to public/courses.json, a static
// catalog file served from Hosting so the app doesn't have to read the
// whole collection from Firestore on every visit.
//
// READ-ONLY against Firestore — this script never writes to the database.
// Re-run after every course import (import-catalog, import-details,
// import-offering-data, ...) so the static file doesn't drift from
// Firestore.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json node scripts/export-catalog.cjs
//
// Output: a compact JSON array, sorted by id, of
//   { id, courseNumber, name, hubUnits, offeringPattern, career, studyAbroad }
// with any field that is undefined/null/empty-array/false omitted.

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'public', 'courses.json');
const FIELDS = ['courseNumber', 'name', 'hubUnits', 'offeringPattern', 'career', 'studyAbroad'];
const SAMPLE_IDS = ['CASCS111', 'CASAH716'];

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set — point it at the service-account key (outside the repo).');
  process.exit(1);
}
if (path.resolve(keyPath).startsWith(REPO_ROOT + path.sep)) {
  console.warn(`WARNING: service-account key is inside the repo (${keyPath}). Move it out so it can't be committed.`);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

function isOmitted(value) {
  return value === undefined || value === null || value === false || (Array.isArray(value) && value.length === 0);
}

function toEntry(doc) {
  const data = doc.data();
  const entry = { id: doc.id };
  for (const field of FIELDS) {
    if (!isOmitted(data[field])) entry[field] = data[field];
  }
  return entry;
}

async function main() {
  const snap = await db.collection('courses').select(...FIELDS).get();
  const courses = snap.docs.map(toEntry).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const json = JSON.stringify(courses);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, json);

  const rawBytes = Buffer.byteLength(json);
  const gzipBytes = zlib.gzipSync(json).length;
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

  console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log(`Docs:    ${courses.length}`);
  console.log(`Raw:     ${kb(rawBytes)} (${rawBytes} bytes)`);
  console.log(`Gzipped: ${kb(gzipBytes)} (${gzipBytes} bytes)`);

  const byId = new Map(courses.map((c) => [c.id, c]));
  const studyAbroad = courses.find((c) => c.studyAbroad && c.id.endsWith('E'));
  console.log('\nSamples:');
  for (const id of SAMPLE_IDS) {
    console.log(`  ${id}: ${byId.has(id) ? JSON.stringify(byId.get(id)) : 'not found'}`);
  }
  console.log(`  study-abroad (E): ${studyAbroad ? JSON.stringify(studyAbroad) : 'not found'}`);
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
