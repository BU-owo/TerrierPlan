// scripts/retire-stale-sections.cjs
//
// Finds `sections` docs for a term that are NOT in the schedule CSV (compared
// by `${Term}_${Class Nbr}` doc id). BU dropped these without marking them
// Cancelled. --apply marks them Cancelled; nothing is deleted.
//
// Usage:
//   node scripts/retire-stale-sections.cjs [--term 2271] [--csv <path>] [--snapshot <path>]
//       Dry run (default): fully offline, no credentials. Compares the CSV
//       against a snapshot of the live docs (the output of
//       scripts/backup-sections.cjs, default
//       ../TerrierPlan-out/sections-<term>-backup-2026-10-19.json) and lists
//       each stale section.
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json \
//     node scripts/retire-stale-sections.cjs --apply [--term 2271] [--csv <path>] [--expect <n>]
//       Derives the stale set from LIVE Firestore (the snapshot is ignored).
//       Aborts before writing if the live stale count is not exactly 50, or
//       the --expect value. Backs up the full data of every affected doc to
//       ../TerrierPlan-out/retire-stale-sections-backup-2026-10-19.json
//       (refuses if it exists), creates the marker meta/retireStaleSections<term>
//       (refuses if it exists), then merge-sets ONLY
//       { classStat: 'Cancelled', retiredAt: serverTimestamp() } in batches of 400.
//
// Options: --term (default 2271),
//          --csv (default scheduleclasses/schedule_with_types_spring2027.csv).
//
// Rollback: restore classStat from the backup JSON (and delete retiredAt).

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '..', 'TerrierPlan-out');
const BACKUP_PATH = path.join(OUT_DIR, 'retire-stale-sections-backup-2026-10-19.json');
const BATCH_SIZE = 400;
const DEFAULT_EXPECTED = 50;

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const APPLY = args.includes('--apply');
const TERM = argValue('--term', '2271');
const CSV_PATH = path.resolve(argValue('--csv', path.join(REPO_ROOT, 'scheduleclasses', 'schedule_with_types_spring2027.csv')));
const SNAPSHOT_PATH = path.resolve(argValue('--snapshot', path.join(OUT_DIR, `sections-${TERM}-backup-2026-10-19.json`)));
const MARKER = ['meta', `retireStaleSections${TERM}`];

function loadCsvIds() {
  const rows = parse(fs.readFileSync(CSV_PATH, 'utf8'), { columns: true, skip_empty_lines: true });
  const ids = new Set();
  for (const row of rows) {
    const term = row['Term']?.trim();
    const classNbr = row['Class Nbr']?.trim();
    if (term === TERM && classNbr) ids.add(`${term}_${classNbr}`);
  }
  return ids;
}

function describe(id, d) {
  const when = [d.daysOfWeek, d.startTime && `${d.startTime}-${d.endTime}`].filter(Boolean).join(' ') || '(no meeting)';
  return `${id}  ${d.courseKey || `${d.subjectArea} ${d.catalogNbr}`}  ${d.classSection}  ${when}  classStat=${d.classStat || '(blank)'}`;
}

function dryRun() {
  const csvIds = loadCsvIds();
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const docs = Object.entries(snapshot).filter(([, data]) => String(data.term) === TERM);
  const stale = docs.filter(([id]) => !csvIds.has(id));

  console.log(`Dry run (offline). Term ${TERM}`);
  console.log(`  CSV:      ${CSV_PATH} (${csvIds.size} sections)`);
  console.log(`  Snapshot: ${SNAPSHOT_PATH} (${docs.length} sections)`);
  console.log(`\n${stale.length} stale section(s) in the snapshot, not in the CSV:\n`);
  for (const [id, d] of stale) console.log(describe(id, d));
  const byStat = {};
  for (const [, d] of stale) byStat[d.classStat || '(blank)'] = (byStat[d.classStat || '(blank)'] || 0) + 1;
  console.log(`\nTotal stale: ${stale.length}  by classStat: ${JSON.stringify(byStat)}`);
  const inCsvNotSnapshot = [...csvIds].filter((id) => !(id in snapshot)).length;
  console.log(`CSV sections not in the snapshot: ${inCsvNotSnapshot}`);
}

async function apply() {
  const expectRaw = argValue('--expect', String(DEFAULT_EXPECTED));
  const expected = Number(expectRaw);
  if (!Number.isInteger(expected) || expected < 0) {
    console.error(`Refusing --apply: --expect must be a non-negative integer (got "${expectRaw}").`);
    process.exit(1);
  }
  if (fs.existsSync(BACKUP_PATH)) {
    console.error(`Refusing --apply: backup ${BACKUP_PATH} already exists, so this may already have run.`);
    process.exit(1);
  }
  const csvIds = loadCsvIds();
  if (csvIds.size === 0) {
    console.error(`Refusing --apply: no term ${TERM} sections found in ${CSV_PATH}.`);
    process.exit(1);
  }

  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  // Marker is checked (read-only) before anything else touches Firestore.
  const markerRef = db.collection(MARKER[0]).doc(MARKER[1]);
  if ((await markerRef.get()).exists) {
    console.error(`Refusing --apply: marker ${MARKER.join('/')} exists, so this already ran (or was started).`);
    process.exit(1);
  }

  const snap = await db.collection('sections').where('term', '==', TERM).get();
  const stale = snap.docs.filter((doc) => !csvIds.has(doc.id));
  console.log(`Live term ${TERM} docs: ${snap.size}. CSV sections: ${csvIds.size}.`);
  console.log(`Live stale count: ${stale.length} (expected ${expected}).`);
  if (stale.length !== expected) {
    console.error('Aborting: live stale count does not match. Nothing written. Pass --expect <n> if the new count is right.');
    process.exit(1);
  }
  if (stale.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Backup of the full docs, before any write. 'wx' fails if the file appeared since the check above.
  const backup = Object.fromEntries(stale.map((doc) => [doc.id, doc.data()]));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx' });
  console.log(`Backup of ${stale.length} docs written to ${BACKUP_PATH}`);

  // create() fails if the marker exists. Set before the first batch so a crash midway still blocks a re-run.
  await markerRef.create({
    status: 'started',
    startedAt: FieldValue.serverTimestamp(),
    term: TERM,
    expectedCount: expected,
    docsToRetire: stale.length,
    backupFile: path.basename(BACKUP_PATH),
  });

  let written = 0;
  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of stale.slice(i, i + BATCH_SIZE)) {
      batch.set(doc.ref, { classStat: 'Cancelled', retiredAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    written += Math.min(BATCH_SIZE, stale.length - i);
    console.log(`Committed ${written}/${stale.length}`);
  }

  await markerRef.update({ status: 'done', finishedAt: FieldValue.serverTimestamp(), docsRetired: written });
  console.log(`\nDone. Retired ${written} sections. Marker ${MARKER.join('/')} set.`);
  console.log(`First ${Math.min(10, stale.length)} ids: ${stale.slice(0, 10).map((d) => d.id).join(', ')}`);
}

(APPLY ? apply() : Promise.resolve(dryRun())).catch((err) => {
  console.error(APPLY ? 'Apply failed:' : 'Dry run failed:', err);
  process.exit(1);
});
