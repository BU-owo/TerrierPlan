// scripts/fix-course-details.cjs
//
// One-time fix (confirmed on MyBU, Oct 8): HUB areas / name / prerequisites /
// description on four `courses` docs: CASIR432, CASIR732, CASEE325, CASWS375.
// The exact values are in PATCHES below. CASWS375's hubUnits are deliberately
// NOT touched (BU's description and Class Attributes disagree).
//
// Writes ONLY the fields listed per doc. A doc is skipped, whole, if any field's
// current ("before") value isn't what the patch expects; the reason is listed.
//
// Usage:
//   node scripts/fix-course-details.cjs
//       Offline plan. No credentials, nothing read or written. Shows each doc's
//       new values and the HUB name -> code mapping, and checks the fields the
//       static catalog (public/courses.json) has (name, hubUnits).
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json \
//     node scripts/fix-course-details.cjs --live
//       Live dry run: reads each doc, prints previous -> new and UPDATE or SKIP
//       (with the reason). Writes nothing.
//   ... node scripts/fix-course-details.cjs --apply
//       Same read and decisions, then backs up the previous values of just the
//       fields it will change, sets the marker meta/courseDetailsFixOct8, and
//       updates only those fields in one batch. Each write is guarded by the
//       doc's lastUpdateTime from the read (fails if the doc changed meanwhile).
//       Refuses if the marker or the backup file already exists.
//   ... node scripts/fix-course-details.cjs --restore <backup.json>
//       Writes the previous values back; a field that didn't exist before is
//       deleted, and only such a field. Then deletes the marker.
//
// Backup: ../TerrierPlan-out/course-details-fix-backup.json (sibling of the repo,
// so it can't be committed).
//
// Re-run scripts/export-catalog.cjs afterwards to regenerate public/courses.json.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '..', 'TerrierPlan-out');
const DEFAULT_BACKUP = path.join(OUT_DIR, 'course-details-fix-backup.json');
const CATALOG = path.join(REPO_ROOT, 'public', 'courses.json');
const MARKER = ['meta', 'courseDetailsFixOct8'];

// HUB_LABELS from src/utils/hubConstants.js (an ES module, so copied here like
// KNOWN_CODES in fix-hub-from-audit.cjs; keep in sync).
const HUB_LABELS = {
  PLM: "Philosophical Inquiry & Life's Meanings",
  AEX: 'Aesthetic Exploration',
  HCO: 'Historical Consciousness',
  SI1: 'Scientific Inquiry I',
  SI2: 'Scientific Inquiry II',
  SO1: 'Social Inquiry I',
  SO2: 'Social Inquiry II',
  QR1: 'Quantitative Reasoning I',
  QR2: 'Quantitative Reasoning II',
  IIC: 'The Individual in Community',
  GCI: 'Global Citizenship & Intercultural Literacy',
  ETR: 'Ethical Reasoning',
  FYW: 'First-Year Writing Seminar',
  WRI: 'Writing, Research, and Inquiry',
  WIN: 'Writing-Intensive Course',
  OSC: 'Oral and/or Signed Communication',
  DME: 'Digital/Multimedia Expression',
  CRT: 'Critical Thinking',
  RIL: 'Research and Information Literacy',
  TWC: 'Teamwork/Collaboration',
  CRI: 'Creativity/Innovation',
};

// "&" vs "and", apostrophes and case don't matter when matching a name.
const normName = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9/ ]/g, '').replace(/\s+/g, ' ').trim();
const CODE_BY_NAME = new Map(Object.entries(HUB_LABELS).map(([code, label]) => [normName(label), code]));

// names -> { pairs: [[name, code]], codes: sorted codes } (hubUnits are stored
// alphabetically by code, like the rest of the catalog). Throws on an unknown name.
function mapHubNames(names) {
  const pairs = names.map((name) => {
    const code = CODE_BY_NAME.get(normName(name));
    if (!code) throw new Error(`Unknown HUB name "${name}" (not in HUB_LABELS)`);
    return [name, code];
  });
  return { pairs, codes: pairs.map(([, code]) => code).sort() };
}

// ── "before" expectations ───────────────────────────────────────────────────
const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === ''); // as in import-details.cjs
const expectNoHub = { text: 'no hubUnits (missing or [])', test: (v) => v == null || (Array.isArray(v) && v.length === 0) };
const expectEmpty = { text: 'empty or missing', test: isEmpty };
const expectStartsWith = (prefix) => ({
  text: `starts with ${JSON.stringify(prefix)}`,
  test: (v) => typeof v === 'string' && v.startsWith(prefix),
});
const expectEquals = (value) => ({ text: `exactly ${JSON.stringify(value)}`, test: (v) => v === value });

const IR_HUB = ['Digital/Multimedia Expression', 'Global Citizenship and Intercultural Literacy', 'Social Inquiry I'];

// `hub`: HUB names -> hubUnits. `set`: other fields to write. `expect`: required
// "before" values; every written field that has an expectation is checked.
const PATCHES = [
  {
    id: 'CASIR432',
    hub: IR_HUB,
    set: {
      prerequisites: 'junior or senior standing.',
      description: 'Public diplomacy is the principal way in which states engage with overseas publics. The course examines the principles, functions, and practices of public diplomacy, as well as how they are affected by technological and political change.',
    },
    expect: {
      hubUnits: expectNoHub,
      prerequisites: expectEmpty,
      description: expectStartsWith('Prerequisites: junior or senior standing. - '),
    },
  },
  {
    id: 'CASIR732',
    hub: IR_HUB,
    set: {},
    expect: { hubUnits: expectNoHub },
  },
  {
    id: 'CASEE325',
    hub: ['Aesthetic Exploration', "Philosophical Inquiry and Life's Meanings"],
    set: {
      prerequisites: 'CASEE 100 and CASEE 107.',
      description: 'Students learn to reveal, interpret, and create climate futures that human societies may experience. The course emphasizes the possible (scientific), preposterous (imaginative), and the preferable (philosophical). Students learn methods of strategic foresight, structured backcasting, and science fiction prototyping.',
    },
    expect: {
      hubUnits: expectNoHub,
      prerequisites: expectEmpty,
      description: expectEmpty,
    },
  },
  {
    id: 'CASWS375',
    hub: null, // hubUnits left alone on purpose
    set: {
      name: 'Growing Up as Korean Women',
      description: "By exploring memoirs, autobiographies, prose fiction, poetry, films, and graphic novels by (broadly defined) Korean women, this course examines how Korean women's narratives have evolved and what changes they have enabled.",
    },
    expect: { name: expectEquals('Growing Up in Korea') },
  },
];

// patch -> { id, fields: { field: newValue }, mapping: [[name, code]] } (hubUnits first).
function resolvePatch(patch) {
  const fields = {};
  let mapping = [];
  if (patch.hub) {
    const m = mapHubNames(patch.hub);
    fields.hubUnits = m.codes;
    mapping = m.pairs;
  }
  Object.assign(fields, patch.set);
  return { id: patch.id, fields, mapping, expect: patch.expect };
}

const PLAN = PATCHES.map(resolvePatch);
// Every field we read: what we write plus anything with an expectation.
const readFields = (p) => [...new Set([...Object.keys(p.fields), ...Object.keys(p.expect)])];

// ── decisions ───────────────────────────────────────────────────────────────
function show(v, full = false) {
  if (v === undefined) return '(missing)';
  if (typeof v === 'string') return JSON.stringify(!full && v.length > 70 ? `${v.slice(0, 70)}… [${v.length} chars]` : v);
  return JSON.stringify(v);
}

// current: { exists, data } where data holds the fields read (absent = missing).
// `only` limits which expectations are checked (offline: just what the catalog has).
function decide(plan, current, only) {
  if (!current || !current.exists) return { action: 'SKIP', reasons: ['doc not found'] };
  const reasons = [];
  for (const [field, exp] of Object.entries(plan.expect)) {
    if (only && !only.includes(field)) continue;
    const v = current.data[field];
    if (!exp.test(v)) reasons.push(`${field} is ${show(v)}, expected ${exp.text}`);
  }
  return reasons.length ? { action: 'SKIP', reasons } : { action: 'UPDATE', reasons: [] };
}

function printPlan(plan, current, decision, { liveCheck }) {
  // Offline only checks name/hubUnits, so don't call that an UPDATE decision.
  const label = !liveCheck && decision.action === 'UPDATE' ? 'OK so far' : decision.action;
  console.log(`\n${plan.id}  [${label}]${decision.reasons.length ? ` ${decision.reasons.join('; ')}` : ''}`);
  for (const [name, code] of plan.mapping) console.log(`    HUB  ${name}  ->  ${code}`);
  for (const [field, next] of Object.entries(plan.fields)) {
    const prev = current && current.exists ? current.data[field] : undefined;
    const known = liveCheck || field === 'name' || field === 'hubUnits';
    console.log(`    ${field}: ${known ? show(prev) : '(checked live only)'}  ->  ${show(next, !liveCheck)}`);
  }
  if (plan.id === 'CASWS375') console.log('    hubUnits: left untouched (BU description and Class Attributes disagree)');
}

// ── offline plan ────────────────────────────────────────────────────────────
function offlineReport() {
  const catalog = new Map(JSON.parse(fs.readFileSync(CATALOG, 'utf8')).map((c) => [c.id, c]));
  console.log('OFFLINE PLAN: nothing read from Firestore, nothing written.');
  console.log('Catalog check covers name and hubUnits only; prerequisites and description are checked with --live.');
  for (const plan of PLAN) {
    const c = catalog.get(plan.id);
    const current = c ? { exists: true, data: { name: c.name, hubUnits: c.hubUnits } } : { exists: false, data: {} };
    printPlan(plan, current, decide(plan, current, ['name', 'hubUnits']), { liveCheck: false });
  }
  console.log('\nNext: node scripts/fix-course-details.cjs --live   (needs GOOGLE_APPLICATION_CREDENTIALS)');
}

// ── live ────────────────────────────────────────────────────────────────────
function initDb() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set — point it at the service-account key (outside the repo).');
    process.exit(1);
  }
  if (path.resolve(keyPath).startsWith(REPO_ROOT + path.sep)) {
    console.warn(`WARNING: service-account key is inside the repo (${keyPath}). Move it out so it can't be committed.`);
  }
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault() });
  return { db: getFirestore(), FieldValue };
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

async function readLive(db, plans) {
  const refs = plans.map((p) => db.collection('courses').doc(p.id));
  const mask = [...new Set(plans.flatMap(readFields))];
  const snaps = await db.getAll(...refs, { fieldMask: mask });
  return plans.map((plan, i) => ({
    plan,
    ref: refs[i],
    snap: snaps[i],
    current: { exists: snaps[i].exists, data: snaps[i].exists ? snaps[i].data() : {} },
  }));
}

async function live(doApply, ctx = initDb(), backupPath = DEFAULT_BACKUP) {
  const { db, FieldValue } = ctx;
  const markerRef = db.collection(MARKER[0]).doc(MARKER[1]);
  if (doApply) {
    if ((await markerRef.get()).exists) {
      throw new Error(`Refusing --apply: marker ${MARKER.join('/')} exists, so this fix already ran (or was started). Use --restore first.`);
    }
    if (fs.existsSync(backupPath)) {
      throw new Error(`Refusing --apply: backup ${backupPath} already exists, so this fix may already have run.`);
    }
  }

  const rows = await readLive(db, PLAN);
  console.log(`${doApply ? 'APPLY' : 'LIVE DRY RUN (reads docs, writes nothing)'}: ${rows.length} docs`);
  for (const r of rows) {
    r.decision = decide(r.plan, r.current);
    printPlan(r.plan, r.current, r.decision, { liveCheck: true });
  }
  const ready = rows.filter((r) => r.decision.action === 'UPDATE');
  console.log(`\n${ready.length} UPDATE, ${rows.length - ready.length} SKIP`);
  if (!doApply) return console.log('Dry run only. Re-run with --apply to write.');
  if (ready.length === 0) return console.log('Nothing to write; marker not set.');

  // Back up the previous value of exactly the fields we're about to change.
  const docs = {};
  for (const r of ready) {
    docs[r.plan.id] = {};
    for (const field of Object.keys(r.plan.fields)) {
      docs[r.plan.id][field] = has(r.current.data, field)
        ? { existed: true, value: r.current.data[field] }
        : { existed: false };
    }
  }
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    collection: 'courses',
    kind: 'course-details-fix',
    docs,
  }, null, 2) + '\n', { flag: 'wx' });
  console.log(`\nBackup written: ${backupPath}`);

  // Set before the write so a crash midway still blocks a re-run.
  await markerRef.set({
    status: 'started',
    startedAt: FieldValue.serverTimestamp(),
    docsToChange: ready.length,
    backupFile: path.basename(backupPath),
  });
  const batch = db.batch();
  // lastUpdateTime: a write fails if its doc changed after we read it.
  for (const r of ready) batch.update(r.ref, r.plan.fields, { lastUpdateTime: r.snap.updateTime });
  await batch.commit();
  await markerRef.update({ status: 'done', finishedAt: FieldValue.serverTimestamp(), docsChanged: ready.length });

  console.log(`Done. Updated ${ready.length} doc(s); marker ${MARKER.join('/')} set.`);
  console.log(`To undo: node scripts/fix-course-details.cjs --restore ${backupPath}`);
  console.log('Next: node scripts/export-catalog.cjs');
}

async function restore(backupFile, ctx) {
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  if (backup.collection !== 'courses' || backup.kind !== 'course-details-fix' || !backup.docs || typeof backup.docs !== 'object') {
    throw new Error(`${backupFile} isn't a course-details-fix backup`);
  }
  // Validate everything before touching anything.
  const entries = Object.entries(backup.docs);
  if (entries.length === 0) throw new Error('backup has no docs');
  for (const [id, fields] of entries) {
    const names = Object.keys(fields || {});
    if (names.length === 0) throw new Error(`backup entry ${id} has no fields`);
    for (const f of names) {
      const e = fields[f];
      if (!e || typeof e.existed !== 'boolean' || (e.existed && !has(e, 'value'))) throw new Error(`bad backup entry ${id}.${f}`);
    }
  }
  const { db, FieldValue } = ctx || initDb();
  const refs = entries.map(([id]) => db.collection('courses').doc(id));
  const snaps = await db.getAll(...refs, { fieldMask: ['name'] });
  const batch = db.batch();
  let n = 0;
  entries.forEach(([id, fields], i) => {
    if (!snaps[i].exists) return console.log(`  skip ${id}: doc does not exist`);
    const data = {};
    for (const [f, e] of Object.entries(fields)) data[f] = e.existed ? e.value : FieldValue.delete();
    batch.update(refs[i], data);
    console.log(`  restore ${id}: ${Object.entries(fields).map(([f, e]) => `${f} ${e.existed ? 'back to previous value' : 'deleted (did not exist before)'}`).join('; ')}`);
    n++;
  });
  if (n > 0) await batch.commit();
  await db.collection(MARKER[0]).doc(MARKER[1]).delete();
  console.log(`\nDone. Restored ${n} doc(s) and deleted marker ${MARKER.join('/')}.`);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const isApply = process.argv.includes('--apply');
  const isLive = process.argv.includes('--live');
  const isRestore = process.argv.includes('--restore');
  if (isRestore) {
    if (isApply || isLive) throw new Error('--restore stands alone.');
    const file = argValue('--restore');
    if (!file) throw new Error('Usage: --restore <backup.json>');
    return restore(path.resolve(file));
  }
  if (isApply || isLive) return live(isApply);
  return offlineReport();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = { PLAN, mapHubNames, decide, live, restore };
