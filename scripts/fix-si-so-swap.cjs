// scripts/fix-si-so-swap.cjs
//
// One-time fix: scrape_bu_courses.py used to map "Scientific Inquiry" to
// SO1/SO2 and "Social Inquiry" to SI1/SI2 (the reverse of BU's codes and of
// HUB_LABELS in src/utils/hubConstants.js). This swaps SI1<->SO1 and
// SI2<->SO2 in every courses doc's hubUnits, in one pass per element.
// Other codes and their order are left untouched.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json node scripts/fix-si-so-swap.cjs
//       Dry run (default, read-only): counts, 40 random before/after samples,
//       and any doc whose hubUnits looks inconsistent.
//   ... node scripts/fix-si-so-swap.cjs --apply [--backup <path>]
//       Writes a backup of {courseKey: oldHubUnits} for every doc it will
//       change, sets the marker doc meta/hubSiSoSwap, then updates ONLY
//       hubUnits in batches of 400. Refuses if the backup file or the marker
//       already exists, so a second run can't double-swap.
//   ... node scripts/fix-si-so-swap.cjs --restore <backup.json>
//       Writes the old hubUnits back and deletes the marker doc.
//
// Default backup path: ../TerrierPlan-out/hub-si-so-swap-backup.json (sibling
// of the repo, so it can't be committed).
//
// Re-run scripts/export-catalog.cjs afterwards to regenerate public/courses.json.

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BACKUP = path.join(REPO_ROOT, '..', 'TerrierPlan-out', 'hub-si-so-swap-backup.json');
const MARKER = ['meta', 'hubSiSoSwap'];
const BATCH_SIZE = 400;
const BATCH_DELAY_MS = 500;
const SAMPLE_COUNT = 40;

const SWAP = { SI1: 'SO1', SO1: 'SI1', SI2: 'SO2', SO2: 'SI2' };
// HUB_LABELS keys in src/utils/hubConstants.js.
const KNOWN_CODES = new Set([
  'PLM', 'AEX', 'HCO', 'SI1', 'SI2', 'SO1', 'SO2', 'QR1', 'QR2', 'IIC', 'GCI',
  'ETR', 'FYW', 'WRI', 'WIN', 'OSC', 'DME', 'CRT', 'RIL', 'TWC', 'CRI',
]);

function swapHubUnits(units) {
  return units.map((u) => SWAP[u] ?? u);
}

// Order-insensitive, so a doc holding both SIn and SOn (same codes after the
// swap, only reordered) counts as unchanged and isn't written.
function sameCodes(a, b) {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// Returns a list of problems with a hubUnits value ([] if it looks fine).
function inspect(units) {
  if (units === undefined) return [];
  if (!Array.isArray(units)) return [`not an array (${typeof units})`];
  const issues = [];
  const seen = new Set();
  for (const u of units) {
    if (typeof u !== 'string') issues.push(`non-string ${JSON.stringify(u)}`);
    else if (!KNOWN_CODES.has(u)) issues.push(`unknown code ${u}`);
    if (seen.has(u)) issues.push(`duplicate ${u}`);
    seen.add(u);
  }
  return issues;
}

// entries: [{ id, hubUnits }]
//   -> { scanned, changes: [{ id, before, after }], sameSet, issues: [{ id, hubUnits, issues }] }
function plan(entries) {
  const changes = [];
  const issues = [];
  let sameSet = 0;
  for (const { id, hubUnits } of entries) {
    const found = inspect(hubUnits);
    if (found.length > 0) issues.push({ id, hubUnits, issues: found });
    if (!Array.isArray(hubUnits)) continue;
    const after = swapHubUnits(hubUnits);
    if (!sameCodes(hubUnits, after)) changes.push({ id, before: hubUnits, after });
    else if (hubUnits.some((u) => u in SWAP)) sameSet++;
  }
  return { scanned: entries.length, changes, sameSet, issues };
}

function pickRandom(list, n) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function printReport({ scanned, changes, sameSet, issues }) {
  console.log(`Docs scanned:        ${scanned}`);
  console.log(`Docs that would change: ${changes.length}`);
  const counts = (key) => {
    const c = { SI1: 0, SO1: 0, SI2: 0, SO2: 0 };
    for (const ch of changes) for (const u of ch[key]) if (u in c) c[u]++;
    return c;
  };
  console.log('SI/SO tags before:', counts('before'));
  console.log('SI/SO tags after: ', counts('after'));
  console.log(`Skipped (holds both SIn and SOn, same codes after swap): ${sameSet}`);

  console.log(`\n${Math.min(SAMPLE_COUNT, changes.length)} random samples:`);
  console.table(pickRandom(changes, SAMPLE_COUNT).map((ch) => ({
    courseKey: ch.id, before: ch.before.join(' '), after: ch.after.join(' '),
  })));

  console.log(`\nInconsistent hubUnits: ${issues.length}`);
  for (const { id, hubUnits, issues: found } of issues) {
    console.log(`  ${id}: ${JSON.stringify(hubUnits)} -> ${found.join('; ')}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function writeInBatches(db, items, label) {
  let written = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { id, hubUnits } of items.slice(i, i + BATCH_SIZE)) {
      batch.update(db.collection('courses').doc(id), { hubUnits });
    }
    await batch.commit();
    written += Math.min(BATCH_SIZE, items.length - i);
    console.log(`${label}: ${written}/${items.length}`);
    if (written < items.length) await sleep(BATCH_DELAY_MS);
  }
  return written;
}

async function scan(db) {
  const snap = await db.collection('courses').select('hubUnits').get();
  return snap.docs.map((d) => ({ id: d.id, hubUnits: d.get('hubUnits') }));
}

async function apply(db, backupPath) {
  const markerRef = db.collection(MARKER[0]).doc(MARKER[1]);
  if ((await markerRef.get()).exists) {
    console.error(`Refusing --apply: marker ${MARKER.join('/')} exists, so the swap already ran (or was started). Use --restore first.`);
    process.exit(1);
  }
  if (fs.existsSync(backupPath)) {
    console.error(`Refusing --apply: backup ${backupPath} already exists, so the swap may already have run.`);
    process.exit(1);
  }

  const result = plan(await scan(db));
  printReport(result);
  if (result.changes.length === 0) {
    console.log('\nNothing to change.');
    return;
  }

  const backup = Object.fromEntries(result.changes.map((ch) => [ch.id, ch.before]));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx' });
  console.log(`\nBackup of ${result.changes.length} docs written to ${backupPath}`);

  // Set before the first batch so a crash midway still blocks a re-run.
  await markerRef.set({
    status: 'started',
    startedAt: FieldValue.serverTimestamp(),
    docsToChange: result.changes.length,
    backupFile: path.basename(backupPath),
  });

  const written = await writeInBatches(
    db, result.changes.map((ch) => ({ id: ch.id, hubUnits: ch.after })), 'Swapped',
  );
  await markerRef.update({ status: 'done', finishedAt: FieldValue.serverTimestamp(), docsChanged: written });
  console.log(`\nDone. Updated hubUnits on ${written} docs. Marker ${MARKER.join('/')} set.`);
  console.log('Next: node scripts/export-catalog.cjs');
}

async function restore(db, backupPath) {
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const items = Object.entries(backup).map(([id, hubUnits]) => ({ id, hubUnits }));
  const bad = items.filter((it) => !Array.isArray(it.hubUnits));
  if (bad.length > 0) {
    console.error(`Refusing --restore: ${bad.length} backup entries are not arrays (e.g. ${bad[0].id}).`);
    process.exit(1);
  }
  const written = await writeInBatches(db, items, 'Restored');
  await db.collection(MARKER[0]).doc(MARKER[1]).delete();
  console.log(`\nDone. Restored hubUnits on ${written} docs and deleted marker ${MARKER.join('/')}.`);
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
  if (isApply) return apply(db, path.resolve(argValue('--backup') ?? DEFAULT_BACKUP));

  console.log('DRY RUN — nothing is written. Pass --apply to write.\n');
  printReport(plan(await scan(db)));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { swapHubUnits, inspect, plan, printReport };
