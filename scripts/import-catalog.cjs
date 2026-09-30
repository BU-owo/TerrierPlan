// scripts/import-catalog.cjs
//
// Integrates scripts/courses.new.json (schedule-history catalog, keyed by
// courseId: title, career, studyAbroad, offeringPattern, offeringDetail,
// history) into the `courses` collection.
//
// DRY RUN BY DEFAULT. Nothing is written unless --commit is passed together
// with an explicit mode flag.
//
// Modes:
//   --update-existing  Merge offering data + career/studyAbroad onto courses
//                      docs that already exist, write offeringHistory/{key},
//                      and flag docs that exist in Firestore but not in the
//                      JSON (inScheduleData: false — never deleted).
//   --create-new       Create courses docs for JSON ids with no doc yet
//                      (name/courseNumber derived from the schedule data,
//                      source: 'schedule-history'), plus offeringHistory/{key}.
//   (no mode flag)     Dry run of both. --commit without a mode flag is
//                      refused.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/import-catalog.cjs
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/import-catalog.cjs --update-existing --commit
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/import-catalog.cjs --create-new --commit
//
// Options:
//   --input <path>   Default: scripts/courses.new.json
//   --term <code>    Sections term for the coverage check. Default: 2268 (Fall 2026)
//
// Never writes name, courseNumber, hubUnits, description or prerequisites
// onto an existing doc, and never writes hubUnits, description or
// prerequisites at all — enforced by assertPayload(), which aborts the run.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const MODE_UPDATE = args.includes('--update-existing');
const MODE_CREATE = args.includes('--create-new');
const NO_MODE = !MODE_UPDATE && !MODE_CREATE;
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const INPUT = path.resolve(argValue('--input', path.join(__dirname, 'courses.new.json')));
const SECTIONS_TERM = argValue('--term', '2268');

const BATCH_SIZE = 400;
const CAREERS = ['Undergrad', 'Graduate', 'Law', 'Dental', 'Medical'];
const TITLE_CAP = 30; // schedule titles are abbreviations capped at 30 chars

// Fields that must never be written onto an EXISTING doc (bulletin-owned),
// and the subset that must never be written at all (not in schedule data).
const PROTECTED_ON_EXISTING = ['name', 'courseNumber', 'hubUnits', 'description', 'prerequisites'];
const NEVER_WRITTEN = ['hubUnits', 'description', 'prerequisites'];

if (COMMIT && NO_MODE) {
  console.error('Refusing --commit without --update-existing or --create-new.');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set (needed even for a dry run, which reads Firestore).');
  process.exit(1);
}

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue, FieldPath } = require('firebase-admin/firestore');

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

// "CASWR151" -> "CAS WR 151", "ENGEK497E" -> "ENG EK 497E", "MEDMS400.1B" -> "MED MS 400.1B".
const KEY_RE = /^([A-Z]{3})([A-Z]{2})(\d+(?:\.\d+)?)([A-Z]*)$/;
function deriveCourseNumber(key) {
  const m = KEY_RE.exec(key);
  return m ? `${m[1]} ${m[2]} ${m[3]}${m[4]}` : null;
}
function suffixOf(key) {
  const m = /^[A-Z]+\d+(?:\.\d+)?([A-Z]*)$/.exec(key);
  return m ? m[1] || '(none)' : '(unparsed)';
}
function careerOf(entry) {
  return CAREERS.includes(entry.career) ? entry.career : '(other)';
}

function assertPayload(kind, key, payload) {
  const forbidden = kind === 'create' ? NEVER_WRITTEN : PROTECTED_ON_EXISTING;
  const hit = forbidden.filter((f) => Object.prototype.hasOwnProperty.call(payload, f));
  if (hit.length > 0) {
    throw new Error(`ABORT: ${kind} payload for ${key} contains protected field(s): ${hit.join(', ')}`);
  }
}

function offeringFields(entry) {
  const detail = entry.offeringDetail || {};
  return {
    offeringPattern: entry.offeringPattern || null,
    offeredSeasons: detail.offeredSeasons || [],
    fallRatio: detail.fallRatio ?? null,
    springRatio: detail.springRatio ?? null,
    summerRatio: detail.summerRatio ?? null,
    firstOfferedYear: detail.firstOfferedYear ?? null,
    lastOfferedYear: detail.lastOfferedYear ?? null,
    datasetYearsAvailable: detail.datasetYearsAvailable ?? null,
    offeringDataUpdatedAt: FieldValue.serverTimestamp(),
  };
}

function updatePayload(entry) {
  return {
    career: entry.career ?? null,
    studyAbroad: Boolean(entry.studyAbroad),
    inScheduleData: true,
    ...offeringFields(entry),
  };
}

function createPayload(key, entry) {
  const courseNumber = deriveCourseNumber(key);
  if (!courseNumber) throw new Error(`ABORT: cannot derive courseNumber for ${key}`);
  return {
    ...updatePayload(entry),
    name: entry.title || '',
    courseNumber,
    source: 'schedule-history',
    nameIsAbbreviated: true,
    createdAt: FieldValue.serverTimestamp(),
  };
}

function flagPayload() {
  return { inScheduleData: false, scheduleDataCheckedAt: FieldValue.serverTimestamp() };
}

function historyPayload(entry) {
  return { history: entry.history || [], updatedAt: FieldValue.serverTimestamp() };
}

// Paginated, field-projected reads.
async function readAll(query, fields) {
  const out = [];
  let last = null;
  for (;;) {
    let q = query.select(...fields).orderBy(FieldPath.documentId()).limit(5000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    if (snap.size < 5000) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}

// Truncated-looking created names: exactly at the cap first, then ones whose
// last word has no vowel (e.g. "Mgmt", "Stdy"), then by length.
function abbreviationScore(name) {
  const last = name.trim().split(/\s+/).pop() || '';
  return (name.length === TITLE_CAP ? 2 : 0) + (/[AEIOUY]/i.test(last) ? 0 : 1);
}

async function commitOps(ops, label) {
  let batch = db.batch();
  let inBatch = 0;
  let committed = 0;
  for (const op of ops) {
    op(batch);
    inBatch++;
    if (inBatch >= BATCH_SIZE) {
      await batch.commit();
      committed += inBatch;
      console.log(`  ${label}: committed ${committed}/${ops.length} ops`);
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) {
    await batch.commit();
    committed += inBatch;
  }
  console.log(`  ${label}: done, ${committed} ops`);
}

async function main() {
  const json = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const keys = Object.keys(json);
  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} — modes: ${NO_MODE ? 'update-existing + create-new (dry run)' : [MODE_UPDATE && 'update-existing', MODE_CREATE && 'create-new'].filter(Boolean).join(' + ')}`);
  console.log(`Input: ${INPUT} (${keys.length} ids)`);

  const existing = new Set((await readAll(db.collection('courses'), [])).map((d) => d.id));
  console.log(`Firestore courses docs: ${existing.size}`);

  const toUpdate = keys.filter((k) => existing.has(k));
  const toCreate = keys.filter((k) => !existing.has(k));
  const toFlag = [...existing].filter((k) => !json[k]);

  // Build every payload up front (dry run included) so the assertions run
  // over the full set before anything could be written.
  const updateOps = [];
  const createOps = [];
  for (const k of toUpdate) {
    const p = updatePayload(json[k]);
    assertPayload('update', k, p);
    updateOps.push((b) => b.update(db.collection('courses').doc(k), p));
    updateOps.push((b) => b.set(db.collection('offeringHistory').doc(k), historyPayload(json[k]), { merge: true }));
  }
  for (const k of toFlag) {
    const p = flagPayload();
    assertPayload('flag', k, p);
    updateOps.push((b) => b.update(db.collection('courses').doc(k), p));
  }
  for (const k of toCreate) {
    const p = createPayload(k, json[k]);
    assertPayload('create', k, p);
    // create() fails if the doc appeared since the read above — never overwrites.
    createOps.push((b) => b.create(db.collection('courses').doc(k), p));
    createOps.push((b) => b.set(db.collection('offeringHistory').doc(k), historyPayload(json[k]), { merge: true }));
  }

  // ---- Report ----
  const perCareer = {};
  for (const c of [...CAREERS, '(other)']) perCareer[c] = { created: 0, updated: 0, createdStudyAbroad: 0 };
  for (const k of toUpdate) perCareer[careerOf(json[k])].updated++;
  for (const k of toCreate) {
    perCareer[careerOf(json[k])].created++;
    if (json[k].studyAbroad) perCareer[careerOf(json[k])].createdStudyAbroad++;
  }
  console.log('\nPer career (flagged docs have no JSON entry, so no career — counted separately):');
  console.table(perCareer);
  console.log(`Totals: created ${toCreate.length} | updated ${toUpdate.length} | flagged ${toFlag.length}`);
  console.log(`Created with studyAbroad: true — ${toCreate.filter((k) => json[k].studyAbroad).length}`);
  console.log(`Flagged examples: ${toFlag.slice(0, 10).join(', ')}`);

  const created = toCreate.map((k) => ({ key: k, name: json[k].title || '' }));
  const atCap = created.filter((c) => c.name.length === TITLE_CAP).length;
  console.log(`\nCreated names at exactly ${TITLE_CAP} chars: ${atCap} of ${created.length}. Most abbreviated-looking 20:`);
  created
    .sort((a, b) => abbreviationScore(b.name) - abbreviationScore(a.name) || b.name.length - a.name.length)
    .slice(0, 20)
    .forEach((c) => console.log(`  ${c.key.padEnd(12)} ${deriveCourseNumber(c.key).padEnd(15)} "${c.name}"`));

  console.log(`\nFinal catalog size: ${existing.size + toCreate.length} (from ${existing.size})`);
  console.log(`Batched ops: update-existing ${updateOps.length} (${Math.ceil(updateOps.length / BATCH_SIZE)} batches), create-new ${createOps.length} (${Math.ceil(createOps.length / BATCH_SIZE)} batches)`);

  // Section coverage after creation (read-only).
  const sections = await readAll(db.collection('sections').where('term', '==', SECTIONS_TERM), ['courseKey']);
  const sectionKeys = [...new Set(sections.map((s) => s.courseKey))];
  const afterCreate = new Set([...existing, ...toCreate]);
  const stillMissing = sectionKeys.filter((k) => !afterCreate.has(k));
  const nowMissingBefore = sectionKeys.filter((k) => !existing.has(k)).length;
  const bySuffix = {};
  for (const k of stillMissing) (bySuffix[suffixOf(k)] ??= []).push(k);
  console.log(`\nTerm ${SECTIONS_TERM}: ${sectionKeys.length} distinct section courseKeys; no courses doc now: ${nowMissingBefore}; after create-new: ${stillMissing.length}`);
  for (const [suffix, list] of Object.entries(bySuffix).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${suffix}: ${list.length}`);
  }
  console.log(`  examples: ${stillMissing.slice(0, 15).join(', ')}`);

  console.log('\nSample payloads (serverTimestamp shown as a sentinel):');
  if (toUpdate[0]) console.log('  update', toUpdate[0], JSON.stringify(updatePayload(json[toUpdate[0]])));
  if (toCreate[0]) console.log('  create', toCreate[0], JSON.stringify(createPayload(toCreate[0], json[toCreate[0]])));
  if (toFlag[0]) console.log('  flag  ', toFlag[0], JSON.stringify(flagPayload()));

  if (!COMMIT) {
    console.log('\nDry run only — nothing written. Re-run with a mode flag and --commit to write.');
    return;
  }
  if (MODE_UPDATE) await commitOps(updateOps, 'update-existing');
  if (MODE_CREATE) await commitOps(createOps, 'create-new');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
