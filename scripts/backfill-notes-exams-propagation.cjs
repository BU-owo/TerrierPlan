// backfill-notes-exams-propagation.cjs
// Second layer after backfill-notes-exams.cjs. When one lecture section's notes
// say an exam applies to "all <COURSE> sections" (e.g. CS132 A1: "Students in all
// CS132 sections must reserve Tuesday 6:30 - 7:45pm for exams"), the same exam
// meeting is added to the course's other undergrad LEC sections that have no exam
// meeting and at least one meeting row. Never labs/discussions, never sections
// with no meeting rows. Rules live in buildTermMeetings (scripts/lib/meetings.cjs).
// Writes ONLY `meetings`. Run it after backfill-notes-exams.cjs has been applied:
// its "before" is the notes-exams state, and --apply skips any doc that differs.
//
// Usage:
//   node scripts/backfill-notes-exams-propagation.cjs
//       Dry run (default): fully offline; writes the plan + report to
//       ../TerrierPlan-out/audit/ and prints a summary. Propagated exams are
//       listed separately from note-derived ones.
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json \
//     node scripts/backfill-notes-exams-propagation.cjs --apply
//       Reads each live doc first; writes only if its live `meetings` equals the
//       plan's "before" (absent when the plan says there was none) and its live
//       top-level meeting fields equal meetings[0]; otherwise skips with the
//       reason. Backs up previous `meetings` to ../TerrierPlan-out/, sets the
//       marker meta/meetingsNotesExamPropagation, batches of 400, each write
//       guarded by lastUpdateTime. Refuses to run if the marker exists.
//   ... --restore <backup.json>
//       Puts the previous `meetings` back (deletes the field where it was absent)
//       and deletes the marker.
//
// Options: --csv <path> (default scheduleclasses/schedule_with_types_spring2027.csv),
//          --term <code> (default 2271), --plan <path>, --backup <path>.
//
// Requires: csv-parse; firebase-admin (v12+) only for --apply / --restore.

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const M = require('./lib/meetings.cjs');

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const RESTORE = args.includes('--restore');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '..', 'TerrierPlan-out');
const CSV_PATH = path.resolve(REPO_ROOT, argValue('--csv', 'scheduleclasses/schedule_with_types_spring2027.csv'));
const TERM = argValue('--term', '2271');
const PLAN_PATH = path.resolve(argValue('--plan', path.join(OUT_DIR, 'audit', 'notes-exams-propagation-plan.json')));
const REPORT_PATH = path.join(path.dirname(PLAN_PATH), 'notes-exams-propagation-plan.md');
const MARKER = ['meta', 'meetingsNotesExamPropagation'];
const BATCH_SIZE = 400;

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (m) => `${m.daysOfWeek} ${m.startTime}–${m.endTime} ${m.facilId}`;
const fmtClass = (m) => `${m.daysOfWeek.replace(/ /g, '/')} ${m.startTime}–${m.endTime}`;

// ── plan (offline) ──────────────────────────────────────────────────────────
function buildPlan() {
  const rows = parse(fs.readFileSync(CSV_PATH, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
  const sections = M.groupSections(rows, TERM);
  const pick = (s) => M.buildTermMeetings(sections, { propagate: s, storedPickFor: () => false });
  const base = pick(false); // notes-derived exams only (the previous layer)
  const full = pick(true);
  const entries = [];
  const skips = [];
  const noteDerived = [];

  for (const [docId, after] of full) {
    const section = sections.get(docId);
    const before = base.get(docId);
    if (before.syntheticExamCount > 0) noteDerived.push({ docId, label: section.label });
    if (after.propagatedExamCount > 0) {
      const source = sections.get(after.propagatedFrom);
      entries.push({
        classNbr: section.classNbr,
        docId,
        courseKey: section.courseKey,
        label: section.label,
        sourceDocId: after.propagatedFrom,
        sourceLabel: source.label,
        // The live doc has `meetings` only if the section already had 2+ patterns
        // (counting a notes-derived exam from the previous layer).
        before: before.patternCount >= 2 ? before.meetings : null,
        meetings: after.meetings,
        classMeeting: after.meetings.find((m) => m.kind === 'class'),
        added: after.meetings[after.meetings.length - 1],
      });
    } else if (after.propagationSkips.length > 0) {
      skips.push({ label: section.label, docId, reasons: after.propagationSkips });
    }
  }
  entries.sort((a, b) => a.courseKey.localeCompare(b.courseKey) || a.classNbr.localeCompare(b.classNbr, 'en', { numeric: true }));
  return { entries, skips, noteDerived, sectionCount: sections.size };
}

function report({ entries, skips, noteDerived, sectionCount }) {
  const L = [];
  L.push(`# Propagated exam meetings — ${TERM}`);
  L.push('');
  L.push(`Source: ${path.relative(REPO_ROOT, CSV_PATH)} (${sectionCount} sections)`);
  L.push(`Note-derived exams (previous layer, not part of this plan): ${noteDerived.length} sections`);
  L.push(`Propagated exams (this plan): ${entries.length} sections in ${new Set(entries.map((e) => e.courseKey)).size} courses`);
  L.push('');
  L.push('## Propagated (copied from a sibling LEC section whose own note says "all <COURSE> sections")');
  if (entries.length === 0) L.push('- none');
  for (const e of entries) {
    L.push(`- ${e.docId} ${e.courseKey} ${e.label.split(' ').pop()} | class ${fmtClass(e.classMeeting)} | + exam ${fmt(e.added)} | from ${e.sourceDocId} (${e.sourceLabel}) | before: ${e.before ? 'has meetings[]' : 'no meetings[]'}`);
  }
  L.push('');
  L.push('## Candidate courses where propagation skipped a section');
  if (skips.length === 0) L.push('- none');
  for (const k of skips) L.push(`- ${k.docId} ${k.label}: ${k.reasons.join('; ')}`);
  return L;
}

function dryRun() {
  const result = buildPlan();
  fs.mkdirSync(path.dirname(PLAN_PATH), { recursive: true });
  fs.writeFileSync(PLAN_PATH, JSON.stringify(result.entries.map(({ classNbr, docId, courseKey, before, meetings }) => ({ classNbr, docId, courseKey, before, meetings })), null, 2) + '\n');
  const lines = report(result);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  console.log(`\nDry run — offline, nothing read from or written to Firestore.\nPlan:   ${PLAN_PATH}\nReport: ${REPORT_PATH}`);
}

// ── Firestore (--apply / --restore) ─────────────────────────────────────────
function initDb() {
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.applicationDefault() });
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  return { db: getFirestore(), FieldValue };
}

async function apply() {
  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
  if (!Array.isArray(plan) || plan.length === 0) throw new Error(`${PLAN_PATH} is empty — run the dry run first`);
  const { db, FieldValue } = initDb();
  const markerRef = db.collection(MARKER[0]).doc(MARKER[1]);
  if ((await markerRef.get()).exists) {
    throw new Error(`${MARKER.join('/')} already exists — already applied. Refusing a second --apply (use --restore first).`);
  }
  const backupPath = path.resolve(argValue('--backup', path.join(OUT_DIR, `notes-exams-propagation-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)));
  if (fs.existsSync(backupPath)) throw new Error(`${backupPath} already exists`);

  const refs = plan.map((p) => db.collection('sections').doc(p.docId));
  const snaps = [];
  for (const group of chunk(refs, 300)) snaps.push(...(await db.getAll(...group)));

  const toWrite = [];
  const skippedDocs = [];
  plan.forEach((p, i) => {
    const snap = snaps[i];
    if (!snap.exists) return skippedDocs.push(`${p.docId}: doc does not exist`);
    const data = snap.data();
    const liveMeetings = data.meetings;
    if (p.before === null ? liveMeetings !== undefined : !same(liveMeetings, p.before)) {
      return skippedDocs.push(`${p.docId}: live meetings differ from the plan's "before"`);
    }
    if (!M.sameFields(M.pickFields(data), p.meetings[0])) {
      return skippedDocs.push(`${p.docId}: live top-level fields differ from meetings[0]`);
    }
    toWrite.push({ p, ref: snap.ref, updateTime: snap.updateTime, previous: liveMeetings === undefined ? null : liveMeetings });
  });
  console.log(`${toWrite.length} to write, ${skippedDocs.length} skipped`);
  skippedDocs.forEach((s) => console.log(`  skip ${s}`));
  if (toWrite.length === 0) return console.log('Nothing to write; marker not set.');

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    collection: 'sections',
    field: 'meetings',
    docs: toWrite.map((w) => ({ docId: w.p.docId, previousMeetings: w.previous })),
  }, null, 2) + '\n');
  console.log(`Backup written: ${backupPath}`);

  // Marker first: a crash midway still blocks a re-run.
  await markerRef.set({ startedAt: FieldValue.serverTimestamp(), count: toWrite.length, backup: path.basename(backupPath) });
  let written = 0;
  for (const group of chunk(toWrite, BATCH_SIZE)) {
    const batch = db.batch();
    for (const w of group) batch.update(w.ref, { meetings: w.p.meetings }, { lastUpdateTime: w.updateTime });
    await batch.commit();
    written += group.length;
    console.log(`Committed ${written}/${toWrite.length}`);
  }
  await markerRef.update({ finishedAt: FieldValue.serverTimestamp(), written });
  console.log(`Done. Wrote ${written}, skipped ${skippedDocs.length}.`);
}

async function restore(backupPath) {
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (backup.collection !== 'sections' || backup.field !== 'meetings' || !Array.isArray(backup.docs)) {
    throw new Error(`${backupPath} doesn't look like a notes-exams propagation backup`);
  }
  const { db, FieldValue } = initDb();
  let done = 0;
  for (const group of chunk(backup.docs, BATCH_SIZE)) {
    const batch = db.batch();
    for (const d of group) {
      batch.update(db.collection('sections').doc(d.docId), {
        meetings: d.previousMeetings === null ? FieldValue.delete() : d.previousMeetings,
      });
    }
    await batch.commit();
    done += group.length;
    console.log(`Restored ${done}/${backup.docs.length}`);
  }
  await db.collection(MARKER[0]).doc(MARKER[1]).delete();
  console.log(`Marker ${MARKER.join('/')} deleted.`);
}

async function main() {
  if (RESTORE) {
    const file = argValue('--restore');
    if (!file) throw new Error('--restore needs a backup file');
    return restore(path.resolve(file));
  }
  if (APPLY) return apply();
  return dryRun();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
