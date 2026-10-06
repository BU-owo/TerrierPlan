// scripts/backfill-schedule-history.cjs
//
// One-time backfill for the courses create-courses-from-schedule.cjs made
// (source: 'schedule-history'). Those docs were created without hubUnits,
// description or prerequisites; this fills them from a bulletin scrape of
// each course's BU page (../TerrierPlan-out/schedule-history-scrape.csv,
// columns courseKey, status, hubUnits, Prerequisites, Description).
//
// Only fills a field that is currently missing or empty (undefined, null, ''
// or []); an existing value is never overwritten. Only docs with
// source == 'schedule-history' are touched, and only from scrape rows whose
// status is 'ok' (the page's course number matched the key). A course BU
// lists with no HUB area keeps its hubUnits as they are.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json node scripts/backfill-schedule-history.cjs
//       Dry run (default, read-only): how many docs gain each field, how many
//       have no HUB area on BU's page, and 20 samples.
//   ... node scripts/backfill-schedule-history.cjs --apply [--backup <path>]
//       Writes a backup of every field it will set (with whether it existed),
//       sets the marker doc meta/scheduleHistoryBackfill, then updates ONLY
//       the gained fields in batches of 400. Refuses if the backup file or
//       the marker already exists, so a second --apply can't run.
//   ... node scripts/backfill-schedule-history.cjs --restore <backup.json>
//       Puts each backed-up field back (deletes it if it didn't exist) and
//       deletes the marker doc.
//
// Options:
//   --csv <path>     Default: ../TerrierPlan-out/schedule-history-scrape.csv
//   --backup <path>  Default: ../TerrierPlan-out/schedule-history-backfill-backup.json
//
// Re-run scripts/export-catalog.cjs afterwards to regenerate public/courses.json.

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '..', 'TerrierPlan-out');
const DEFAULT_CSV = path.join(OUT_DIR, 'schedule-history-scrape.csv');
const DEFAULT_BACKUP = path.join(OUT_DIR, 'schedule-history-backfill-backup.json');
const MARKER = ['meta', 'scheduleHistoryBackfill'];
const SOURCE = 'schedule-history';
const FIELDS = ['hubUnits', 'description', 'prerequisites'];
const BATCH_SIZE = 400;
const BATCH_DELAY_MS = 500;
const SAMPLE_COUNT = 20;

function isEmpty(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

// courseKey -> { status, hubUnits: string[], description, prerequisites }
function readScrape(csvPath) {
  const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
  const byKey = new Map();
  for (const row of rows) {
    byKey.set(row.courseKey, {
      status: row.status,
      hubUnits: (row.hubUnits || '').split(/\s+/).filter(Boolean),
      description: (row.Description || '').trim(),
      prerequisites: (row.Prerequisites || '').trim(),
    });
  }
  return byKey;
}

// docs: [{ id, data }] -> what to write and why not, per doc.
function plan(docs, scrape) {
  const updates = []; // { id, set: {field: value}, before: {field: value|undefined} }
  const noScrapeRow = [];
  const notUsable = []; // { id, status }
  const noHubOnBu = [];
  const keptExisting = { hubUnits: 0, description: 0, prerequisites: 0 };
  for (const { id, data } of docs) {
    const s = scrape.get(id);
    if (!s) {
      noScrapeRow.push(id);
      continue;
    }
    if (s.status !== 'ok') {
      notUsable.push({ id, status: s.status });
      continue;
    }
    if (s.hubUnits.length === 0) noHubOnBu.push(id);
    const set = {};
    const before = {};
    for (const field of FIELDS) {
      if (isEmpty(s[field])) continue;
      if (!isEmpty(data[field])) {
        keptExisting[field]++;
        continue;
      }
      set[field] = s[field];
      before[field] = data[field];
    }
    if (Object.keys(set).length > 0) updates.push({ id, set, before });
  }
  return { scanned: docs.length, updates, noScrapeRow, notUsable, noHubOnBu, keptExisting };
}

function printReport(result, scrape) {
  const { scanned, updates, noScrapeRow, notUsable, noHubOnBu, keptExisting } = result;
  console.log(`Docs with source '${SOURCE}': ${scanned}`);
  console.log(`Scrape rows: ${scrape.size} (${[...scrape.values()].filter((s) => s.status === 'ok').length} ok)`);
  console.log(`Docs that would change: ${updates.length}`);
  for (const field of FIELDS) {
    const gain = updates.filter((u) => field in u.set).length;
    console.log(`  gain ${field.padEnd(13)} ${gain}   (already set, left alone: ${keptExisting[field]})`);
  }
  console.log(`BU lists no HUB area (hubUnits left untouched): ${noHubOnBu.length}`);
  console.log(`No scrape row: ${noScrapeRow.length}${noScrapeRow.length ? ` (${noScrapeRow.join(', ')})` : ''}`);
  console.log(`Scrape not usable (page not found / mismatch): ${notUsable.length}`);
  for (const { id, status } of notUsable) console.log(`  ${id}: ${status}`);

  const clip = (v, n) => (v === undefined ? '' : String(v).length > n ? `${String(v).slice(0, n)}…` : String(v));
  console.log(`\n${Math.min(SAMPLE_COUNT, updates.length)} samples:`);
  for (const u of updates.slice(0, SAMPLE_COUNT)) {
    console.log(`  ${u.id}`);
    if (u.set.hubUnits) console.log(`    hubUnits:      ${u.set.hubUnits.join(' ')}`);
    if (u.set.prerequisites) console.log(`    prerequisites: ${clip(u.set.prerequisites, 120)}`);
    if (u.set.description) console.log(`    description:   ${clip(u.set.description, 120)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// items: [{ id, data }] where data is an update() payload.
async function writeInBatches(db, items, label) {
  let written = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { id, data } of items.slice(i, i + BATCH_SIZE)) {
      batch.update(db.collection('courses').doc(id), data);
    }
    await batch.commit();
    written += Math.min(BATCH_SIZE, items.length - i);
    console.log(`${label}: ${written}/${items.length}`);
    if (written < items.length) await sleep(BATCH_DELAY_MS);
  }
  return written;
}

async function scan(db) {
  const snap = await db.collection('courses').where('source', '==', SOURCE).select(...FIELDS).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

async function apply(db, scrape, backupPath) {
  const markerRef = db.collection(MARKER[0]).doc(MARKER[1]);
  if ((await markerRef.get()).exists) {
    console.error(`Refusing --apply: marker ${MARKER.join('/')} exists, so the backfill already ran (or was started). Use --restore first.`);
    process.exit(1);
  }
  if (fs.existsSync(backupPath)) {
    console.error(`Refusing --apply: backup ${backupPath} already exists, so the backfill may already have run.`);
    process.exit(1);
  }

  const result = plan(await scan(db), scrape);
  printReport(result, scrape);
  if (result.updates.length === 0) {
    console.log('\nNothing to change.');
    return;
  }

  // { courseKey: { field: { existed, value } } } — value only when it existed.
  const backup = {};
  for (const u of result.updates) {
    backup[u.id] = {};
    for (const field of Object.keys(u.set)) {
      const old = u.before[field];
      backup[u.id][field] = old === undefined ? { existed: false } : { existed: true, value: old };
    }
  }
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx' });
  console.log(`\nBackup of ${result.updates.length} docs written to ${backupPath}`);

  // Set before the first batch so a crash midway still blocks a re-run.
  await markerRef.set({
    status: 'started',
    startedAt: FieldValue.serverTimestamp(),
    docsToChange: result.updates.length,
    backupFile: path.basename(backupPath),
  });

  const written = await writeInBatches(db, result.updates.map((u) => ({ id: u.id, data: u.set })), 'Backfilled');
  await markerRef.update({ status: 'done', finishedAt: FieldValue.serverTimestamp(), docsChanged: written });
  console.log(`\nDone. Backfilled ${written} docs. Marker ${MARKER.join('/')} set.`);
  console.log('Next: node scripts/export-catalog.cjs');
}

async function restore(db, backupPath) {
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const items = [];
  for (const [id, fields] of Object.entries(backup)) {
    const data = {};
    for (const [field, entry] of Object.entries(fields)) {
      if (!FIELDS.includes(field) || typeof entry?.existed !== 'boolean') {
        console.error(`Refusing --restore: unexpected backup entry ${id}.${field}.`);
        process.exit(1);
      }
      data[field] = entry.existed ? entry.value : FieldValue.delete();
    }
    items.push({ id, data });
  }
  const written = await writeInBatches(db, items, 'Restored');
  await db.collection(MARKER[0]).doc(MARKER[1]).delete();
  console.log(`\nDone. Restored ${written} docs and deleted marker ${MARKER.join('/')}.`);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set — point it at the service-account key (outside the repo).');
    process.exit(1);
  }
  if (path.resolve(keyPath).startsWith(REPO_ROOT + path.sep)) {
    console.warn(`WARNING: service-account key is inside the repo (${keyPath}). Move it out so it can't be committed.`);
  }

  const isApply = process.argv.includes('--apply');
  const restorePath = argValue('--restore');
  if (isApply && process.argv.includes('--restore')) {
    console.error('Pass --apply or --restore, not both.');
    process.exit(1);
  }
  if (process.argv.includes('--restore') && !restorePath) {
    console.error('Usage: --restore <backup.json>');
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  if (restorePath) return restore(db, path.resolve(restorePath));

  const csvPath = path.resolve(argValue('--csv') ?? DEFAULT_CSV);
  const scrape = readScrape(csvPath);
  console.log(`Scrape CSV: ${csvPath}`);
  if (isApply) return apply(db, scrape, path.resolve(argValue('--backup') ?? DEFAULT_BACKUP));

  console.log('DRY RUN — nothing is written. Pass --apply to write.\n');
  printReport(plan(await scan(db), scrape), scrape);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { isEmpty, readScrape, plan, printReport };
