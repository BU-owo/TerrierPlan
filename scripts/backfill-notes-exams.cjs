// backfill-notes-exams.cjs
// Adds notes-derived exam meetings (kind:'exam', 'NO ROOM') to `sections`
// docs whose notes state a weekly exam time, e.g. CS111's "must reserve
// Wednesday 6:30 - 7:45pm for exams". Parsing lives in scripts/lib/meetings.cjs
// (parseNotesExams / buildMeetings with notesExams:true). Writes ONLY `meetings`.
//
// Usage:
//   node scripts/backfill-notes-exams.cjs
//       Dry run (default): fully offline, reads the Spring 2027 CSV, writes
//       the plan + report to ../TerrierPlan-out/audit/ and prints a summary.
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json \
//     node scripts/backfill-notes-exams.cjs --apply
//       Reads each live doc first and writes only if its live `meetings`
//       equals the plan's "before" (absent when the plan says there was none)
//       and its live top-level meeting fields equal the plan's meetings[0];
//       anything else is skipped with the reason. Backs up the previous
//       `meetings` (or "absent") to ../TerrierPlan-out/, sets the marker
//       meta/meetingsNotesExamBackfill, writes in batches of 400, each write
//       guarded by the doc's lastUpdateTime from the read. Refuses to run if
//       the marker already exists.
//   ... --restore <backup.json>
//       Puts the previous `meetings` back (deletes the field where it was
//       absent) and deletes the marker.
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
const PLAN_PATH = path.resolve(argValue('--plan', path.join(OUT_DIR, 'audit', 'notes-exams-plan.json')));
const REPORT_PATH = path.join(path.dirname(PLAN_PATH), 'notes-exams-plan.md');
const MARKER = ['meta', 'meetingsNotesExamBackfill'];
const BATCH_SIZE = 400;

// The 15 courses the diagnosis flagged as having exam/reserve notes with no
// exam meeting; always itemized in the report.
const DIAGNOSIS_COURSES = [
  'CASBB422', 'CASBB622', 'CASCS111', 'CASCS112', 'CASCS131', 'CASCS132',
  'CFAME307', 'CFAME331', 'CFAME408', 'CFAME431', 'CFAME507', 'CFAME531',
  'CFAME618', 'CFAMP702', 'ENGEK381',
];

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── plan (offline) ──────────────────────────────────────────────────────────
function buildPlan() {
  const rows = parse(fs.readFileSync(CSV_PATH, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
  const sections = M.groupSections(rows, TERM);
  const noRoom = M.noRoomPatternsByCourse(sections);
  const entries = [];
  const skipped = []; // sections with a parsed/rejected note that gain nothing
  const byCourse = new Map();

  for (const section of sections.values()) {
    if (!M.inMeetingsScope(section)) continue;
    const opts = { noRoomPatterns: noRoom.get(section.courseKey) };
    const before = M.buildMeetings(section, opts);
    const after = M.buildMeetings(section, { ...opts, notesExams: true });
    const info = after.notesInfo;
    const course = byCourse.get(section.courseKey) || { sections: 0, gained: 0, exams: new Set(), notes: [] };
    byCourse.set(section.courseKey, course);
    course.sections++;

    if (after.syntheticExamCount > 0) {
      const hadMeetings = before.recurringCount >= 2;
      entries.push({
        classNbr: section.classNbr,
        docId: section.docId,
        courseKey: section.courseKey,
        label: section.label,
        alreadyQualified: hadMeetings,
        before: hadMeetings ? before.meetings : null,
        meetings: after.meetings,
        added: after.meetings.filter((m, i) => i >= before.meetings.length || !same(m, before.meetings[i])),
      });
      course.gained++;
      for (const m of after.meetings.slice(before.meetings.length)) {
        course.exams.add(`${m.daysOfWeek} ${m.startTime}–${m.endTime}`);
      }
    }
    for (const r of info.rejected) course.notes.push({ label: section.label, reason: r.reason, text: r.text });
    if (after.syntheticExamCount === 0 && info.exams.length > 0) {
      course.notes.push({
        label: section.label,
        reason: before.meetings.some((m) => m.kind === 'exam') ? 'already has an exam meeting' : 'no class meeting to copy dates from',
        text: info.exams.map((e) => `${e.days.join(' ')} ${e.startTime}–${e.endTime}`).join(', '),
      });
    }
  }

  entries.sort((a, b) => a.courseKey.localeCompare(b.courseKey) || a.classNbr.localeCompare(b.classNbr, 'en', { numeric: true }));
  return { entries, byCourse, skipped, sectionCount: sections.size };
}

function report({ entries, byCourse, sectionCount }) {
  const L = [];
  const gainedCourses = [...byCourse.entries()].filter(([, c]) => c.gained > 0);
  const already = entries.filter((e) => e.alreadyQualified).length;
  L.push(`# Notes-derived exam meetings — ${TERM}`);
  L.push('');
  L.push(`Source: ${path.relative(REPO_ROOT, CSV_PATH)} (${sectionCount} sections)`);
  L.push(`Sections gaining an exam meeting: ${entries.length} in ${gainedCourses.length} courses`);
  L.push(`  of those, ${entries.length - already} are new \`meetings\` arrays (didn't qualify before), ${already} already had \`meetings\` and gain one more entry`);
  L.push('');
  L.push('## Courses affected');
  for (const [key, c] of gainedCourses.sort((a, b) => a[0].localeCompare(b[0]))) {
    L.push(`- ${key}: ${c.gained}/${c.sections} sections — ${[...c.exams].join('; ')}`);
  }
  L.push('');
  L.push('## Ambiguous / skipped notes (all courses)');
  let any = false;
  for (const [key, c] of [...byCourse.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const seen = new Set();
    for (const n of c.notes) {
      const k = `${n.reason}|${n.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      any = true;
      L.push(`- ${key} (${n.label}): ${n.reason} — "${n.text.slice(0, 200)}"`);
    }
  }
  if (!any) L.push('- none');
  L.push('');
  L.push('## Diagnosis courses');
  for (const key of DIAGNOSIS_COURSES) {
    const c = byCourse.get(key);
    if (!c) {
      L.push(`- ${key}: not in meetings scope for ${TERM} (non-undergrad, or not in this CSV) — skipped`);
    } else if (c.gained > 0) {
      L.push(`- ${key}: GAINS ${[...c.exams].join('; ')} (${c.gained}/${c.sections} sections)`);
    } else {
      const reasons = [...new Set(c.notes.map((n) => n.reason))];
      L.push(`- ${key}: no exam added — ${reasons.length ? reasons.join('; ') : 'no matching note on in-scope sections'}`);
    }
  }
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
  const backupPath = path.resolve(argValue('--backup', path.join(OUT_DIR, `notes-exams-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)));
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
    throw new Error(`${backupPath} doesn't look like a notes-exams backup`);
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
