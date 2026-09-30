// scripts/audit-catalog.cjs
//
// READ-ONLY audit of the `courses` catalog against scripts/courses.new.json
// (schedule-history data, keyed by courseId), plus a dry-run preview of the
// proposed integration. Never writes to Firestore: the only Firestore calls
// are collection reads (.select().get() with pagination). No set/update/
// delete/batch/transaction anywhere in this file.
//
// Usage:
//   node scripts/audit-catalog.cjs --local-only
//       Local comparison only (courses.new.json vs courses.json vs
//       bu_courses_all.csv). No credentials needed.
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/audit-catalog.cjs
//       Adds the Firestore audit: courses doc IDs, and every sections doc's
//       courseKey + term (≈ one read per doc in each collection).
//
// Options:
//   --out <dir>   Where to write audit-report.txt / audit-report.json.
//                 Default: <os tmpdir>/terrierplan-catalog-audit (outside
//                 the repo, so nothing lands in git).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse } = require('csv-parse/sync');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const LOCAL_ONLY = args.includes('--local-only');
const outIdx = args.indexOf('--out');
const OUT_DIR = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(os.tmpdir(), 'terrierplan-catalog-audit');

const CAREERS = ['Undergrad', 'Graduate', 'Law', 'Dental', 'Medical'];
const EXAMPLES = 15;

// Same split as parse_schedules.py's catalog_course_id: 3-char college +
// 2-char dept + number (optionally ".N") + optional letter suffix.
const KEY_RE = /^([A-Z]{3})([A-Z]{2})(\d+(?:\.\d+)?)([A-Z]*)$/;
function splitKey(key) {
  const m = KEY_RE.exec(key);
  return m ? { college: m[1], dept: m[2], number: m[3], suffix: m[4] } : null;
}
function suffixOf(key) {
  const m = /^[A-Z]+\d+(?:\.\d+)?([A-Z]*)$/.exec(key);
  if (!m) return '(unparsed)';
  return m[1] || '(none)';
}
// "CASWR151S" -> "CASWR151" (only the S/E session-variant suffixes, as in
// parse_schedules.py's SESSION_VARIANT_SUFFIXES).
function stripSessionSuffix(key) {
  return /\d[SE]$/.test(key) ? key.slice(0, -1) : null;
}
function countBy(items, fn) {
  const out = {};
  for (const it of items) {
    const k = fn(it);
    out[k] = (out[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

const lines = [];
function log(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  lines.push(line);
  console.log(line);
}

function loadLocal() {
  const NEW = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/courses.new.json'), 'utf8'));
  const OLD = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/courses.json'), 'utf8'));
  const rows = parse(fs.readFileSync(path.join(ROOT, 'bu_courses_all.csv'), 'utf8'), {
    columns: true,
    skip_empty_lines: true,
  });
  // Same normalization as import-courses.cjs.
  const BULLETIN = new Set(
    rows.map((r) => (r['Course Number'] || '').replace(/\s+/g, '').toUpperCase()).filter(Boolean),
  );
  // term code -> season, learned from the history entries themselves.
  const termSeason = {};
  for (const entry of Object.values(NEW)) {
    for (const h of entry.history || []) termSeason[h.term] = `${h.season} ${h.year}`;
  }
  return { NEW, OLD, BULLETIN, termSeason };
}

function localReport({ NEW, OLD, BULLETIN }) {
  const newKeys = Object.keys(NEW);
  log('== LOCAL: courses.new.json vs courses.json vs bu_courses_all.csv ==');
  log('courses.new.json keys:', newKeys.length, '| courses.json keys:', Object.keys(OLD).length, '| bulletin unique keys:', BULLETIN.size);
  const inBulletin = newKeys.filter((k) => BULLETIN.has(k));
  log('NEW keys in bulletin:', inBulletin.length, '| not in bulletin:', newKeys.length - inBulletin.length);
  log('NEW careers:', countBy(newKeys, (k) => NEW[k].career));
  log('NEW keys not in bulletin, by career:', countBy(newKeys.filter((k) => !BULLETIN.has(k)), (k) => NEW[k].career));
  log('NEW suffix distribution:', countBy(newKeys, suffixOf));
  for (const [suffix] of Object.entries(countBy(newKeys, suffixOf))) {
    if (suffix === '(none)') continue;
    log(`  suffix ${suffix} examples:`, newKeys.filter((k) => suffixOf(k) === suffix).slice(0, 6).join(', '));
  }
  log('NEW keys not matching 3+2+number shape:', newKeys.filter((k) => !splitKey(k)).length,
    'e.g.', newKeys.filter((k) => !splitKey(k)).slice(0, 8).join(', '));
  log('NEW S/E-suffixed keys:', newKeys.filter((k) => /\d[SE]$/.test(k)).length);
  const bulletinOnly = [...BULLETIN].filter((k) => !NEW[k]);
  log('bulletin keys with no NEW entry (would get no offering data):', bulletinOnly.length, 'e.g.', bulletinOnly.slice(0, EXAMPLES).join(', '));
  const added = newKeys.filter((k) => !OLD[k]);
  const removed = Object.keys(OLD).filter((k) => !NEW[k]);
  log('NEW vs OLD: added', added.length, countBy(added, (k) => NEW[k].career), '| removed', removed.length);
  log('  added e.g.', added.slice(0, 10).join(', '));
  log('  removed e.g.', removed.slice(0, 10).join(', '));
}

async function firestoreReport({ NEW, BULLETIN, termSeason }) {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set. Re-run with it set, or pass --local-only.');
  }
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore, FieldPath } = require('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  // Paginated, field-projected reads only.
  async function readAll(collection, fields) {
    const out = [];
    let last = null;
    for (;;) {
      let q = db.collection(collection).select(...fields).orderBy(FieldPath.documentId()).limit(5000);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
      if (snap.size < 5000) break;
      last = snap.docs[snap.docs.length - 1];
    }
    return out;
  }

  log('');
  log('== FIRESTORE (read-only) ==');
  const courseIds = new Set((await readAll('courses', [])).map((d) => d.id));
  log('2a. courses doc count:', courseIds.size);
  const fsNotInNew = [...courseIds].filter((id) => !NEW[id]);
  log('2a. courses docs NOT in courses.new.json:', fsNotInNew.length, '| examples:', fsNotInNew.slice(0, EXAMPLES).join(', '));
  log('    of those, in bulletin:', fsNotInNew.filter((id) => BULLETIN.has(id)).length);
  const fsNotInBulletin = [...courseIds].filter((id) => !BULLETIN.has(id));
  log('    courses docs not in bulletin csv:', fsNotInBulletin.length, 'e.g.', fsNotInBulletin.slice(0, 10).join(', '));

  const sections = await readAll('sections', ['courseKey', 'term']);
  log('');
  log('2b. sections docs read:', sections.length);
  const byTerm = {};
  for (const s of sections) {
    const term = s.term ?? String(s.id).split('_')[0];
    const key = s.courseKey ?? '(missing courseKey)';
    byTerm[term] ??= {};
    byTerm[term][key] = (byTerm[term][key] || 0) + 1;
  }
  const distinctAll = new Set(sections.map((s) => s.courseKey));
  log('2b. distinct courseKeys across all terms:', distinctAll.size);
  const unmatched = {};
  for (const [term, keys] of Object.entries(byTerm).sort()) {
    const distinct = Object.keys(keys);
    const missing = distinct.filter((k) => !courseIds.has(k));
    const label = termSeason[term] ? `${term} (${termSeason[term]})` : term;
    log(`   term ${label}: ${Object.values(keys).reduce((a, b) => a + b, 0)} sections, ${distinct.length} distinct courseKeys, ${missing.length} with no courses doc`);
    unmatched[term] = missing.map((k) => ({
      courseKey: k,
      sections: keys[k],
      suffix: suffixOf(k),
      baseKey: stripSessionSuffix(k),
      baseHasCoursesDoc: stripSessionSuffix(k) ? courseIds.has(stripSessionSuffix(k)) : null,
      inNewJson: Boolean(NEW[k]) || Boolean(stripSessionSuffix(k) && NEW[stripSessionSuffix(k)]),
    }));
    const bySuffix = countBy(unmatched[term], (u) => u.suffix);
    log('     unmatched by suffix:', bySuffix);
    for (const suffix of Object.keys(bySuffix)) {
      const group = unmatched[term].filter((u) => u.suffix === suffix);
      const resolvable = group.filter((u) => u.baseHasCoursesDoc).length;
      log(`       ${suffix}: ${group.length} (${resolvable} resolve to an existing doc after stripping S/E) e.g.`,
        group.slice(0, 10).map((u) => u.courseKey).join(', '));
    }
  }
  return { courseIds, unmatched };
}

// Dry-run preview of the proposed integration (see the report in chat).
// Counts only — this function has no Firestore handle.
function integrationPreview({ NEW }, courseIds) {
  const newKeys = Object.keys(NEW);
  log('');
  log('== DRY RUN: proposed integration (no writes) ==');
  if (!courseIds) {
    log('(skipped: needs the Firestore courses doc IDs — run without --local-only)');
    return null;
  }
  const perCareer = {};
  for (const c of [...CAREERS, '(other)']) perCareer[c] = { created: 0, updated: 0 };
  for (const k of newKeys) {
    const career = CAREERS.includes(NEW[k].career) ? NEW[k].career : '(other)';
    perCareer[career][courseIds.has(k) ? 'updated' : 'created']++;
  }
  const flagged = [...courseIds].filter((id) => !NEW[id]);
  log('per career (created = new doc, updated = merge onto existing):', perCareer);
  log('totals: created', newKeys.filter((k) => !courseIds.has(k)).length,
    '| updated', newKeys.filter((k) => courseIds.has(k)).length,
    '| flagged (in Firestore, not in JSON; flag only, never deleted)', flagged.length);
  const created = newKeys.filter((k) => !courseIds.has(k));
  log('created docs whose key does not split 3+2+number (courseNumber cannot be derived):',
    created.filter((k) => !splitKey(k)).length, 'e.g.', created.filter((k) => !splitKey(k)).slice(0, 8).join(', '));
  log('created docs by college (top 12):', Object.fromEntries(Object.entries(countBy(created, (k) => (splitKey(k)?.college ?? '?'))).slice(0, 12)));
  log(`catalog size after: ${courseIds.size + created.length} docs (from ${courseIds.size}) — CourseSearch/SchedulerSearch download all of them`);
  return { perCareer, flaggedCount: flagged.length };
}

async function main() {
  const local = loadLocal();
  localReport(local);
  let fsResult = null;
  if (!LOCAL_ONLY) fsResult = await firestoreReport(local);
  const preview = integrationPreview(local, fsResult?.courseIds);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'audit-report.txt'), lines.join('\n') + '\n');
  fs.writeFileSync(
    path.join(OUT_DIR, 'audit-report.json'),
    JSON.stringify({ unmatchedSectionKeysByTerm: fsResult?.unmatched ?? null, preview }, null, 2),
  );
  console.log(`\nWrote ${path.join(OUT_DIR, 'audit-report.txt')} and audit-report.json`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
