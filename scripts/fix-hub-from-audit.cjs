// scripts/fix-hub-from-audit.cjs
//
// One-time fix: brings hubUnits in line with BU's HUB area pages for the
// courses in the HUB audit's fix plan (../TerrierPlan-out/audit/hub-fix-plan.csv,
// "group 2": courses BU lists whose areas we lack or have out of date).
//
// Which plan rows are applied:
//   ADD     (course only gains areas): always. New areas are appended; nothing
//           is removed.
//   REPLACE (areas removed or swapped): only when description_matches_tags is
//           "true" AND effective_term is before Spring 2027. --include-future
//           also applies the Spring 2027-or-later REPLACE rows (their old
//           areas are still valid for Fall 2026). REPLACE rows whose flag is
//           false or blank are never applied.
//
// Usage:
//   node scripts/fix-hub-from-audit.cjs [--plan <csv>] [--include-future]
//       Dry run (default): fully offline, no credentials. Reads the plan CSV and
//       public/courses.json and reports what --apply would write, and which
//       rows would be skipped because the catalog's hubUnits don't match the
//       plan's "before" (ours column).
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json \
//     node scripts/fix-hub-from-audit.cjs --apply [--include-future] [--plan <csv>] [--backup <path>]
//       Reads each live courses doc first and skips any whose hubUnits don't
//       match the plan's "before". Writes a backup of {courseKey: liveHubUnits
//       (null if absent)} for the docs it will change, sets the marker doc
//       meta/hubAuditFix, then updates ONLY hubUnits in batches of 400.
//       Refuses if the backup file or the marker already exists.
//   ... node scripts/fix-hub-from-audit.cjs --restore <backup.json>
//       Writes the old hubUnits back (deleting the field where it was absent)
//       and deletes the marker doc.
//
// Default backup path: ../TerrierPlan-out/hub-audit-fix-backup.json (sibling
// of the repo, so it can't be committed).
//
// Re-run scripts/export-catalog.cjs afterwards to regenerate public/courses.json.

const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '..', 'TerrierPlan-out');
const DEFAULT_PLAN = path.join(OUT_DIR, 'audit', 'hub-fix-plan.csv');
const DEFAULT_BACKUP = path.join(OUT_DIR, 'hub-audit-fix-backup.json');
const CATALOG = path.join(REPO_ROOT, 'public', 'courses.json');
const MARKER = ['meta', 'hubAuditFix'];
const BATCH_SIZE = 400;
const BATCH_DELAY_MS = 500;
const READ_CHUNK = 100;
const FUTURE_CUTOFF = 'Spring 2027';

// HUB_LABELS keys in src/utils/hubConstants.js.
const KNOWN_CODES = new Set([
  'PLM', 'AEX', 'HCO', 'SI1', 'SI2', 'SO1', 'SO2', 'QR1', 'QR2', 'IIC', 'GCI',
  'ETR', 'FYW', 'WRI', 'WIN', 'OSC', 'DME', 'CRT', 'RIL', 'TWC', 'CRI',
]);
const PLAN_COLUMNS = [
  'course_key', 'course_number', 'name', 'career', 'ours', 'bu_areas',
  'change_type', 'effective_term', 'description_matches_tags',
];

// "Spring 2027" -> sortable number; null if blank or unparseable.
function termRank(term) {
  const m = /^(Spring|Summer|Fall) (\d{4})$/.exec(term ?? '');
  if (!m) return null;
  return Number(m[2]) * 3 + ['Spring', 'Summer', 'Fall'].indexOf(m[1]);
}

const codes = (s) => (s ?? '').split(/\s+/).filter(Boolean);

// Order-insensitive; a missing hubUnits field counts as [].
function sameCodes(a, b) {
  const x = [...(a ?? [])].sort();
  const y = [...(b ?? [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function loadPlan(planPath) {
  const rows = parse(fs.readFileSync(planPath, 'utf8'), { columns: true, skip_empty_lines: true });
  const missingCols = PLAN_COLUMNS.filter((c) => rows.length > 0 && !(c in rows[0]));
  if (missingCols.length > 0) throw new Error(`Plan is missing columns: ${missingCols.join(', ')}`);
  return rows;
}

// rows -> { selected: [{ id, num, type, term, before, after }], held: [{ id, num, type, reason }] }
function select(rows, { includeFuture }) {
  const cutoff = termRank(FUTURE_CUTOFF);
  const selected = [];
  const held = [];
  const seen = new Set();
  for (const r of rows) {
    const id = r.course_key;
    const before = codes(r.ours);
    const bu = codes(r.bu_areas);
    const hold = (reason) => held.push({ id, num: r.course_number, type: r.change_type, reason });
    const unknown = [...before, ...bu].filter((u) => !KNOWN_CODES.has(u));
    if (seen.has(id)) { hold('duplicate row'); continue; }
    seen.add(id);
    if (unknown.length > 0) { hold(`unknown code ${unknown.join(' ')}`); continue; }
    if (bu.length === 0) { hold('no BU areas'); continue; }

    if (r.change_type === 'ADD') {
      // ADD must only gain areas; never remove anything.
      if (!before.every((u) => bu.includes(u))) { hold('ADD row would drop an area'); continue; }
      const after = [...before, ...bu.filter((u) => !before.includes(u))];
      selected.push({ id, num: r.course_number, type: 'ADD', term: r.effective_term, before, after });
    } else if (r.change_type === 'REPLACE') {
      if (r.description_matches_tags !== 'true') {
        hold(`description_matches_tags is ${r.description_matches_tags || 'blank'}`);
        continue;
      }
      const rank = termRank(r.effective_term);
      if (rank === null) { hold(`unparseable effective_term "${r.effective_term}"`); continue; }
      if (rank >= cutoff && !includeFuture) {
        hold(`effective ${r.effective_term} (pass --include-future)`);
        continue;
      }
      selected.push({ id, num: r.course_number, type: 'REPLACE', term: r.effective_term, before, after: bu });
    } else {
      hold(`unknown change_type "${r.change_type}"`);
    }
  }
  return { selected, held };
}

// current: Map id -> { exists, hubUnits }. Splits selected into ready / skipped.
function checkBefore(selected, current) {
  const ready = [];
  const skipped = [];
  for (const ch of selected) {
    const cur = current.get(ch.id);
    if (!cur || !cur.exists) skipped.push({ ...ch, reason: 'doc not found' });
    else if (!sameCodes(cur.hubUnits, ch.before)) {
      skipped.push({ ...ch, reason: `hubUnits are ${JSON.stringify(cur.hubUnits ?? null)}, plan expects [${ch.before.join(' ')}]` });
    } else ready.push({ ...ch, live: cur.hubUnits ?? null });
  }
  return { ready, skipped };
}

function printReport({ selected, held }, { ready, skipped }, source) {
  const count = (list, type) => list.filter((x) => x.type === type).length;
  console.log(`Plan rows selected: ${selected.length} (ADD ${count(selected, 'ADD')}, REPLACE ${count(selected, 'REPLACE')})`);
  console.log(`Plan rows held back: ${held.length}`);
  for (const h of held) console.log(`  ${h.num} [${h.type}]: ${h.reason}`);

  console.log(`\nChecked against ${source}:`);
  console.log(`  would write: ${ready.length} (ADD ${count(ready, 'ADD')}, REPLACE ${count(ready, 'REPLACE')})`);
  console.log(`  skipped, before doesn't match: ${skipped.length}`);
  for (const s of skipped) console.log(`  ${s.num} [${s.type}]: ${s.reason}`);

  console.log('\nChanges:');
  console.table(ready.map((ch) => ({
    course: ch.num, type: ch.type, effective: ch.term, before: ch.before.join(' ') || '(none)', after: ch.after.join(' '),
  })));
}

function readCatalog() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  return new Map(catalog.map((c) => [c.id, { exists: true, hubUnits: c.hubUnits }]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readLive(db, ids) {
  const current = new Map();
  for (let i = 0; i < ids.length; i += READ_CHUNK) {
    const refs = ids.slice(i, i + READ_CHUNK).map((id) => db.collection('courses').doc(id));
    const snaps = await db.getAll(...refs, { fieldMask: ['hubUnits'] });
    for (const s of snaps) current.set(s.id, { exists: s.exists, hubUnits: s.exists ? s.get('hubUnits') : undefined });
  }
  return current;
}

// items: [{ id, hubUnits }]; hubUnits null deletes the field.
async function writeInBatches(db, FieldValue, items, label) {
  let written = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { id, hubUnits } of items.slice(i, i + BATCH_SIZE)) {
      batch.update(db.collection('courses').doc(id), { hubUnits: hubUnits ?? FieldValue.delete() });
    }
    await batch.commit();
    written += Math.min(BATCH_SIZE, items.length - i);
    console.log(`${label}: ${written}/${items.length}`);
    if (written < items.length) await sleep(BATCH_DELAY_MS);
  }
  return written;
}

function initDb() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set — point it at the service-account key (outside the repo).');
    process.exit(1);
  }
  if (path.resolve(keyPath).startsWith(REPO_ROOT + path.sep)) {
    console.warn(`WARNING: service-account key is inside the repo (${keyPath}). Move it out so it can't be committed.`);
  }
  // Required here so the dry run works without firebase-admin or credentials.
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault() });
  return { db: getFirestore(), FieldValue };
}

async function apply(planPath, backupPath, includeFuture) {
  const { db, FieldValue } = initDb();
  const markerRef = db.collection(MARKER[0]).doc(MARKER[1]);
  if ((await markerRef.get()).exists) {
    console.error(`Refusing --apply: marker ${MARKER.join('/')} exists, so the fix already ran (or was started). Use --restore first.`);
    process.exit(1);
  }
  if (fs.existsSync(backupPath)) {
    console.error(`Refusing --apply: backup ${backupPath} already exists, so the fix may already have run.`);
    process.exit(1);
  }

  const sel = select(loadPlan(planPath), { includeFuture });
  const check = checkBefore(sel.selected, await readLive(db, sel.selected.map((ch) => ch.id)));
  printReport(sel, check, 'live Firestore');
  if (check.ready.length === 0) {
    console.log('\nNothing to change.');
    return;
  }

  const backup = Object.fromEntries(check.ready.map((ch) => [ch.id, ch.live]));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx' });
  console.log(`\nBackup of ${check.ready.length} docs written to ${backupPath}`);

  // Set before the first batch so a crash midway still blocks a re-run.
  await markerRef.set({
    status: 'started',
    startedAt: FieldValue.serverTimestamp(),
    docsToChange: check.ready.length,
    includeFuture,
    backupFile: path.basename(backupPath),
  });

  const written = await writeInBatches(
    db, FieldValue, check.ready.map((ch) => ({ id: ch.id, hubUnits: ch.after })), 'Updated',
  );
  await markerRef.update({ status: 'done', finishedAt: FieldValue.serverTimestamp(), docsChanged: written });
  console.log(`\nDone. Updated hubUnits on ${written} docs. Marker ${MARKER.join('/')} set.`);
  console.log('Next: node scripts/export-catalog.cjs');
}

async function restore(backupPath) {
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const items = Object.entries(backup).map(([id, hubUnits]) => ({ id, hubUnits }));
  const bad = items.filter((it) => it.hubUnits !== null && !Array.isArray(it.hubUnits));
  if (bad.length > 0) {
    console.error(`Refusing --restore: ${bad.length} backup entries are neither arrays nor null (e.g. ${bad[0].id}).`);
    process.exit(1);
  }
  const { db, FieldValue } = initDb();
  const written = await writeInBatches(db, FieldValue, items, 'Restored');
  await db.collection(MARKER[0]).doc(MARKER[1]).delete();
  console.log(`\nDone. Restored hubUnits on ${written} docs and deleted marker ${MARKER.join('/')}.`);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const isApply = process.argv.includes('--apply');
  const isRestore = process.argv.includes('--restore');
  const restorePath = argValue('--restore');
  const includeFuture = process.argv.includes('--include-future');
  const planPath = path.resolve(argValue('--plan') ?? DEFAULT_PLAN);
  if (isApply && isRestore) {
    console.error('Pass --apply or --restore, not both.');
    process.exit(1);
  }
  if (isRestore && !restorePath) {
    console.error('Usage: --restore <backup.json>');
    process.exit(1);
  }

  if (isRestore) return restore(path.resolve(restorePath));
  if (isApply) return apply(planPath, path.resolve(argValue('--backup') ?? DEFAULT_BACKUP), includeFuture);

  console.log(`DRY RUN — offline, nothing is written. Pass --apply to write.${includeFuture ? ' (--include-future)' : ''}\n`);
  const sel = select(loadPlan(planPath), { includeFuture });
  printReport(sel, checkBefore(sel.selected, readCatalog()), 'public/courses.json');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { termRank, select, checkBefore };
