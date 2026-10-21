// scripts/refresh-term.cjs
//
// One path for the per-term schedule refresh. See docs/UPDATING_TERM.md.
//
//   node scripts/refresh-term.cjs prepare <schedule.xls|csv> <roster.xls|csv> [--out <file.csv>]
//       Offline. Reads the two BU exports (title row skipped, meeting dates ->
//       MM/DD/YYYY), runs scheduleclasses/merge-section-types.cjs, and writes
//       scheduleclasses/schedule_with_types_<season><year>.csv. An existing
//       file there is renamed to .OLD.csv first (refuses if .OLD.csv exists).
//       Fails if any non-Cancelled row ends up with no Component.
//   node scripts/refresh-term.cjs check <csv> [--offline]
//       import-sections dry run + local counts + READ-ONLY comparison with live
//       Firestore (needs GOOGLE_APPLICATION_CREDENTIALS). On a pass writes
//       ../TerrierPlan-out/refresh-check-<date>.json (CSV hash). --offline skips
//       the Firestore part and writes no check file (so apply can't use it).
//   node scripts/refresh-term.cjs apply <csv>
//       WRITES to live Firestore. Needs a matching passed check. Backup ->
//       import-sections -> retire-stale-sections --apply -> export-catalog.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const Papa = require('papaparse');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '..', 'TerrierPlan-out');
const SCHED_DIR = path.join(REPO_ROOT, 'scheduleclasses');
const RETIRE_BACKUP = path.join(OUT_DIR, 'retire-stale-sections-backup-2026-10-19.json'); // hardcoded in retire-stale-sections.cjs
const DATE_COLS = ['Meeting Start Date', 'Meeting End Date'];
const SEASON = { 1: 'spring', 5: 'summer', 6: 'summer', 8: 'fall' };

const die = (msg) => {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
};
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readCsv = (file) => parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true });
const node = (script, args, opts = {}) => spawnSync(process.execPath, [path.join(REPO_ROOT, script), ...args], { cwd: REPO_ROOT, ...opts });
const isCancelled = (r) => (r['Class Stat'] || '').trim() === 'Cancelled';
const blankComponent = (rows) => rows.filter((r) => !isCancelled(r) && !(r['Component'] || '').trim());
const sectionIds = (rows) => new Set(rows.filter((r) => r['Term']?.trim() && r['Class Nbr']?.trim()).map((r) => `${r['Term'].trim()}_${r['Class Nbr'].trim()}`));

function singleTerm(rows, label) {
  const terms = [...new Set(rows.map((r) => (r['Term'] || '').trim()).filter(Boolean))];
  if (terms.length !== 1) die(`${label} must contain exactly one Term, found: ${terms.join(', ') || '(none)'}`);
  return terms[0];
}
function termSlug(term) {
  const m = /^2(\d{2})([1568])$/.exec(term);
  return m ? `${SEASON[m[2]]}${2000 + Number(m[1])}` : term;
}

// ---------- prepare ----------

function fmtDate(v, where) {
  if (v === '') return '';
  let y, m, d, x;
  if (v instanceof Date) {
    const t = new Date(v.getTime() + 12 * 3600e3); // SheetJS dates sit at local midnight; +12h keeps the calendar day
    [y, m, d] = [t.getFullYear(), t.getMonth() + 1, t.getDate()];
  } else if (typeof v === 'number') {
    ({ y, m, d } = XLSX.SSF.parse_date_code(v));
  } else if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v).trim()))) {
    [m, d, y] = [Number(x[1]), Number(x[2]), Number(x[3])];
  } else if ((x = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim()))) {
    [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  } else die(`${where}: can't read date "${v}"`);
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
}

// -> array of { header: value } objects, title rows skipped.
function readBu(file) {
  if (!fs.existsSync(file)) die(`not found: ${file}`);
  const isCsv = path.extname(file).toLowerCase() === '.csv';
  const wb = isCsv
    ? XLSX.read(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''), { type: 'string', raw: true })
    : XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  const h = grid.slice(0, 5).findIndex((r) => r.includes('Class Nbr'));
  if (h === -1) die(`${path.basename(file)}: no "Class Nbr" header in the first 5 rows`);
  console.log(`${path.basename(file)}: header on row ${h + 1}`);
  const cols = grid[h].map((name, i) => [String(name).trim(), i]).filter(([name]) => name);
  return grid
    .slice(h + 1)
    .filter((r) => r.some((c) => c !== ''))
    .map((r, n) =>
      Object.fromEntries(
        cols.map(([name, i]) => {
          const where = `${path.basename(file)} row ${h + 2 + n}, ${name}`;
          if (DATE_COLS.includes(name)) return [name, fmtDate(r[i], where)];
          if (r[i] instanceof Date) die(`${where}: unexpected date value`);
          return [name, String(r[i])];
        }),
      ),
    );
}

function prepare(schedArg, rosterArg, outArg) {
  if (!schedArg || !rosterArg) die('Usage: prepare <schedule.xls|csv> <roster.xls|csv> [--out <file.csv>]');
  const sched = readBu(schedArg);
  const roster = readBu(rosterArg);
  const term = singleTerm(sched, 'Schedule file');
  const rosterTerms = new Set(roster.map((r) => (r['Term'] || '').trim()).filter(Boolean));
  if (rosterTerms.size && !rosterTerms.has(term)) die(`roster Term(s) ${[...rosterTerms].join(', ')} don't match schedule term ${term}`);

  const finalPath = outArg ? path.resolve(outArg) : path.join(SCHED_DIR, `schedule_with_types_${termSlug(term)}.csv`);
  const oldPath = finalPath.replace(/\.csv$/, '.OLD.csv');
  if (!outArg && fs.existsSync(finalPath) && fs.existsSync(oldPath)) {
    die(`${path.relative(REPO_ROOT, finalPath)} and its .OLD.csv both exist. Move or delete the .OLD.csv yourself, then re-run (nothing was changed).`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-term-'));
  try {
    const [sp, rp, mp] = ['schedule.csv', 'roster.csv', 'merged.csv'].map((f) => path.join(tmp, f));
    fs.writeFileSync(sp, Papa.unparse(sched));
    fs.writeFileSync(rp, Papa.unparse(roster));
    console.log('');
    const m = node('scheduleclasses/merge-section-types.cjs', [sp, rp, mp], { stdio: 'inherit' });
    if (m.status !== 0) die('merge-section-types.cjs failed');

    const merged = readCsv(mp);
    const bad = blankComponent(merged);
    const cancelled = merged.filter(isCancelled).length;
    console.log(`\nTerm ${term}: ${merged.length} rows, ${cancelled} Cancelled`);
    if (bad.length) {
      console.error(`\nNon-Cancelled rows with NO Component: ${bad.length} (output NOT written). First 20:`);
      for (const r of bad.slice(0, 20)) console.error(`  ${r['Class Nbr']}  ${r['Subject Area']} ${r['Catalog Nbr']} ${r['Class Section']}  ${r['Class Stat']}`);
      die('some sections are missing from the roster; re-export the roster (all sections) and retry');
    }

    if (!outArg && fs.existsSync(finalPath)) {
      fs.renameSync(finalPath, oldPath);
      console.log(`Moved previous file to ${path.relative(REPO_ROOT, oldPath)}`);
    }
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.copyFileSync(mp, finalPath);
    console.log(`\nOK. Wrote ${finalPath}\nNext: node scripts/refresh-term.cjs check ${path.relative(REPO_ROOT, finalPath)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- Firestore (lazy, so prepare works without credentials) ----------

function openDb() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) die('GOOGLE_APPLICATION_CREDENTIALS is not set — point it at the service-account key (outside the repo).');
  if (path.resolve(keyPath).startsWith(REPO_ROOT + path.sep)) console.warn(`WARNING: service-account key is inside the repo (${keyPath}).`);
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault() });
  return getFirestore();
}

// ---------- check ----------

async function check(csv, offline) {
  if (!csv || !fs.existsSync(csv)) die('Usage: check <csv> [--offline]');
  const rows = readCsv(csv);
  const term = singleTerm(rows, 'CSV');
  const ids = sectionIds(rows);
  const problems = [];
  const line = (ok, text) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);
  console.log(`Checking ${csv}  (term ${term})\n`);

  // 1. import-sections dry run (no Firestore, no credentials).
  const tmpOut = path.join(os.tmpdir(), `refresh-meetings-${process.pid}.json`);
  const dry = node('scripts/import-sections.cjs', ['--dry-run', '--meetings-out', tmpOut, csv], { encoding: 'utf8', maxBuffer: 1 << 29 });
  if (dry.status !== 0) {
    console.error(dry.stderr);
    problems.push('import-sections dry run failed');
    line(false, 'import-sections dry run exited nonzero');
  } else {
    const meetings = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    fs.rmSync(tmpOut, { force: true });
    const withExam = meetings.filter((s) => s.meetings.some((m) => m.kind === 'exam')).length;
    const lines = dry.stdout.split('\n');
    const warns = lines.filter((l) => l.startsWith('WARNING'));
    line(true, 'import-sections dry run ran clean');
    console.log(`      ${lines.find((l) => l.startsWith('=== ')) || ''}`);
    console.log(`      meetings arrays: ${meetings.length} (${withExam} contain a kind:'exam' entry)`);
    if (warns.length) console.log(`      ${warns.length} WARNING line(s) (meetings[0] != top-level fields; no \`meetings\` written for those):\n        ${warns.slice(0, 5).join('\n        ')}`);
  }
  line(ids.size > 0, `${ids.size} sections in CSV`);
  if (!ids.size) problems.push('no sections in CSV');

  // 2. Component coverage.
  const bad = blankComponent(rows);
  line(bad.length === 0, `${bad.length} non-Cancelled rows with a blank Component`);
  if (bad.length) {
    problems.push(`${bad.length} non-Cancelled rows with blank Component`);
    for (const r of bad.slice(0, 10)) console.log(`      ${r['Class Nbr']}  ${r['Subject Area']} ${r['Catalog Nbr']} ${r['Class Section']}`);
  }

  // 3. Live sections that are not in the CSV (read-only).
  let stale = null;
  let liveCount = null;
  if (offline) {
    console.log('SKIP  live Firestore comparison (--offline): no check file will be written');
  } else {
    const db = openDb();
    const snap = await db.collection('sections').where('term', '==', term).get();
    liveCount = snap.size;
    stale = snap.docs.filter((d) => !ids.has(d.id));
    const byStat = {};
    for (const d of stale) byStat[d.data().classStat || '(blank)'] = (byStat[d.data().classStat || '(blank)'] || 0) + 1;
    console.log(`INFO  live sections for ${term}: ${liveCount}; live sections NOT in the CSV: ${stale.length} ${JSON.stringify(byStat)}`);
    for (const d of stale) {
      const x = d.data();
      console.log(`      ${d.id}  ${x.courseKey || `${x.subjectArea} ${x.catalogNbr}`}  ${x.classSection}  ${x.daysOfWeek || ''} ${x.startTime || ''}  classStat=${x.classStat || '(blank)'}`);
    }
    console.log(`      (apply will mark these ${stale.length} Cancelled via retire-stale-sections; nothing is deleted)`);
  }

  const checkFile = path.join(OUT_DIR, `refresh-check-${new Date().toISOString().slice(0, 10)}.json`);
  if (problems.length) {
    fs.rmSync(checkFile, { force: true }); // never leave an older pass behind
    console.error(`\nCHECK FAILED (${problems.length}): ${problems.join('; ')}`);
    process.exit(1);
  }
  if (offline) {
    console.log('\nLocal checks passed. Run again without --offline before apply.');
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const record = { passed: true, csv: path.resolve(csv), sha256: sha256(csv), term, sections: ids.size, liveCount, staleCount: stale.length, checkedAt: new Date().toISOString() };
  fs.writeFileSync(checkFile, JSON.stringify(record, null, 2) + '\n');
  console.log(`\nCHECK PASSED. Wrote ${checkFile}`);
}

// ---------- apply ----------

function findPassedCheck(csv) {
  const hash = sha256(csv);
  if (!fs.existsSync(OUT_DIR)) return null;
  return fs
    .readdirSync(OUT_DIR)
    .filter((f) => /^refresh-check-.*\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8')))
    .filter((r) => r.passed && r.sha256 === hash)
    .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1))[0] || null;
}

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

async function apply(csv) {
  if (!csv || !fs.existsSync(csv)) die('Usage: apply <csv>');
  csv = path.resolve(csv);
  const term = singleTerm(readCsv(csv), 'CSV');
  const rec = findPassedCheck(csv);
  if (!rec) die(`no passed check for this exact CSV (sha256 ${sha256(csv).slice(0, 12)}…). Run: node scripts/refresh-term.cjs check ${path.relative(REPO_ROOT, csv)}`);

  // Preflight: everything that can be refused is refused before the first write.
  if (fs.existsSync(RETIRE_BACKUP)) die(`${RETIRE_BACKUP} already exists and retire-stale-sections.cjs refuses to run over it. Move it aside first. Nothing was written.`);
  const db = openDb();
  const marker = await db.collection('meta').doc(`retireStaleSections${term}`).get();
  if (marker.exists) die(`marker meta/retireStaleSections${term} exists, so retire-stale-sections would refuse. Nothing was written.`);

  console.log(`Term ${term}: ${rec.sections} sections in CSV, ${rec.liveCount} live, ${rec.staleCount} to retire (check from ${rec.checkedAt}).`);
  console.log('This WRITES to live Firestore: import-sections, then retire-stale-sections --apply, then rewrites public/courses.json.');
  if ((await ask(`Type the term id (${term}) to continue: `)) !== term) die('confirmation did not match; nothing was written.');

  const written = [];
  const step = async (name, fn, onFail) => {
    console.log(`\n=== ${name}`);
    let ok = false;
    try {
      ok = await fn();
    } catch (err) {
      console.error(err);
    }
    if (!ok) {
      console.error(`\nSTOPPED: step "${name}" failed.`);
      console.error(`Already written: ${written.length ? written.join('; ') : 'nothing'}`);
      console.error(`This step: ${onFail}`);
      process.exit(1);
    }
    written.push(name);
  };
  const runStep = (script, args) => () => node(script, args, { stdio: 'inherit' }).status === 0;

  const backupPath = path.join(OUT_DIR, `sections-${term}-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await step('1/4 back up live sections', async () => {
    const snap = await db.collection('sections').where('term', '==', term).get();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])), null, 2) + '\n', { flag: 'wx' });
    console.log(`Backed up ${snap.size} sections to ${backupPath}`);
    return true;
  }, 'nothing in Firestore was changed (a backup file may be partly written; delete it and retry)');
  const rel = path.relative(REPO_ROOT, csv);
  await step('2/4 import-sections', runStep('scripts/import-sections.cjs', [csv]), 'may be PARTLY imported (merge-sets in batches of 400). Safe to fix the cause and re-run apply from the start.');
  await step('3/4 retire-stale-sections --apply', runStep('scripts/retire-stale-sections.cjs', ['--apply', '--term', term, '--csv', csv, '--expect', String(rec.staleCount)]), `the import is complete. Retire may have written its backup and the marker meta/retireStaleSections${term} and some batches; read its output above before retrying.`);
  await step('4/4 export-catalog', runStep('scripts/export-catalog.cjs', []), 'Firestore is fully updated; public/courses.json may be stale. Just re-run: node scripts/export-catalog.cjs');

  console.log(`\nDONE. Firestore updated and public/courses.json rewritten. Backup: ${backupPath}`);
  console.log(`\nNow, BY HAND, in a clean checkout of main (copy these two files in first if this checkout is not main):\n`);
  console.log(`  git status        # should show only the two files below`);
  console.log(`  git add public/courses.json ${rel}`);
  console.log(`  git commit -m "Refresh ${termSlug(term)} schedule"`);
  console.log(`  git push          # main auto-deploys`);
  process.exit(0);
}

const [stage, ...rest] = process.argv.slice(2);
const flag = (f) => rest.includes(f);
const outIdx = rest.indexOf('--out');
const pos = rest.filter((a, i) => !a.startsWith('--') && (outIdx === -1 || i !== outIdx + 1));
const run = { prepare: () => prepare(pos[0], pos[1], outIdx !== -1 ? rest[outIdx + 1] : null), check: () => check(pos[0], flag('--offline')), apply: () => apply(pos[0]) }[stage];
if (!run) die('Usage: node scripts/refresh-term.cjs <prepare|check|apply> ...  (see the header of this file)');
Promise.resolve(run()).catch((err) => {
  console.error(`${stage} failed:`, err);
  process.exit(1);
});
