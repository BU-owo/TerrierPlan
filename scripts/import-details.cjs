// scripts/import-details.cjs
//
// Fills name / description / prerequisites / hubUnits on courses docs created
// by import-catalog.cjs --create-new (source: 'schedule-history'), from the
// CSV written by scripts/scrape-missing.py (HUB pages).
//
// DRY RUN BY DEFAULT. Nothing is written unless --commit is passed.
//
// Rules (per doc):
//   name          replaced only when nameIsAbbreviated === true; then
//                 nameIsAbbreviated is set to false.
//   description   set only when the doc's is empty/missing.
//   prerequisites set only when the doc's is empty/missing.
//   hubUnits      codes missing from the doc are added; none are removed.
//   detailsSource 'hub-pages', detailsImportedAt: server timestamp.
// Docs that don't exist or whose source isn't 'schedule-history' are skipped
// (never created). A doc that would only get detailsSource/At is skipped.
// assertPayload() aborts the run if a payload holds any other key.
// Writes go in batches of 400, each update preconditioned on the doc's
// updateTime at read, so a doc changed since the read fails its batch.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/import-details.cjs [--commit]
//   node scripts/import-details.cjs --simulate-created
//
// Options:
//   --input <path>        Default: ../TerrierPlan-out/hub-missing.csv (sibling of the repo)
//   --skip-s-derived      Ignore rows whose card came from the S variant.
//   --simulate-created    No Firestore: treat every courses.new.json ID missing
//                         from bu_courses_all.csv as the doc import-catalog.cjs
//                         --create-new would create, and report what this
//                         import would fill.

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const SIMULATE = args.includes('--simulate-created');
const SKIP_S = args.includes('--skip-s-derived');
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const REPO = path.resolve(__dirname, '..');
const INPUT = path.resolve(argValue('--input', path.join(REPO, '..', 'TerrierPlan-out', 'hub-missing.csv')));

const BATCH_SIZE = 400;
const READ_CHUNK = 300;
const CAREERS = ['Undergrad', 'Graduate', 'Law', 'Dental', 'Medical'];
const ALLOWED_KEYS = new Set([
  'name', 'nameIsAbbreviated', 'description', 'prerequisites', 'hubUnits',
  'detailsSource', 'detailsImportedAt',
]);
const CONTENT_KEYS = ['name', 'description', 'prerequisites', 'hubUnits'];

if (COMMIT && SIMULATE) {
  console.error('--simulate-created never writes; drop --commit.');
  process.exit(1);
}

const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === '');

function assertPayload(key, payload) {
  const extra = Object.keys(payload).filter((k) => !ALLOWED_KEYS.has(k));
  if (extra.length > 0) {
    throw new Error(`ABORT: payload for ${key} contains disallowed key(s): ${extra.join(', ')}`);
  }
}

// doc: current Firestore data. row: CSV row. Returns null when nothing would change.
function buildPayload(doc, row, timestamp) {
  const p = {};
  if (doc.nameIsAbbreviated === true && !isEmpty(row.title)) {
    p.name = row.title.trim();
    p.nameIsAbbreviated = false;
  }
  if (isEmpty(doc.description) && !isEmpty(row.description)) p.description = row.description.trim();
  if (isEmpty(doc.prerequisites) && !isEmpty(row.prerequisites)) p.prerequisites = row.prerequisites.trim();
  const current = Array.isArray(doc.hubUnits) ? doc.hubUnits : [];
  const added = row.hub_units.split(/\s+/).filter((c) => c && !current.includes(c));
  if (added.length > 0) p.hubUnits = [...current, ...added];
  if (!CONTENT_KEYS.some((k) => k in p)) return null;
  p.detailsSource = 'hub-pages';
  p.detailsImportedAt = timestamp;
  return p;
}

function loadRows() {
  const rows = parse(fs.readFileSync(INPUT, 'utf8'), { columns: true, skip_empty_lines: true });
  const kept = SKIP_S ? rows.filter((r) => r.s_derived !== 'True') : rows;
  const byId = new Map(kept.map((r) => [r.id, r]));
  if (byId.size !== kept.length) throw new Error('ABORT: duplicate ids in input CSV');
  console.log(`Input: ${INPUT} (${rows.length} rows${SKIP_S ? `, ${rows.length - kept.length} S-derived skipped` : ''})`);
  return byId;
}

function emptyCounts() {
  return { createdIds: 0, withRow: 0, name: 0, nameChanged: 0, description: 0, prerequisites: 0, hubUnits: 0, sDerived: 0, stillNothing: 0 };
}

function tally(counts, payload, row, oldName) {
  if (!row) return;
  counts.withRow++;
  if (row.s_derived === 'True') counts.sDerived++;
  if (!payload) return;
  for (const k of CONTENT_KEYS) if (k in payload) counts[k]++;
  if ('name' in payload && payload.name !== oldName) counts.nameChanged++;
}

// ---- Simulation: docs as import-catalog.cjs createPayload() would write them ----
function simulate(rowsById) {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'courses.new.json'), 'utf8'));
  const csvIds = new Set(
    parse(fs.readFileSync(path.join(REPO, 'bu_courses_all.csv'), 'utf8'), { columns: true, skip_empty_lines: true })
      .map((r) => (r['Course Number'] || '').replace(/\s+/g, '').toUpperCase()),
  );
  const created = Object.keys(catalog).filter((k) => !csvIds.has(k));
  console.log(`SIMULATION — no Firestore. Created ids (courses.new.json minus bu_courses_all.csv): ${created.length}`);

  const perCareer = {};
  for (const c of [...CAREERS, '(other)']) perCareer[c] = emptyCounts();
  const examples = [];
  for (const k of created) {
    const entry = catalog[k];
    const career = CAREERS.includes(entry.career) ? entry.career : '(other)';
    const doc = { name: entry.title || '', nameIsAbbreviated: true, source: 'schedule-history' };
    const row = rowsById.get(k);
    const payload = row ? buildPayload(doc, row, '<serverTimestamp>') : null;
    if (payload) assertPayload(k, payload);
    const c = perCareer[career];
    c.createdIds++;
    tally(c, payload, row, doc.name);
    // Created docs start with no description, prerequisites or hubUnits.
    if (!payload || (!payload.description && !payload.prerequisites && !payload.hubUnits)) c.stillNothing++;
    if (payload) examples.push({ k, career, doc, row, payload });
  }
  const unmatched = [...rowsById.keys()].filter((k) => !created.includes(k));

  console.log('\nPer career (counts are created ids that would receive each field):');
  console.table(perCareer);
  console.log('name = name replaced (nameIsAbbreviated -> false); nameChanged = new text differs from the abbreviation.');
  console.log('stillNothing = no description, prerequisites or HUB units after this import.');
  console.log(`Created Undergrad ids still with nothing: ${perCareer.Undergrad.stillNothing} of ${perCareer.Undergrad.createdIds}`);
  console.log(`CSV rows not among created ids: ${unmatched.length}${unmatched.length ? ` (${unmatched.slice(0, 10).join(', ')})` : ''}`);

  // 15 examples spread across the list, S-derived and prereq-split variety included.
  const pick = [];
  const pushIf = (pred, n) => examples.filter((e) => pred(e) && !pick.includes(e)).slice(0, n).forEach((e) => pick.push(e));
  pushIf((e) => e.row.s_derived === 'True', 2);
  pushIf((e) => e.row.prereq_split === 'sentence', 2);
  pushIf((e) => e.career !== 'Undergrad', 2);
  const step = Math.max(1, Math.floor(examples.length / 9));
  for (let i = 0; pick.length < 15 && i < examples.length; i += step) if (!pick.includes(examples[i])) pick.push(examples[i]);
  console.log('\n15 example rows:');
  for (const e of pick) {
    const p = e.payload;
    console.log(`\n  ${e.k} [${e.career}]${e.row.s_derived === 'True' ? ` S-derived from ${e.row.matched_card_id}` : ''}`);
    console.log(`    name:   "${e.doc.name}" -> "${p.name ?? '(unchanged)'}"`);
    console.log(`    prereq: ${p.prerequisites ? `"${p.prerequisites.slice(0, 100)}" (${e.row.prereq_split})` : '(none)'}`);
    console.log(`    desc:   ${p.description ? `"${p.description.slice(0, 100)}…"` : '(none)'}`);
    console.log(`    hub:    ${p.hubUnits ? p.hubUnits.join(' ') : '(none)'}`);
    console.log(`    keys:   ${Object.keys(p).join(', ')}`);
  }
}

// ---- Firestore: update existing schedule-history docs only ----
async function run(rowsById) {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set (needed even for a dry run, which reads Firestore).');
    process.exit(1);
  }
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'}`);

  const ids = [...rowsById.keys()];
  const snaps = [];
  for (let i = 0; i < ids.length; i += READ_CHUNK) {
    const refs = ids.slice(i, i + READ_CHUNK).map((k) => db.collection('courses').doc(k));
    snaps.push(...(await db.getAll(...refs)));
  }

  const skipped = { missing: 0, otherSource: 0, noChange: 0 };
  const perCareer = {};
  for (const c of [...CAREERS, '(other)']) perCareer[c] = emptyCounts();
  const updates = [];
  for (const snap of snaps) {
    if (!snap.exists) { skipped.missing++; continue; }
    const doc = snap.data();
    if (doc.source !== 'schedule-history') { skipped.otherSource++; continue; }
    const row = rowsById.get(snap.id);
    const payload = buildPayload(doc, row, FieldValue.serverTimestamp());
    const career = CAREERS.includes(doc.career) ? doc.career : '(other)';
    perCareer[career].createdIds++;
    tally(perCareer[career], payload, row, doc.name);
    if (!payload) { skipped.noChange++; continue; }
    assertPayload(snap.id, payload);
    updates.push({ ref: snap.ref, payload, updateTime: snap.updateTime });
  }

  console.log('\nPer career (schedule-history docs matched by the CSV):');
  console.table(perCareer);
  console.log(`Skipped: ${JSON.stringify(skipped)}`);
  console.log(`Updates: ${updates.length} in ${Math.ceil(updates.length / BATCH_SIZE)} batches`);
  if (updates[0]) console.log('Sample', updates[0].ref.id, JSON.stringify(updates[0].payload));

  if (!COMMIT) {
    console.log('\nDry run only — nothing written. Re-run with --commit to write.');
    return;
  }
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + BATCH_SIZE)) {
      // Fails the whole batch if the doc changed after it was read.
      batch.update(u.ref, u.payload, { lastUpdateTime: u.updateTime });
    }
    try {
      await batch.commit();
    } catch (err) {
      throw new Error(`ABORT: batch starting at ${i} failed (${err.code || ''} ${err.message}). ${i} updates committed before it; re-run to re-read and retry.`);
    }
    console.log(`  committed ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`);
  }
}

const rowsById = loadRows();
(SIMULATE ? Promise.resolve(simulate(rowsById)) : run(rowsById)).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
