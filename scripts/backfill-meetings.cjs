// backfill-meetings.cjs
// Adds a `meetings` array to existing `sections` docs from the plan written by
// build-meetings-plan.cjs. Writes ONLY the `meetings` field.
//
// Usage:
//   node scripts/backfill-meetings.cjs                    dry run: plan JSON only, fully offline
//   node scripts/backfill-meetings.cjs --apply            read live docs, back up, write (needs
//                                                         GOOGLE_APPLICATION_CREDENTIALS)
//   node scripts/backfill-meetings.cjs --restore <file>   delete `meetings` from a backup's docs
//   node scripts/backfill-meetings.cjs --plan <file>      use another plan file (any mode)
//
// --apply skips docs that already have `meetings`, skips docs whose live
// top-level meeting fields differ from the plan's meetings[0] (and lists them),
// backs up the touched doc ids to ../TerrierPlan-out first, commits in batches
// of 400, then sets the marker doc meta/meetingsBackfill. It refuses to run if
// the marker already exists.
//
// Requires: firebase-admin (v12+)

const fs = require('fs');
const path = require('path');
const { sameFields, pickFields, describeFields } = require('./lib/meetings.cjs');

const DEFAULT_PLAN = path.join(__dirname, '..', '..', 'TerrierPlan-out', 'audit', 'meetings-plan.json');
const BACKUP_DIR = path.join(__dirname, '..', '..', 'TerrierPlan-out');
const MARKER = { collection: 'meta', id: 'meetingsBackfill' };
const BATCH_SIZE = 400;

function loadPlan(planPath) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (!Array.isArray(plan)) throw new Error(`${planPath} is not a plan array`);
  const seen = new Set();
  for (const p of plan) {
    if (!p.docId || !Array.isArray(p.meetings) || p.meetings.length === 0) {
      throw new Error(`bad plan entry: ${JSON.stringify(p).slice(0, 120)}`);
    }
    if (seen.has(p.docId)) throw new Error(`duplicate docId in plan: ${p.docId}`);
    seen.add(p.docId);
  }
  return plan;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function dryRun(plan, planPath) {
  const kinds = { class: 0, exam: 0 };
  for (const p of plan) for (const m of p.meetings) kinds[m.kind] = (kinds[m.kind] || 0) + 1;
  console.log(`Dry run — offline, nothing read or written. Plan: ${planPath}`);
  console.log(`  ${plan.length} sections would get a \`meetings\` field (${kinds.class} class, ${kinds.exam} exam meetings)`);
  console.log(`  ${Math.ceil(plan.length / BATCH_SIZE)} batch(es) of up to ${BATCH_SIZE}; marker ${MARKER.collection}/${MARKER.id} set afterwards`);
  console.log('  --apply will additionally skip docs that already have `meetings` or whose live top-level fields differ from meetings[0].');
}

function initDb() {
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.applicationDefault() });
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  return { db: getFirestore(), FieldValue };
}

async function apply(plan) {
  const { db, FieldValue } = initDb();
  const markerRef = db.collection(MARKER.collection).doc(MARKER.id);
  if ((await markerRef.get()).exists) {
    throw new Error(`${MARKER.collection}/${MARKER.id} already exists — backfill was already applied. Refusing a second --apply (use --restore first).`);
  }

  const refs = plan.map((p) => db.collection('sections').doc(p.docId));
  const snaps = [];
  for (const group of chunk(refs, 300)) snaps.push(...(await db.getAll(...group)));

  const toWrite = [];
  const skipped = [];
  plan.forEach((p, i) => {
    const snap = snaps[i];
    if (!snap.exists) return skipped.push({ docId: p.docId, reason: 'doc does not exist' });
    const data = snap.data();
    if (data.meetings !== undefined) return skipped.push({ docId: p.docId, reason: 'already has `meetings`' });
    const live = pickFields(data);
    if (!sameFields(live, p.meetings[0])) {
      return skipped.push({
        docId: p.docId,
        reason: `live top-level differs from meetings[0]\n        live:  ${describeFields(live)}\n        plan:  ${describeFields(pickFields(p.meetings[0]))}`,
        mismatch: true,
      });
    }
    toWrite.push(p);
  });

  console.log(`${toWrite.length} to write, ${skipped.length} skipped`);
  for (const s of skipped) console.log(`  skip ${s.docId}: ${s.reason}`);
  if (toWrite.length === 0) {
    console.log('Nothing to write; marker not set.');
    return;
  }

  // Back up the touched ids before any write. They had no `meetings` field,
  // so --restore just deletes it again.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `meetings-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    collection: 'sections',
    field: 'meetings',
    docIds: toWrite.map((p) => p.docId),
  }, null, 2) + '\n');
  console.log(`Backup written: ${backupPath}`);

  let written = 0;
  for (const group of chunk(toWrite, BATCH_SIZE)) {
    const batch = db.batch();
    for (const p of group) batch.update(db.collection('sections').doc(p.docId), { meetings: p.meetings });
    await batch.commit();
    written += group.length;
    console.log(`Committed ${written}/${toWrite.length}`);
  }

  await markerRef.set({
    appliedAt: FieldValue.serverTimestamp(),
    count: written,
    skipped: skipped.length,
    backup: path.basename(backupPath),
  });
  console.log(`Done. Wrote ${written}, skipped ${skipped.length}. Marker ${MARKER.collection}/${MARKER.id} set.`);
}

async function restore(backupPath) {
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (backup.collection !== 'sections' || backup.field !== 'meetings' || !Array.isArray(backup.docIds)) {
    throw new Error(`${backupPath} doesn't look like a meetings backup`);
  }
  const { db, FieldValue } = initDb();
  const refs = backup.docIds.map((id) => db.collection('sections').doc(id));
  const snaps = [];
  for (const group of chunk(refs, 300)) snaps.push(...(await db.getAll(...group)));
  const existing = refs.filter((_, i) => snaps[i].exists);
  console.log(`${existing.length} of ${refs.length} docs exist; deleting \`meetings\` from them.`);

  let restored = 0;
  for (const group of chunk(existing, BATCH_SIZE)) {
    const batch = db.batch();
    for (const ref of group) batch.update(ref, { meetings: FieldValue.delete() });
    await batch.commit();
    restored += group.length;
    console.log(`Restored ${restored}/${existing.length}`);
  }
  // Clear the marker so a corrected plan can be applied again.
  await db.collection(MARKER.collection).doc(MARKER.id).delete();
  console.log(`Done. Removed \`meetings\` from ${restored} docs and deleted ${MARKER.collection}/${MARKER.id}.`);
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return null;
    if (!args[i + 1]) throw new Error(`${flag} needs a file path`);
    return args[i + 1];
  };
  const planPath = valueOf('--plan') || DEFAULT_PLAN;
  const restorePath = valueOf('--restore');
  if (restorePath) return restore(restorePath);
  const plan = loadPlan(planPath);
  if (args.includes('--apply')) return apply(plan);
  return dryRun(plan, planPath);
}

main().catch((err) => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
