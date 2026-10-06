// patch-meeting-rows.cjs
// Targeted fix for Spring 2027 (term 2271) `sections` docs whose meeting
// fields came from the wrong CSV row: the old importer kept a section's
// first meeting row, which for these Class Nbrs was an evening exam block
// or a one-day recitation instead of the lecture. Recomputes the row with
// the importer's pickPrimaryMeeting and updates only the six meeting
// fields, and only on docs that still hold exactly the old row.
//
// Usage (GOOGLE_APPLICATION_CREDENTIALS must point at a service account key):
//   node scripts/patch-meeting-rows.cjs                  dry run: reads, prints, writes nothing
//   node scripts/patch-meeting-rows.cjs --apply          backup to scratch/, then update
//   node scripts/patch-meeting-rows.cjs --restore <file> write a backup's saved values back
//
// Requires: firebase-admin, csv-parse

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

const TERM = '2271';
const CSV_PATH = path.join(__dirname, '..', 'scheduleclasses', 'schedule_with_types_spring2027.csv');
const BACKUP_DIR = path.join(__dirname, '..', 'scratch');
const ALLOWLIST = [
  '3771', '16920', '16921', '4400', '4463', '11469', '4365', '4391', '7614',
  '4923', '4363', '8861', '8862', '8901', '9999', '10000', '10001', '10002',
  '10003', '10712', '11232', '14281',
];

// Firestore field <- CSV column, exactly as import-sections.cjs stores them.
const MEETING_FIELDS = {
  daysOfWeek: 'Days Of The Week',
  startTime: 'Start Time',
  endTime: 'End Time',
  facilId: 'Facil ID',
  meetingStartDate: 'Meeting Start Date',
  meetingEndDate: 'Meeting End Date',
};

// ── Copied verbatim from import-sections.cjs (requiring that file would run
//    an import). Keep in sync if the importer's picking rules change. ──────
const MEETING_COLUMNS = [
  'Days Of The Week', 'Start Time', 'End Time', 'Facil ID',
  'Meeting Start Date', 'Meeting End Date',
];

function meetingKey(row) {
  return MEETING_COLUMNS.map((c) => row[c]?.trim() || '').join('|');
}

function dateSpanDays(row) {
  const toDate = (s) => {
    const [m, d, y] = (s?.trim() || '').split('/').map(Number);
    return y ? Date.UTC(y, m - 1, d) : null;
  };
  const start = toDate(row['Meeting Start Date']);
  const end = toDate(row['Meeting End Date']);
  return start != null && end != null ? (end - start) / 86400000 + 1 : 0;
}

function startMinutes(row) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(row['Start Time']?.trim() || '');
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + parseInt(m[2], 10);
}

function pickPrimaryMeeting(meetings) {
  const daysCount = new Map();
  for (const m of meetings) {
    const days = m['Days Of The Week']?.trim() || '';
    daysCount.set(days, (daysCount.get(days) || 0) + 1);
  }
  const maxSpan = Math.max(...meetings.map(dateSpanDays));
  const rank = (m) => {
    const start = startMinutes(m);
    const facil = m['Facil ID']?.trim() || '';
    const days = m['Days Of The Week']?.trim() || '';
    const span = dateSpanDays(m);
    return [
      span >= 0.9 * maxSpan ? -maxSpan : -span,
      start == null ? 2 : start < 18 * 60 ? 0 : 1,
      -new Set(days.split(/\s+/).filter(Boolean)).size,
      facil === 'NO ROOM' ? 2 : facil ? 0 : 1,
      -daysCount.get(days),
    ];
  };
  let best = meetings[0];
  let bestRank = rank(best);
  for (const m of meetings.slice(1)) {
    const r = rank(m);
    const i = r.findIndex((v, idx) => v !== bestRank[idx]);
    if (i !== -1 && r[i] < bestRank[i]) {
      best = m;
      bestRank = r;
    }
  }
  return best;
}
// ── end of copied logic ────────────────────────────────────────────────────

// CSV row -> { daysOfWeek, startTime, ... } as the importer would store it.
function toFields(row) {
  const out = {};
  for (const [field, column] of Object.entries(MEETING_FIELDS)) out[field] = row[column]?.trim() || '';
  return out;
}

// The six fields as currently stored on a doc (missing -> '').
function docFields(data) {
  const out = {};
  for (const field of Object.keys(MEETING_FIELDS)) out[field] = data?.[field] ?? '';
  return out;
}

function sameFields(a, b) {
  return Object.keys(MEETING_FIELDS).every((f) => a[f] === b[f]);
}

function describe(f) {
  return `${f.daysOfWeek || '-'} | ${f.startTime || '-'}–${f.endTime || '-'} | ${f.meetingStartDate || '-'} → ${f.meetingEndDate || '-'} | ${f.facilId || '-'}`;
}

// Class Nbr -> { label, old, new } from the CSV, for the allowlist only.
function computeFromCsv() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });
  const wanted = new Set(ALLOWLIST);
  const byNbr = new Map();
  for (const row of rows) {
    const term = row['Term']?.trim();
    const classNbr = row['Class Nbr']?.trim();
    if (term !== TERM || !wanted.has(classNbr)) continue;
    if (!byNbr.has(classNbr)) {
      byNbr.set(classNbr, {
        label: `${row['Subject Area']?.trim()} ${row['Catalog Nbr']?.trim()} ${row['Class Section']?.trim()}`,
        meetings: new Map(),
      });
    }
    const entry = byNbr.get(classNbr);
    if (!entry.meetings.has(meetingKey(row))) entry.meetings.set(meetingKey(row), row);
  }
  const result = new Map();
  for (const [classNbr, entry] of byNbr) {
    const meetings = [...entry.meetings.values()];
    result.set(classNbr, {
      label: entry.label,
      old: toFields(meetings[0]),
      new: toFields(pickPrimaryMeeting(meetings)),
    });
  }
  return result;
}

function initDb() {
  admin.initializeApp({ credential: admin.applicationDefault() });
  return getFirestore();
}

async function patch({ apply }) {
  const fromCsv = computeFromCsv();
  const db = initDb();
  const toUpdate = [];
  const skipped = [];

  for (const classNbr of ALLOWLIST) {
    const docId = `${TERM}_${classNbr}`;
    const csv = fromCsv.get(classNbr);
    if (!csv) {
      skipped.push({ docId, reason: 'not found in the CSV' });
      continue;
    }
    if (sameFields(csv.old, csv.new)) {
      skipped.push({ docId, reason: 'CSV gives the same row old and new (nothing to fix)' });
      continue;
    }
    const snap = await db.collection('sections').doc(docId).get();
    if (!snap.exists) {
      skipped.push({ docId, reason: 'doc does not exist' });
      continue;
    }
    const current = docFields(snap.data());
    if (sameFields(current, csv.new)) {
      skipped.push({ docId, reason: 'doc already holds the new row' });
      continue;
    }
    if (!sameFields(current, csv.old)) {
      console.warn(`WARNING ${docId} ${csv.label}: doc doesn't match the old row — skipped`);
      console.warn(`    doc:      ${describe(current)}`);
      console.warn(`    expected: ${describe(csv.old)}`);
      skipped.push({ docId, reason: `doc holds something else: ${describe(current)}` });
      continue;
    }
    console.log(`${docId}  ${csv.label}`);
    console.log(`    before: ${describe(current)}`);
    console.log(`    after:  ${describe(csv.new)}`);
    toUpdate.push({ docId, label: csv.label, before: current, after: csv.new });
  }

  let updated = 0;
  let failed = [];
  if (!apply) {
    console.log(`\nDry run — nothing written. ${toUpdate.length} doc(s) would be updated. Re-run with --apply to write.`);
  } else if (toUpdate.length > 0) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `meeting-backup-${stamp}.json`);
    const backup = {
      createdAt: new Date().toISOString(),
      collection: 'sections',
      docs: toUpdate.map(({ docId, label, before, after }) => ({ docId, label, fields: before, appliedFields: after })),
    };
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`\nBackup written: ${backupPath}`);

    const batch = db.batch();
    for (const { docId, after } of toUpdate) batch.update(db.collection('sections').doc(docId), after);
    try {
      await batch.commit();
      updated = toUpdate.length;
    } catch (err) {
      // A batch is all-or-nothing, so nothing was written.
      console.error('Batch commit failed — no docs were changed:', err.message);
      failed = toUpdate.map(({ docId }) => ({ docId, reason: err.message }));
    }
  }

  printSummary({ apply, updated, wouldUpdate: toUpdate.length, skipped, failed });
}

async function restore(backupPath) {
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (backup.collection !== 'sections' || !Array.isArray(backup.docs)) {
    throw new Error(`${backupPath} doesn't look like a meeting-row backup`);
  }
  const db = initDb();
  const toRestore = [];
  const skipped = [];
  for (const { docId, label, fields } of backup.docs) {
    const snap = await db.collection('sections').doc(docId).get();
    if (!snap.exists) {
      skipped.push({ docId, reason: 'doc does not exist' });
      continue;
    }
    const restoreFields = docFields(fields);
    console.log(`${docId}  ${label || ''}`);
    console.log(`    now:      ${describe(docFields(snap.data()))}`);
    console.log(`    restore:  ${describe(restoreFields)}`);
    toRestore.push({ docId, fields: restoreFields });
  }
  let updated = 0;
  let failed = [];
  if (toRestore.length > 0) {
    const batch = db.batch();
    for (const { docId, fields } of toRestore) batch.update(db.collection('sections').doc(docId), fields);
    try {
      await batch.commit();
      updated = toRestore.length;
    } catch (err) {
      console.error('Batch commit failed — no docs were changed:', err.message);
      failed = toRestore.map(({ docId }) => ({ docId, reason: err.message }));
    }
  }
  printSummary({ apply: true, updated, wouldUpdate: toRestore.length, skipped, failed, restoring: true });
}

function printSummary({ apply, updated, wouldUpdate, skipped, failed, restoring = false }) {
  console.log('\n── Summary ──');
  if (apply) console.log(`${restoring ? 'Restored' : 'Updated'}: ${updated}`);
  else console.log(`Would update: ${wouldUpdate}`);
  console.log(`Skipped: ${skipped.length}`);
  for (const { docId, reason } of skipped) console.log(`    ${docId}: ${reason}`);
  console.log(`Failed: ${failed.length}`);
  for (const { docId, reason } of failed) console.log(`    ${docId}: ${reason}`);
}

const args = process.argv.slice(2);
const restoreIdx = args.indexOf('--restore');
const run = restoreIdx !== -1
  ? (args[restoreIdx + 1] ? restore(args[restoreIdx + 1]) : Promise.reject(new Error('--restore needs a backup file path')))
  : patch({ apply: args.includes('--apply') });

run.catch((err) => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
