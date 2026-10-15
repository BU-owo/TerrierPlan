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
// `inCurrentTerm` is true when the course has at least one non-cancelled
// section in CURRENT_TERM exactly; omitted otherwise. Same snapshot caveat as
// upcomingSeasons, and independent of offeringPattern.
//
// `inactive` is true when the course has NO offering after Spring 2022 (last
// offered Spring 2022 or earlier, or no offering on record) AND no
// non-cancelled section at or after CURRENT_TERM; omitted otherwise. Summer
// 2022 and later count as offered. Read from the course doc's
// lastOfferedYear; a course last offered in 2022 is resolved from
// offeringHistory/{courseKey} (read-only) since the year alone can't tell
// Spring 2022 from later that year. If that history is missing, the course
// is kept active. The app hides inactive courses where courses are offered
// as choices (see isInactiveCourse in src/utils/courseQuery.js), never
// deletes or hides them anywhere else.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json node scripts/export-catalog.cjs
//
// Output: a compact JSON array, sorted by id, of
//   { id, courseNumber, name, hubUnits, offeringPattern, career, studyAbroad, credits, upcomingSeasons, inCurrentTerm, inactive }
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
  const currentKeys = new Set();
  for (const doc of snap.docs) {
    const { courseKey, term, classStat } = doc.data();
    const label = termLabel(String(term ?? ''));
    if (!courseKey || !label || classStat === 'Cancelled') continue;
    if (String(term) === CURRENT_TERM) currentKeys.add(courseKey);
    if (!byKey.has(courseKey)) byKey.set(courseKey, new Set());
    byKey.get(courseKey).add(label);
  }
  return { byKey, currentKeys, sectionDocs: snap.size };
}

// Last year a course could have been offered without counting as active:
// anything after Spring of this year (Summer/Fall included) is "offered".
const INACTIVE_CUTOFF_YEAR = 2022;
const REQUIREMENTS_DIR = path.join(REPO_ROOT, 'src', 'data', 'requirements');
// Only strings already in key form (labels like "GMS BI 751 credit overlap"
// would otherwise match once their spaces were stripped).
const COURSE_KEY_RE = /^[A-Z]{3}[A-Z]{2}\d+[A-Z]?$/;

// courseKey → true/false: was it offered after Spring CUTOFF, judging by
// offeringHistory? Only called for courses whose lastOfferedYear is the
// cutoff year. Missing history → undefined (caller keeps the course active).
async function loadOfferedAfterSpringCutoff(courseKeys) {
  const result = new Map();
  const CHUNK = 300;
  for (let i = 0; i < courseKeys.length; i += CHUNK) {
    const refs = courseKeys.slice(i, i + CHUNK).map((key) => db.collection('offeringHistory').doc(key));
    const docs = await db.getAll(...refs, { fieldMask: ['history'] });
    for (const doc of docs) {
      if (!doc.exists) continue;
      const history = doc.data().history || [];
      result.set(
        doc.id,
        history.some((h) => {
          if (h.sectionCount === 0) return false;
          const year = Number(h.year);
          return year > INACTIVE_CUTOFF_YEAR || (year === INACTIVE_CUTOFF_YEAR && !/^spring/i.test(String(h.season ?? '')));
        }),
      );
    }
  }
  return result;
}

// Every courseKey-shaped string in src/data/requirements/**/*.json, with the
// files it appears in (courses, options, include/exclude, pool keys, …).
function collectRequirementCourseKeys() {
  const byKey = new Map();
  function walkDir(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walkDir(full);
      else if (name.endsWith('.json')) {
        const rel = path.relative(REPO_ROOT, full);
        JSON.stringify(JSON.parse(fs.readFileSync(full, 'utf8')), (_key, value) => {
          if (typeof value === 'string' && COURSE_KEY_RE.test(value)) {
            if (!byKey.has(value)) byKey.set(value, new Set());
            byKey.get(value).add(rel);
          }
          return value;
        });
      }
    }
  }
  walkDir(REQUIREMENTS_DIR);
  return byKey;
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
    db.collection('courses').select(...FIELDS, 'lastOfferedYear').get(),
    loadUpcomingTerms(),
  ]);

  // Inactive rule (see header). lastOfferedYear isn't exported — it's only
  // read here to decide `inactive`.
  const lastYearById = new Map(snap.docs.map((doc) => [doc.id, doc.data().lastOfferedYear ?? null]));
  const cutoffYearIds = [...lastYearById]
    .filter(([id, year]) => Number(year) === INACTIVE_CUTOFF_YEAR && !upcoming.byKey.has(id))
    .map(([id]) => id);
  const offeredAfterCutoff = await loadOfferedAfterSpringCutoff(cutoffYearIds);
  let ambiguousKeptActive = 0;
  function isInactive(id) {
    if (upcoming.byKey.has(id)) return false;
    const year = lastYearById.get(id);
    if (year === null || year === undefined || year === '') return true; // no offering on record
    if (Number(year) > INACTIVE_CUTOFF_YEAR) return false;
    if (Number(year) < INACTIVE_CUTOFF_YEAR) return true;
    const after = offeredAfterCutoff.get(id);
    if (after === undefined) {
      ambiguousKeptActive += 1;
      return false;
    }
    return !after;
  }

  const courses = snap.docs
    .map(toEntry)
    .map((entry) => withUpcomingSeasons(entry, upcoming.byKey))
    .map((entry) => (upcoming.currentKeys.has(entry.id) ? { ...entry, inCurrentTerm: true } : entry))
    .map((entry) => (isInactive(entry.id) ? { ...entry, inactive: true } : entry))
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
  console.log(`inCurrentTerm:   ${courses.filter((c) => c.inCurrentTerm).length} courses`);

  const byId = new Map(courses.map((c) => [c.id, c]));

  const inactive = courses.filter((c) => c.inactive);
  console.log('\nInactive (no offering after Spring 2022, no section at or after the current term):');
  console.log(`  total courses:            ${courses.length}`);
  console.log(`  inactive:                 ${inactive.length}`);
  console.log(`  inactive with hubUnits:   ${inactive.filter((c) => c.hubUnits?.length).length}`);
  console.log(`  2022, no history (kept active): ${ambiguousKeptActive}`);

  const requirementKeys = collectRequirementCourseKeys();
  const reqInactive = [...requirementKeys].filter(([key]) => byId.get(key)?.inactive);
  const reqMissing = [...requirementKeys].filter(([key]) => !byId.has(key));
  console.log(`\nRequirement JSON courseKeys: ${requirementKeys.size}`);
  console.log(`  inactive (${reqInactive.length}):`);
  for (const [key, files] of reqInactive) console.log(`    ${key}  (${[...files].join(', ')})`);
  console.log(`  missing from catalog (${reqMissing.length}):`);
  for (const [key, files] of reqMissing) console.log(`    ${key}  (${[...files].join(', ')})`);
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
