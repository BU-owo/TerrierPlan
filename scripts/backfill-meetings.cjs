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
// Correcting `meetings` that are already live (separate from the first backfill):
//   node scripts/backfill-meetings.cjs --update-meetings              dry run: reads live docs, writes nothing
//   node scripts/backfill-meetings.cjs --update-meetings --apply      back up previous values, then write
//   node scripts/backfill-meetings.cjs --restore-meetings <backup>    write the backed-up previous values back
//   (--old-plan <file> overrides the "before" plan; default meetings-plan.before-engek-exam.json)
// For every doc whose entry differs between the old and new plan, it UPDATEs only
// if the live `meetings` equals the old plan's entry; anything else is SKIPped
// with the reason. Writes only `meetings`, guarded by the doc's lastUpdateTime
// from the read; never touches the meta/meetingsBackfill marker. Restore writes
// the saved previous arrays back and never deletes the field.
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
const DEFAULT_OLD_PLAN = path.join(__dirname, '..', '..', 'TerrierPlan-out', 'audit', 'meetings-plan.before-engek-exam.json');
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

// ── --update-meetings / --restore-meetings ──────────────────────────────────

// Key-sorted JSON, so two meetings arrays compare equal regardless of key order
// (and any extra field on a live entry makes them unequal, which is the safe side).
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameMeetings(a, b) {
  return Array.isArray(a) && Array.isArray(b) && canonical(a) === canonical(b);
}

function briefMeetings(meetings) {
  if (!Array.isArray(meetings)) return String(meetings);
  return meetings
    .map((m) => `${m.daysOfWeek} ${m.startTime}–${m.endTime}${m.facilId === 'NO ROOM' ? ' [NO ROOM]' : ''} (${m.kind})`)
    .join(' + ');
}

// One doc's decision. `snap` is the live read (or undefined if it wasn't found).
function decideUpdate(oldEntry, newEntry, snap) {
  if (!snap || !snap.exists) return { action: 'SKIP', reason: 'doc does not exist' };
  const live = snap.data().meetings;
  if (live === undefined) return { action: 'SKIP', reason: 'live doc has no `meetings` (use the normal --apply)' };
  if (sameMeetings(live, newEntry.meetings)) return { action: 'SKIP', reason: 'already matches the new plan' };
  if (!sameMeetings(live, oldEntry.meetings)) return { action: 'SKIP', reason: 'live `meetings` differs from the old plan (changed since the backfill?)' };
  return { action: 'UPDATE', reason: 'live equals the old plan' };
}

async function updateMeetings(newPlan, oldPlan, doApply, { db } = initDb()) {
  const oldById = new Map(oldPlan.map((p) => [p.docId, p]));
  const newById = new Map(newPlan.map((p) => [p.docId, p]));
  const changed = newPlan.filter((p) => oldById.has(p.docId) && !sameMeetings(oldById.get(p.docId).meetings, p.meetings));
  const onlyOne = [
    ...newPlan.filter((p) => !oldById.has(p.docId)).map((p) => `${p.docId} (only in the new plan)`),
    ...oldPlan.filter((p) => !newById.has(p.docId)).map((p) => `${p.docId} (only in the old plan)`),
  ];

  console.log(`${doApply ? 'APPLY' : 'Dry run (reads live docs, writes nothing)'} — ${changed.length} doc(s) differ between the old and new plan`);
  for (const line of onlyOne) console.log(`  not touched: ${line}`);
  if (changed.length === 0) return console.log('Nothing to do.');

  const refs = changed.map((p) => db.collection('sections').doc(p.docId));
  const snaps = [];
  for (const group of chunk(refs, 300)) snaps.push(...(await db.getAll(...group)));

  const decisions = changed.map((p, i) => ({
    plan: p,
    ref: refs[i],
    snap: snaps[i],
    ...decideUpdate(oldById.get(p.docId), p, snaps[i]),
  }));
  for (const d of decisions) {
    const live = d.snap && d.snap.exists ? d.snap.data().meetings : undefined;
    console.log(`\n${d.plan.docId}  [${d.action}] ${d.reason}`);
    console.log(`    live: ${live === undefined ? '(none)' : briefMeetings(live)}`);
    console.log(`    new:  ${briefMeetings(d.plan.meetings)}`);
  }
  const toWrite = decisions.filter((d) => d.action === 'UPDATE');
  console.log(`\n${toWrite.length} UPDATE, ${decisions.length - toWrite.length} SKIP`);
  if (!doApply) return console.log('Dry run only. Re-run with --apply to write.');
  if (toWrite.length === 0) return console.log('Nothing to write.');

  // Back up each doc's PREVIOUS `meetings` before any write.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `meetings-update-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    collection: 'sections',
    field: 'meetings',
    mode: 'update-meetings',
    docs: toWrite.map((d) => ({ docId: d.plan.docId, previousMeetings: d.snap.data().meetings })),
  }, null, 2) + '\n');
  console.log(`Backup written: ${backupPath}`);

  let written = 0;
  for (const group of chunk(toWrite, BATCH_SIZE)) {
    const batch = db.batch();
    // lastUpdateTime: the write fails if the doc changed after we read it.
    for (const d of group) batch.update(d.ref, { meetings: d.plan.meetings }, { lastUpdateTime: d.snap.updateTime });
    await batch.commit();
    written += group.length;
    console.log(`Committed ${written}/${toWrite.length}`);
  }
  console.log(`Done. Updated \`meetings\` on ${written} doc(s). Marker untouched.`);
  console.log(`To undo: node scripts/backfill-meetings.cjs --restore-meetings ${backupPath}`);
}

async function restoreMeetings(backupPath, { db } = initDb()) {
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (backup.collection !== 'sections' || backup.field !== 'meetings' || backup.mode !== 'update-meetings' || !Array.isArray(backup.docs)) {
    throw new Error(`${backupPath} isn't a --update-meetings backup`);
  }
  // Validate everything before writing anything: restore never deletes the field.
  for (const d of backup.docs) {
    if (!d.docId || !Array.isArray(d.previousMeetings) || d.previousMeetings.length === 0) {
      throw new Error(`bad backup entry: ${JSON.stringify(d).slice(0, 120)}`);
    }
  }
  const refs = backup.docs.map((d) => db.collection('sections').doc(d.docId));
  const snaps = [];
  for (const group of chunk(refs, 300)) snaps.push(...(await db.getAll(...group)));
  const present = backup.docs.map((d, i) => ({ d, ref: refs[i] })).filter((_, i) => snaps[i].exists);
  const missing = backup.docs.filter((_, i) => !snaps[i].exists);
  for (const d of missing) console.log(`  skip ${d.docId}: doc does not exist`);
  console.log(`${present.length} of ${backup.docs.length} docs exist; writing their previous \`meetings\` back.`);

  let restored = 0;
  for (const group of chunk(present, BATCH_SIZE)) {
    const batch = db.batch();
    for (const { d, ref } of group) batch.update(ref, { meetings: d.previousMeetings });
    await batch.commit();
    restored += group.length;
    console.log(`Restored ${restored}/${present.length}`);
  }
  console.log(`Done. Restored \`meetings\` on ${restored} doc(s). Marker untouched.`);
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
  const restoreMeetingsPath = valueOf('--restore-meetings');
  if (restoreMeetingsPath) return restoreMeetings(restoreMeetingsPath);
  if (args.includes('--update-meetings')) {
    return updateMeetings(loadPlan(planPath), loadPlan(valueOf('--old-plan') || DEFAULT_OLD_PLAN), args.includes('--apply'));
  }
  const plan = loadPlan(planPath);
  if (args.includes('--apply')) return apply(plan);
  return dryRun(plan, planPath);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = { decideUpdate, updateMeetings, restoreMeetings, sameMeetings };
