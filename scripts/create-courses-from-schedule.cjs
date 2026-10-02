// scripts/create-courses-from-schedule.cjs
//
// Creates `courses` docs for courses that appear in a term's schedule download
// but are missing from the catalog (public/courses.json). The schedule file
// is the source of truth: name, courseNumber and career all come from it.
//
// DRY RUN BY DEFAULT — reads two local files and writes nothing (no Firestore
// access, no credentials needed). --commit writes with create(), so an
// existing doc makes that one create fail instead of being overwritten; the
// rest still go through and every failure is reported.
//
// Doc shape mirrors import-catalog.cjs's --create-new payload, minus
// everything that would be invented rather than read from the schedule:
//   written:  name, courseNumber, career, studyAbroad (false), inScheduleData
//             (true), source ('schedule-history'), nameIsAbbreviated (true),
//             createdAt
//   omitted:  hubUnits, description, prerequisites (never written by
//             import-catalog either), offeringPattern / ratios / seasons /
//             first-last-offered fields, and the offeringHistory/{key} doc —
//             one term of a published schedule is not offering history.
//
// Usage:
//   node scripts/create-courses-from-schedule.cjs                     (dry run)
//   node scripts/create-courses-from-schedule.cjs --career Undergrad  (dry run, one career)
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//     node scripts/create-courses-from-schedule.cjs --commit
//
// Options:
//   --input <path>    Schedule CSV, UTF-8.
//                     Default: scheduleclasses/BU_R0032B_Spring2027_utf8.csv
//   --catalog <path>  Existing catalog for the "already there?" check.
//                     Default: public/courses.json
//   --career <name>   Only keys whose rows' career is this (Undergrad, Graduate, ...)
//   --commit          Write the docs (needs GOOGLE_APPLICATION_CREDENTIALS)

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const REPO_ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const INPUT = path.resolve(REPO_ROOT, argValue('--input', 'scheduleclasses/BU_R0032B_Spring2027_utf8.csv'));
const CATALOG = path.resolve(REPO_ROOT, argValue('--catalog', 'public/courses.json'));
const CAREER_FILTER = argValue('--career', null);
const SHOW_DOCS = 15;

// Same rule as import-sections.cjs's normalizeCourseKey.
function normalizeCourseKey(subjectArea, catalogNbr) {
  return `${subjectArea}${catalogNbr}`.replace(/\s+/g, '').toUpperCase();
}

// Same derivation as import-catalog.cjs: "CASNE557" -> "CAS NE 557".
const KEY_RE = /^([A-Z]{3})([A-Z]{2})(\d+(?:\.\d+)?)([A-Z]*)$/;
function deriveCourseNumber(key) {
  const m = KEY_RE.exec(key);
  return m ? `${m[1]} ${m[2]} ${m[3]}${m[4]}` : null;
}

function readUtf8Strict(file) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
  } catch {
    console.error(`${file} is not valid UTF-8 (a cp1252 export?). Convert it first.`);
    process.exit(1);
  }
}

function countBy(items, fn) {
  const out = {};
  for (const it of items) {
    const k = fn(it);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function buildCandidates() {
  const rows = parse(readUtf8Strict(INPUT), { columns: true, skip_empty_lines: true, bom: true });
  const catalog = new Set(JSON.parse(fs.readFileSync(CATALOG, 'utf8')).map((c) => c.id));

  // One entry per courseKey; keeps every distinct title/career/class-status
  // seen across that key's rows (a section repeats a row per instructor/meeting).
  const byKey = new Map();
  for (const row of rows) {
    const subject = row['Subject Area']?.trim();
    const catalogNbr = row['Catalog Nbr']?.trim();
    if (!subject || !catalogNbr) continue;
    const key = normalizeCourseKey(subject, catalogNbr);
    if (!byKey.has(key)) byKey.set(key, { key, titles: [], careers: [], statuses: new Set(), courseIds: new Set(), terms: new Set() });
    const e = byKey.get(key);
    const title = row['Description']?.trim() || '';
    const career = row['Career']?.trim() || '';
    if (!e.titles.includes(title)) e.titles.push(title);
    if (!e.careers.includes(career)) e.careers.push(career);
    e.statuses.add(row['Class Stat']?.trim());
    e.courseIds.add(row['Course ID']?.trim());
    e.terms.add(row['Term']?.trim());
  }

  const present = [];
  const foldedS = [];
  const unparseable = [];
  const candidates = [];
  for (const e of byKey.values()) {
    if (catalog.has(e.key)) {
      present.push(e.key);
    } else if (/\dS$/.test(e.key) && catalog.has(e.key.slice(0, -1))) {
      foldedS.push(e.key);
    } else if (!deriveCourseNumber(e.key)) {
      unparseable.push(e.key);
    } else {
      candidates.push(e);
    }
  }
  return { rows, byKey, present, foldedS, unparseable, candidates };
}

// The doc as it will be written. createdAt is a server timestamp only on
// --commit; a dry run shows a placeholder so nothing needs firebase-admin.
function buildDoc(e, createdAt) {
  return {
    name: e.titles.find(Boolean) || '',
    courseNumber: deriveCourseNumber(e.key),
    career: e.careers.find(Boolean) ?? null,
    studyAbroad: false,
    inScheduleData: true,
    source: 'schedule-history',
    nameIsAbbreviated: true,
    createdAt,
  };
}

async function commit(docs) {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set — needed for --commit.');
    process.exit(1);
  }
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const created = [];
  const failed = [];
  for (const { key, doc } of docs) {
    try {
      // create() rejects if the doc already exists — never overwrites.
      // eslint-disable-next-line no-await-in-loop
      await db.collection('courses').doc(key).create({ ...doc, createdAt: FieldValue.serverTimestamp() });
      created.push(key);
    } catch (err) {
      failed.push({ key, error: err.code === 6 ? 'already exists' : err.message });
    }
  }
  console.log(`\nCreated ${created.length}, failed ${failed.length}.`);
  for (const f of failed) console.log(`  FAILED ${f.key}: ${f.error}`);
}

async function main() {
  const { rows, byKey, present, foldedS, unparseable, candidates: allCandidates } = buildCandidates();
  const candidates = CAREER_FILTER ? allCandidates.filter((e) => e.careers.includes(CAREER_FILTER)) : allCandidates;
  candidates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const terms = [...new Set(rows.map((r) => r['Term']?.trim()))];
  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} — nothing is written unless --commit is passed`);
  console.log(`Schedule: ${INPUT}`);
  console.log(`  ${rows.length} rows, ${byKey.size} distinct courseKeys, term(s): ${terms.join(', ')}`);
  console.log(`Catalog:  ${CATALOG}`);
  console.log(`  already in catalog: ${present.length} | skipped, base key (one S removed) is in catalog: ${foldedS.length}${foldedS.length ? ` (${foldedS.join(', ')})` : ''}`);
  if (unparseable.length) console.log(`  SKIPPED, can't derive courseNumber: ${unparseable.join(', ')}`);
  if (CAREER_FILTER) console.log(`  --career ${CAREER_FILTER}: ${allCandidates.length} missing overall, ${candidates.length} after the filter`);

  console.log(`\nMissing from catalog: ${candidates.length} courses`);
  console.log('By career (a key listed under more than one career counts under each):');
  const careerCounts = {};
  for (const e of candidates) for (const c of e.careers) careerCounts[c] = (careerCounts[c] || 0) + 1;
  console.table(careerCounts);
  console.log('By school prefix:', countBy(candidates, (e) => e.key.slice(0, 3)));

  const docs = candidates.map((e) => ({ key: e.key, doc: buildDoc(e, '<serverTimestamp on --commit>') }));

  console.log(`\nFirst ${Math.min(SHOW_DOCS, docs.length)} docs in full (docs/<courseKey>):`);
  for (const { key, doc } of docs.slice(0, SHOW_DOCS)) console.log(`  ${key}`, JSON.stringify(doc));

  const titleConflicts = candidates.filter((e) => e.titles.filter(Boolean).length > 1);
  const careerConflicts = candidates.filter((e) => e.careers.length > 1);
  const allCancelled = candidates.filter((e) => [...e.statuses].every((s) => s === 'Cancelled'));
  console.log(`\nKeys with conflicting titles across rows: ${titleConflicts.length}`);
  for (const e of titleConflicts) console.log(`  ${e.key}: ${e.titles.map((t) => JSON.stringify(t)).join(' | ')}  -> using ${JSON.stringify(e.titles.find(Boolean))}`);
  console.log(`Keys with more than one career across rows: ${careerConflicts.length}`);
  for (const e of careerConflicts) console.log(`  ${e.key}: ${e.careers.join(' | ')}  -> using ${e.careers[0]}`);
  console.log(`Keys whose every section is Cancelled: ${allCancelled.length}${allCancelled.length ? ` (${allCancelled.map((e) => e.key).join(', ')})` : ''}`);

  const probe = docs.find((d) => d.key === 'CASNE557');
  console.log(`\nCheck CASNE557: ${probe ? `present — name ${JSON.stringify(probe.doc.name)}, courseNumber ${JSON.stringify(probe.doc.courseNumber)}, career ${JSON.stringify(probe.doc.career)}` : 'NOT in the output'}`);

  if (!COMMIT) {
    console.log('\nDry run only. Re-run with --commit to write these with create().');
    return;
  }
  await commit(docs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
