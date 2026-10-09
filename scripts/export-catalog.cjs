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
// `upcomingSeasons` is a SNAPSHOT of the `sections` collection at export
// time, not a live value: re-run this script after every term import
// (import-sections.cjs) and after CURRENT_TERM in src/utils/term.js moves,
// or it goes stale. It lists the terms (e.g. ["Spring 2027"]) that have at
// least one non-cancelled section at or after CURRENT_TERM, and is only
// emitted when one of those seasons isn't already a usual season for the
// course's offeringPattern (see USUAL_SEASONS), to keep the file small.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json node scripts/export-catalog.cjs
//
// Output: a compact JSON array, sorted by id, of
//   { id, courseNumber, name, hubUnits, offeringPattern, career, studyAbroad, credits, upcomingSeasons }
// with any field that is undefined/null/empty-array/false omitted.

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'public', 'courses.json');
const FIELDS = ['courseNumber', 'name', 'hubUnits', 'offeringPattern', 'career', 'studyAbroad', 'credits', 'upcomingSeasons'];
const SAMPLE_IDS = ['CASCS111', 'CASAH716', 'SARHS438'];

// Read CURRENT_TERM from the app's own constant (an ES module) so the two
// can't drift apart.
const TERM_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'src', 'utils', 'term.js'), 'utf8');
const CURRENT_TERM = /export const CURRENT_TERM = '(\d{4})'/.exec(TERM_SOURCE)?.[1];
if (!CURRENT_TERM) {
  console.error('Could not read CURRENT_TERM from src/utils/term.js.');
  process.exit(1);
}

// PeopleSoft term code: "2", a two-digit year, then a season digit.
const SEASON_BY_TERM_DIGIT = { 1: 'Spring', 5: 'Summer', 6: 'Summer', 8: 'Fall' };
function termLabel(term) {
  const m = /^2(\d{2})([1568])$/.exec(term);
  return m ? `${SEASON_BY_TERM_DIGIT[m[2]]} ${2000 + Number(m[1])}` : null;
}

// Seasons each offeringPattern already counts as usual. Keep in sync with
// USUAL_SEASONS in src/utils/offeringPattern.js. Patterns not listed here
// (Random, Insufficient data, missing) show no badge or warning, so an
// upcoming section adds nothing for them.
const USUAL_SEASONS = {
  Fall: ['Fall'],
  Spring: ['Spring'],
  'Alternating Fall': ['Fall'],
  'Alternating Spring': ['Spring'],
  Summer: ['Summer'],
  'Fall and Spring': ['Fall', 'Spring'],
  'Not offered in 5 years': [],
};

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

// courseKey → Set of term labels with a non-cancelled section at or after
// CURRENT_TERM. Same "not cancelled" rule as withCurrentTermEntry in
// CourseInfoPanel.jsx. Term codes are same-length strings, so >= compares
// them in term order.
async function loadUpcomingTerms() {
  const snap = await db
    .collection('sections')
    .where('term', '>=', CURRENT_TERM)
    .select('courseKey', 'term', 'classStat')
    .get();
  const byKey = new Map();
  for (const doc of snap.docs) {
    const { courseKey, term, classStat } = doc.data();
    const label = termLabel(String(term ?? ''));
    if (!courseKey || !label || classStat === 'Cancelled') continue;
    if (!byKey.has(courseKey)) byKey.set(courseKey, new Set());
    byKey.get(courseKey).add(label);
  }
  return { byKey, sectionDocs: snap.size };
}

function withUpcomingSeasons(entry, upcomingByKey) {
  const usual = USUAL_SEASONS[entry.offeringPattern];
  const upcoming = upcomingByKey.get(entry.id);
  if (!usual || !upcoming) return entry;
  const labels = [...upcoming].sort();
  if (!labels.some((label) => !usual.includes(label.split(' ')[0]))) return entry;
  return { ...entry, upcomingSeasons: labels };
}

async function main() {
  const [snap, upcoming] = await Promise.all([
    db.collection('courses').select(...FIELDS).get(),
    loadUpcomingTerms(),
  ]);
  const courses = snap.docs
    .map(toEntry)
    .map((entry) => withUpcomingSeasons(entry, upcoming.byKey))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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
  console.log(
    `upcomingSeasons: ${courses.filter((c) => c.upcomingSeasons).length} courses ` +
      `(from ${upcoming.sectionDocs} sections at or after ${CURRENT_TERM})`,
  );

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
