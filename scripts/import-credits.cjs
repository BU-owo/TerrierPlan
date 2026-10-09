// scripts/import-credits.cjs
//
// Fills `courses.credits` for courses whose credit hours can't come from
// `sections` (no section in any imported term). Source: the cached BU HUB
// area pages in ../TerrierPlan-out/hub-html (written by scrape-missing.py),
// where every course card has a <span class="cf-course-credits">4 credits.
// </span>. Cards that say "Var credits." have no single number and are
// skipped. An optional manual-seeds JSON can add (or override) specific keys.
//
// --from-csv <path> narrows everything to an explicit list (courseKey, name,
// career, credits — e.g. ../TerrierPlan-out/missing-credits.csv): the CSV's
// credits are the source, hub-html and seeds are not read, and no course
// outside the CSV is eligible. In that mode CGSHU104 / CGSRH104 / CGSSS104
// that aren't in the CSV copy their credits from the "E" variant (CSV
// credits), written with creditsSource 'hub-page-alias'.
//
// DRY RUN BY DEFAULT — reads `courses` and `sections` from Firestore and
// writes nothing. --local-only skips Firestore entirely (no credentials
// needed): it only parses the inputs and reports the candidate list.
// --commit writes `credits` + `creditsSource` with merge, only to docs that
//   - exist in `courses`,
//   - have no `credits` yet (never overwritten), and
//   - have NO docs in `sections` (any term; the sections supply their credits).
// It writes a backup to ../TerrierPlan-out/ first, sets meta/creditsImport
// before the first batch, and refuses to run again while that marker or the
// backup file exists. The same checks run at dry-run and again at commit,
// against live Firestore.
//
// Usage:
//   node scripts/import-credits.cjs --from-csv ../TerrierPlan-out/missing-credits.csv --local-only --list-writes
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/import-credits.cjs --from-csv <csv> [--list-writes]
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/import-credits.cjs --from-csv <csv> --commit
//
// Options:
//   --from-csv <path> Only these courseKeys are eligible (see above).
//   --list-writes     Print every course that would be written, with credits
//                     and source (dry run / --local-only).
//   --html-dir <dir>  Default: ../TerrierPlan-out/hub-html (ignored with --from-csv)
//   --seeds <path>    JSON object { "CGSHU104": 5, ... }. Default:
//                     scripts/credit-seeds.json (optional; missing = none;
//                     ignored with --from-csv).
//   --backup <path>   Default: ../TerrierPlan-out/credits-import-backup.json
//
// Re-run scripts/export-catalog.cjs afterwards to regenerate public/courses.json.

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '..', 'TerrierPlan-out');
const DEFAULT_HTML_DIR = path.join(OUT_DIR, 'hub-html');
const DEFAULT_SEEDS = path.join(__dirname, 'credit-seeds.json');
const DEFAULT_BACKUP = path.join(OUT_DIR, 'credits-import-backup.json');
const MARKER = ['meta', 'creditsImport'];
const BATCH_SIZE = 400;
const BATCH_DELAY_MS = 500;
const SAMPLE_COUNT = 20;
const MAX_CREDITS = 16;
// Plain key -> study-abroad "E" variant it copies from (--from-csv only).
const ALIASES = { CGSHU104: 'CGSHU104E', CGSRH104: 'CGSRH104E', CGSSS104: 'CGSSS104E' };

const CARD_RE = /<aside class="cf-course[^"]*">[\s\S]*?<\/aside>/g;
const ID_RE = /cf-course-college">(\w+)<\/span>\s*<span class="cf-course-dept">(\w+)<\/span>\s*<span class="cf-course-number">([\w.]+)</;
const CREDITS_RE = /cf-course-credits">([^<]*)</;
const NUMERIC_CREDITS_RE = /^(\d+(?:\.\d+)?)\s+credits?\.?$/i;
const VAR_CREDITS_RE = /^var(?:iable)?\s+credits?\.?$/i;

function isEmpty(value) {
  return value === undefined || value === null;
}

// -> { byKey: Map<courseKey, number>, stats }. A key whose cards disagree
// across area pages is dropped and listed under `disagree`.
function readHubCredits(htmlDir) {
  const seen = new Map(); // courseKey -> Set<number>
  const stats = { files: 0, cards: 0, noCredits: [], variable: new Set(), unparsed: [], disagree: [] };
  for (const file of fs.readdirSync(htmlDir).filter((f) => f.endsWith('.html')).sort()) {
    stats.files++;
    const html = fs.readFileSync(path.join(htmlDir, file), 'utf8');
    for (const card of html.match(CARD_RE) ?? []) {
      const id = ID_RE.exec(card);
      if (!id) continue;
      stats.cards++;
      const key = id.slice(1).join('');
      const cr = CREDITS_RE.exec(card);
      const text = cr ? cr[1].trim() : '';
      if (!text) {
        stats.noCredits.push(key);
      } else if (VAR_CREDITS_RE.test(text)) {
        stats.variable.add(key);
      } else {
        const n = NUMERIC_CREDITS_RE.exec(text);
        if (n && Number(n[1]) > 0 && Number(n[1]) <= MAX_CREDITS) {
          if (!seen.has(key)) seen.set(key, new Set());
          seen.get(key).add(Number(n[1]));
        } else {
          stats.unparsed.push({ key, text });
        }
      }
    }
  }
  const byKey = new Map();
  for (const [key, values] of seen) {
    if (values.size === 1) byKey.set(key, [...values][0]);
    else stats.disagree.push({ key, values: [...values] });
  }
  return { byKey, stats };
}

// -> Map<courseKey, number>; exits on a malformed file or value.
function readSeeds(seedsPath, required) {
  if (!fs.existsSync(seedsPath)) {
    if (required) {
      console.error(`Seeds file not found: ${seedsPath}`);
      process.exit(1);
    }
    return new Map();
  }
  const raw = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.error(`Seeds file must be a JSON object { courseKey: credits }: ${seedsPath}`);
    process.exit(1);
  }
  const seeds = new Map();
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[A-Z]{5}\d+[A-Z]*$/.test(key) || typeof value !== 'number' || !(value > 0 && value <= MAX_CREDITS)) {
      console.error(`Bad seed ${JSON.stringify(key)}: ${JSON.stringify(value)} (want e.g. "CGSHU104": 5, 0 < n <= ${MAX_CREDITS}).`);
      process.exit(1);
    }
    seeds.set(key, value);
  }
  return seeds;
}

// courseKey -> { credits, source }. A seed beats a hub-page value.
function mergeSources(hub, seeds) {
  const merged = new Map();
  for (const [key, credits] of hub) merged.set(key, { credits, source: 'hub-page' });
  for (const [key, credits] of seeds) merged.set(key, { credits, source: 'manual' });
  return merged;
}

// CSV with header courseKey,name,career,credits -> Map<courseKey, number>.
// Exits on a missing column, a bad/duplicate key, or non-numeric credits.
function readCreditsCsv(csvPath) {
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
  if (rows.length === 0 || !('courseKey' in rows[0]) || !('credits' in rows[0])) {
    console.error(`CSV needs courseKey and credits columns: ${csvPath}`);
    process.exit(1);
  }
  const byKey = new Map();
  for (const row of rows) {
    const key = row.courseKey.trim();
    const credits = Number(row.credits);
    if (!/^[A-Z]{5}\d+[A-Z]*$/.test(key) || !(credits > 0 && credits <= MAX_CREDITS)) {
      console.error(`Bad CSV row: courseKey=${JSON.stringify(row.courseKey)} credits=${JSON.stringify(row.credits)}`);
      process.exit(1);
    }
    if (byKey.has(key)) {
      console.error(`Duplicate courseKey in CSV: ${key}`);
      process.exit(1);
    }
    byKey.set(key, credits);
  }
  return byKey;
}

// CSV credits -> candidates, plus the three CGS 104 aliases. Only the keys
// in ALIASES can be aliased, and only when the plain key isn't in the CSV
// and its E variant is.
function candidatesFromCsv(csv) {
  const candidates = new Map();
  for (const [key, credits] of csv) candidates.set(key, { credits, source: 'hub-page' });
  const aliased = [];
  const aliasMissing = [];
  for (const [plain, variant] of Object.entries(ALIASES)) {
    if (candidates.has(plain)) continue;
    if (!candidates.has(variant)) {
      aliasMissing.push(plain);
      continue;
    }
    candidates.set(plain, { credits: candidates.get(variant).credits, source: 'hub-page-alias' });
    aliased.push(plain);
  }
  return { candidates, aliased, aliasMissing };
}

// docs: [{ id, data: { credits } }]; sectionKeys: Set of every courseKey with
// at least one section doc (any term); sectionCredits: Map<courseKey,
// number[]> of positive section credits, used only to label disagreements.
function plan(candidates, docs, sectionKeys, sectionCredits) {
  const byId = new Map(docs.map((d) => [d.id, d.data]));
  const updates = []; // { id, credits, source }
  const unmatched = [];
  const alreadyHave = [];
  const hasSections = []; // { id, credits, sections } — skipped even if they agree
  for (const [id, { credits, source }] of candidates) {
    if (!byId.has(id)) {
      unmatched.push(id);
      continue;
    }
    if (!isEmpty(byId.get(id).credits)) {
      alreadyHave.push(id);
      continue;
    }
    if (sectionKeys.has(id)) {
      hasSections.push({ id, credits, source, sections: [...new Set(sectionCredits.get(id) ?? [])] });
      continue;
    }
    updates.push({ id, credits, source });
  }
  const conflicts = hasSections.filter((h) => h.sections.length > 0 && !h.sections.includes(h.credits));
  return { updates, unmatched, alreadyHave, hasSections, conflicts };
}

function printParse(hub, seeds) {
  const { stats } = hub;
  console.log(`HTML files: ${stats.files}, cards: ${stats.cards}`);
  console.log(`  numeric credits:       ${hub.byKey.size}`);
  console.log(`  "Var credits." skipped: ${stats.variable.size}`);
  console.log(`  cards with no credits: ${stats.noCredits.length}`);
  console.log(`  unparsed credits text: ${stats.unparsed.length}${stats.unparsed.length ? ` (${stats.unparsed.slice(0, 10).map((u) => `${u.key}="${u.text}"`).join(', ')})` : ''}`);
  console.log(`  area pages disagree:   ${stats.disagree.length}${stats.disagree.length ? ` (${stats.disagree.map((d) => `${d.key}=${d.values.join('/')}`).join(', ')}) — skipped` : ''}`);
  console.log(`Manual seeds: ${seeds.size}`);
}

function printCsvParse(csvPath, csv, alias) {
  console.log(`CSV: ${csvPath}`);
  console.log(`  rows: ${csv.size}`);
  console.log(`  aliases added: ${alias.aliased.length}${alias.aliased.length ? ` (${alias.aliased.join(', ')})` : ''}`);
  if (alias.aliasMissing.length) console.log(`  aliases NOT added (no CSV row for plain or E variant): ${alias.aliasMissing.join(', ')}`);
}

function printWrites(updates) {
  console.log(`\nWrites (${updates.length}):`);
  for (const u of updates) console.log(`  ${u.id}\t${u.credits}\t${u.source}`);
}

function printAliasCheck(updates) {
  const expected = { CGSHU104: 5, CGSRH104: 4, CGSSS104: 5 };
  console.log('\nAlias check:');
  for (const [id, credits] of Object.entries(expected)) {
    const hit = updates.find((u) => u.id === id);
    console.log(`  ${id}: ${hit ? `${hit.credits} (${hit.source})${hit.credits === credits && hit.source === 'hub-page-alias' ? ' — as expected' : ' — UNEXPECTED'}` : 'not in writes'}`);
  }
}

function printReport(result, candidates, listWrites) {
  const { updates, unmatched, alreadyHave, hasSections, conflicts } = result;
  const aliasWrites = updates.filter((u) => u.source === 'hub-page-alias');
  const other = updates.filter((u) => u.source !== 'hub-page-alias');
  console.log(`\nCandidates: ${candidates.size}`);
  console.log(`  WOULD WRITE (no-section courses only): ${other.length}`);
  console.log(`  WOULD WRITE as alias:                  ${aliasWrites.length}${aliasWrites.length ? ` (${aliasWrites.map((u) => `${u.id}=${u.credits}`).join(', ')})` : ''}`);
  console.log(`  skipped, sections already exist:       ${hasSections.length}`);
  console.log(`    of which credits disagree:           ${conflicts.length}`);
  for (const c of conflicts) console.log(`      ${c.id}: ${c.source} says ${c.credits}, sections say ${c.sections.join('/')}`);
  console.log(`  skipped, courses.credits already set:  ${alreadyHave.length}`);
  console.log(`  unmatched (no courses doc):            ${unmatched.length}${unmatched.length ? ` (${unmatched.slice(0, 15).join(', ')}${unmatched.length > 15 ? ', …' : ''})` : ''}`);
  if (listWrites) {
    printWrites(updates);
    printAliasCheck(updates);
  } else {
    console.log(`\n${Math.min(SAMPLE_COUNT, updates.length)} samples:`);
    for (const u of updates.slice(0, SAMPLE_COUNT)) console.log(`  ${u.id}: ${u.credits} (${u.source})`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scan(db) {
  const [courseSnap, sectionSnap] = await Promise.all([
    db.collection('courses').select('credits').get(),
    db.collection('sections').select('courseKey', 'credits').get(),
  ]);
  const docs = courseSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const sectionKeys = new Set();
  const sectionCredits = new Map();
  for (const d of sectionSnap.docs) {
    const { courseKey, credits } = d.data();
    if (!courseKey) continue;
    sectionKeys.add(courseKey);
    if (!(credits > 0)) continue; // 0 = free/VAR rows, not a real value
    if (!sectionCredits.has(courseKey)) sectionCredits.set(courseKey, []);
    sectionCredits.get(courseKey).push(credits);
  }
  return { docs, sectionKeys, sectionCredits, sectionDocs: sectionSnap.size };
}

async function commit(db, FieldValue, candidates, backupPath, listWrites) {
  const markerRef = db.collection(MARKER[0]).doc(MARKER[1]);
  if ((await markerRef.get()).exists) {
    console.error(`Refusing --commit: marker ${MARKER.join('/')} exists, so the import already ran (or was started).`);
    process.exit(1);
  }
  if (fs.existsSync(backupPath)) {
    console.error(`Refusing --commit: backup ${backupPath} already exists, so the import may already have run.`);
    process.exit(1);
  }

  const { docs, sectionKeys, sectionCredits, sectionDocs } = await scan(db);
  console.log(`Read ${docs.length} courses, ${sectionDocs} sections.`);
  const result = plan(candidates, docs, sectionKeys, sectionCredits);
  printReport(result, candidates, listWrites);
  if (result.updates.length === 0) {
    console.log('\nNothing to change.');
    return;
  }

  // Every target lacked `credits`/`creditsSource` (isEmpty above), so the
  // backup is just the list of ids and what is written; restoring = deleting
  // those two fields from these docs.
  const backup = {
    createdAt: new Date().toISOString(),
    note: 'Both fields were absent before this import. To undo, delete credits and creditsSource from these docs.',
    docs: Object.fromEntries(result.updates.map((u) => [u.id, { credits: u.credits, creditsSource: u.source }])),
  };
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx' });
  console.log(`\nBackup of ${result.updates.length} docs written to ${backupPath}`);

  // Set before the first batch so a crash midway still blocks a re-run.
  await markerRef.set({
    status: 'started',
    startedAt: FieldValue.serverTimestamp(),
    docsToChange: result.updates.length,
    backupFile: path.basename(backupPath),
  });

  let written = 0;
  for (let i = 0; i < result.updates.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const u of result.updates.slice(i, i + BATCH_SIZE)) {
      batch.set(db.collection('courses').doc(u.id), { credits: u.credits, creditsSource: u.source }, { merge: true });
    }
    await batch.commit();
    written += Math.min(BATCH_SIZE, result.updates.length - i);
    console.log(`Wrote ${written}/${result.updates.length}`);
    if (written < result.updates.length) await sleep(BATCH_DELAY_MS);
  }
  await markerRef.update({ status: 'done', finishedAt: FieldValue.serverTimestamp(), docsChanged: written });
  console.log(`\nDone. Wrote ${written} docs. Marker ${MARKER.join('/')} set.`);
  console.log('Next: node scripts/export-catalog.cjs');
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const isCommit = process.argv.includes('--commit');
  const localOnly = process.argv.includes('--local-only');
  const listWrites = process.argv.includes('--list-writes');
  if (isCommit && localOnly) {
    console.error('Pass --commit or --local-only, not both.');
    process.exit(1);
  }

  let candidates;
  const csvArg = argValue('--from-csv');
  if (process.argv.includes('--from-csv') && !csvArg) {
    console.error('Usage: --from-csv <path>');
    process.exit(1);
  }
  if (csvArg) {
    const csvPath = path.resolve(csvArg);
    const csv = readCreditsCsv(csvPath);
    const alias = candidatesFromCsv(csv);
    candidates = alias.candidates;
    printCsvParse(csvPath, csv, alias);
    if (readSeeds(path.resolve(argValue('--seeds') ?? DEFAULT_SEEDS), false).size > 0) {
      console.log('NOTE: manual seeds are ignored with --from-csv.');
    }
  } else {
    const htmlDir = path.resolve(argValue('--html-dir') ?? DEFAULT_HTML_DIR);
    if (!fs.existsSync(htmlDir)) {
      console.error(`HTML dir not found: ${htmlDir}`);
      process.exit(1);
    }
    const hub = readHubCredits(htmlDir);
    const seedsArg = argValue('--seeds');
    const seeds = readSeeds(path.resolve(seedsArg ?? DEFAULT_SEEDS), Boolean(seedsArg));
    candidates = mergeSources(hub.byKey, seeds);
    console.log(`HTML dir: ${htmlDir}`);
    printParse(hub, seeds);
  }

  if (localOnly) {
    console.log('\nLOCAL ONLY — Firestore not touched. The live checks (courses doc exists, no courses.credits, no section docs) have NOT run.');
    const pending = [...candidates].map(([id, c]) => ({ id, credits: c.credits, source: c.source })).sort((a, b) => (a.id < b.id ? -1 : 1));
    console.log(`Candidates before live checks: ${pending.length} (${pending.filter((u) => u.source === 'hub-page-alias').length} alias)`);
    if (listWrites) {
      printWrites(pending);
      printAliasCheck(pending);
    }
    return;
  }

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set — point it at the service-account key (outside the repo), or use --local-only.');
    process.exit(1);
  }
  if (path.resolve(keyPath).startsWith(REPO_ROOT + path.sep)) {
    console.warn(`WARNING: service-account key is inside the repo (${keyPath}). Move it out so it can't be committed.`);
  }
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  if (isCommit) return commit(db, FieldValue, candidates, path.resolve(argValue('--backup') ?? DEFAULT_BACKUP), listWrites);

  console.log('\nDRY RUN — nothing is written. Pass --commit to write.');
  const marker = await db.collection(MARKER[0]).doc(MARKER[1]).get();
  if (marker.exists) console.log(`NOTE: marker ${MARKER.join('/')} exists — --commit would refuse.`);
  const { docs, sectionKeys, sectionCredits, sectionDocs } = await scan(db);
  console.log(`Read ${docs.length} courses, ${sectionDocs} sections.`);
  printReport(plan(candidates, docs, sectionKeys, sectionCredits), candidates, listWrites);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { readHubCredits, readSeeds, mergeSources, readCreditsCsv, candidatesFromCsv, plan };
