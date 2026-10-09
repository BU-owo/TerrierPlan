// scripts/build-grs-aliases.cjs
//
// Builds src/data/grsAliases.js — a static GRS -> CAS alias map for courses
// that were renumbered (same catalog number, new subject). The app reads it
// at read time only (credits fallback, course info panel); no course doc,
// saved plan or completedCourseKeys entry is changed.
//
// Input: ../TerrierPlan-out/grs-cas-matches.csv (from grs-cas-matches.cjs).
//
// Rules
//   one-match            include (also same-dept rows with a low name score),
//                        EXCEPT a generic name whose 2-letter
//                        department differs from the CAS key's (e.g.
//                        GRSPS901 "DIRECTED STUDY" -> CASEI901 is dropped).
//                        Generic = exactly one of the phrases in GENERIC_PHRASES
//                        with no topic words after it ("DIRECTED STUDY" yes,
//                        "DIRECTED STUDY: Religion" no).
//   multiple-candidates  include ONLY if exactly one candidate has the same
//                        2-letter department as the GRS key (GRSEE623 ->
//                        CASEE623). Zero or several same-dept: skipped.
//   departments          ES, GE and EE count as one department (both in the
//                        generic-name check and the multiple-candidates tie-break).
//   hold-back            a selected row (one-match, or the same-dept pick of a
//                        multiple-candidates course) is NOT auto-aliased but
//                        written to grs-low-score.csv for review when
//                          (a) the CAS name starts with Seminar, Topics, Special
//                              Topics, Probl(ems), Dissertation, Readings or
//                              Colloquium (topic-rotating numbers) AND nameScore
//                              < 0.5 AND nameRule is same-dept, or
//                          (b) the CAS key is claimed by more than one GRS key
//                              AND nameRule is same-dept.
//   KEEP                 GRSBI622, GRSCH621, GRSCH622 and GRSEN688 stay aliased
//                        to the targets in KEEP (the ones already in
//                        src/data/grsAliases.js), whatever the rules say.
//                        --decisions can still change them.
//   weak-name / none     never included.
//   GRSBI795, GRSCS935   never aliased (still running as GRS). GRSIS800 is
//                        excluded by request.
//
// --decisions <path>  hand decisions (CSV: grsKey, casKey, decision; extra
//                      columns such as grs-review.csv's are fine). Per row:
//                        Y             alias grsKey -> that row's casKey, even if
//                                      the automatic rules skipped it
//                        <a CAS key>   alias grsKey -> that key
//                        N             never alias grsKey
//                        (blank)       automatic rules apply
//                      Decisions override the generic-name and department rules
//                      but never the explicit exclusions (NEVER). A GRS key may
//                      have at most ONE alias decision (Y or a CAS key), and not
//                      alongside an N; otherwise it is a conflict and the run
//                      exits with an error.
//
// DRY RUN BY DEFAULT: prints the count, every skip with its reason and 20
// random pairs, writes nothing. --write writes the file.
//
// Usage:
//   node scripts/build-grs-aliases.cjs                 (dry run)
//   node scripts/build-grs-aliases.cjs --write
//   node scripts/build-grs-aliases.cjs --csv <path>

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CSV = path.join(REPO_ROOT, '..', 'TerrierPlan-out', 'grs-cas-matches.csv');
const OUTPUT_PATH = path.join(REPO_ROOT, 'src', 'data', 'grsAliases.js');
const NEVER = new Map([
  ['GRSBI795', 'never aliased (ran Summer 2026)'],
  ['GRSCS935', 'never aliased (ran Summer 2026)'],
  ['GRSIS800', 'excluded by request'],
]);
const LOW_SCORE_CSV = path.join(REPO_ROOT, '..', 'TerrierPlan-out', 'grs-low-score.csv');
const SAMPLE = 20;
// Hand-kept aliases: exempt from the hold-back rules and the automatic rules.
const KEEP = new Map([
  ['GRSBI622', 'CASBB622'],
  ['GRSCH621', 'CASBI621'],
  ['GRSCH622', 'CASBB622'],
  ['GRSEN688', 'CASAA688'],
]);
const TOPIC_ROTATING_RE = /^(SEMINAR|TOPICS|SPECIAL TOPICS|PROBL|DISSERTATION|READINGS|COLLOQUIUM)/;

const KEY_RE = /^([A-Z]{3})([A-Z]{2})(\d+[A-Z]*)$/;
// ES, GE and EE are treated as one department.
const SAME_DEPT = { ES: 'EE', GE: 'EE' };
const deptOf = (key) => {
  const d = KEY_RE.exec(key)?.[2] ?? null;
  return SAME_DEPT[d] ?? d;
};
const normName = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
// Generic only when the whole name is one of these phrases, optionally followed
// by plain qualifiers (PT, FT, CFT, Part-Time, ...) — never by topic words.
const GENERIC_PHRASES = [
  'DIRECTED STUDY', 'DIRECT STUD', 'CERTIFIED FULL TIME STUDY', 'CERT FT', 'CONTINUING STUDY',
  'CONT STUDY', 'SPECIAL PROJECTS?', 'LAB ROTATION', 'COLLOQ', 'THESIS', 'DISSERTATION',
];
const QUALIFIERS = 'PT|FT|CFT|PART|FULL|TIME|CERTIFIED|CERT|STUDY|ONLY|I|II|III|1|2|3';
const GENERIC_RE = new RegExp(`^(?:${GENERIC_PHRASES.join('|')})(?: (?:${QUALIFIERS}))*$`);
const isGenericName = (name) => GENERIC_RE.test(normName(name));

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function build(rows) {
  const byGrs = new Map(); // grsKey -> { name, confidence, cands: [{ cas, casName, rule, score, grsLast, casFirst }] }
  for (const r of rows) {
    if (!byGrs.has(r.grsKey)) byGrs.set(r.grsKey, { name: r.grsName, confidence: r.confidence, cands: [] });
    if (r.casKey) {
      byGrs.get(r.grsKey).cands.push({
        cas: r.casKey, casName: r.casName, rule: r.nameRule, score: Number(r.nameScore),
        grsLast: r.grsLastTerm, casFirst: r.casFirstTerm,
      });
    }
  }
  const skipped = []; // { grs, name, reason, cas }
  const selected = []; // { grs, name, ...candidate }
  for (const [grs, { name, confidence, cands }] of [...byGrs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (confidence !== 'one-match' && confidence !== 'multiple-candidates') continue;
    const cas = cands.map((c) => c.cas);
    if (NEVER.has(grs)) { skipped.push({ grs, name, cas, reason: NEVER.get(grs) }); continue; }
    if (confidence === 'one-match') {
      const pick = cands[0];
      if (isGenericName(name) && deptOf(grs) !== deptOf(pick.cas)) {
        skipped.push({ grs, name, cas, reason: `generic name, department differs (${deptOf(grs)} vs ${deptOf(pick.cas)})` });
      } else {
        selected.push({ grs, name, ...pick });
      }
      continue;
    }
    const sameDept = cands.filter((c) => deptOf(c.cas) === deptOf(grs));
    if (sameDept.length === 1) selected.push({ grs, name, ...sameDept[0] });
    else skipped.push({ grs, name, cas, reason: sameDept.length === 0 ? 'multiple candidates, none in same department' : 'multiple candidates, several in same department' });
  }

  // Hold back topic-rotating / shared-number same-dept rows for review.
  const claims = new Map(); // casKey -> Set<grsKey>
  for (const x of selected) {
    if (!claims.has(x.cas)) claims.set(x.cas, new Set());
    claims.get(x.cas).add(x.grs);
  }
  const aliases = {};
  const autoRows = []; // auto-aliased rows
  const held = []; // { ...row, reasons: string[] }
  for (const x of selected) {
    if (KEEP.has(x.grs)) continue;
    const reasons = [];
    if (x.rule === 'same-dept' && x.score < 0.5 && TOPIC_ROTATING_RE.test(normName(x.casName))) reasons.push('topic-rotating CAS name');
    if (x.rule === 'same-dept' && claims.get(x.cas).size > 1) reasons.push(`CAS key claimed by ${claims.get(x.cas).size} GRS keys`);
    if (reasons.length) held.push({ ...x, reasons });
    else { aliases[x.grs] = x.cas; autoRows.push(x); }
  }
  // KEEP wins over everything except the explicit exclusions.
  const kept = [];
  for (const [grs, target] of KEEP) {
    if (NEVER.has(grs)) continue;
    aliases[grs] = target;
    kept.push(grs);
    const i = skipped.findIndex((sk) => sk.grs === grs);
    if (i !== -1) skipped.splice(i, 1);
  }
  return { aliases: Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => (a < b ? -1 : 1))), skipped, held, autoRows, kept };
}

function render(aliases) {
  const lines = Object.entries(aliases).map(([g, c]) => `  ${g}: '${c}',`);
  return [
    '// GRS -> CAS aliases for courses renumbered into CAS (same catalog number).',
    '// Read-time only: used to borrow credits, description, prerequisites and',
    '// offering history for the GRS key. Nothing in Firestore or in a saved plan',
    '// is changed. GENERATED by scripts/build-grs-aliases.cjs — do not edit by hand.',
    'export default {',
    ...lines,
    '};',
    '',
  ].join('\n');
}

// decisionRows: parsed CSV rows { grsKey, casKey, decision }. Returns the final
// map plus what the decisions did. `conflicts` are fatal; `ignored` are not.
function applyDecisions(autoAliases, decisionRows) {
  const aliases = { ...autoAliases };
  const result = { aliases, fromDecisions: [], overrides: [], removed: [], conflicts: [], ignored: [], differentNumber: [] };
  const byGrs = new Map(); // grsKey -> { alias: [{ cas, row }], never: boolean }
  decisionRows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const grs = String(row.grsKey ?? '').trim();
    const decision = String(row.decision ?? '').trim();
    if (!decision) return;
    if (!/^GRS[A-Z]{2}\d+[A-Z]*$/.test(grs)) {
      result.conflicts.push(`line ${line}: bad grsKey ${JSON.stringify(row.grsKey)}`);
      return;
    }
    const entry = byGrs.get(grs) ?? { alias: [], never: false };
    byGrs.set(grs, entry);
    if (/^N$/i.test(decision)) { entry.never = true; return; }
    const cas = /^Y$/i.test(decision) ? String(row.casKey ?? '').trim() : decision.toUpperCase();
    if (!/^CAS[A-Z]{2}\d+[A-Z]*$/.test(cas)) {
      result.conflicts.push(`line ${line}: ${grs} decision ${JSON.stringify(decision)} has no valid CAS key (casKey ${JSON.stringify(row.casKey)})`);
      return;
    }
    entry.alias.push(cas);
  });
  for (const [grs, { alias, never }] of byGrs) {
    const targets = [...new Set(alias)];
    if (targets.length > 1) {
      result.conflicts.push(`${grs}: more than one alias decision (${targets.join(', ')})`);
      continue;
    }
    if (never && targets.length) {
      result.conflicts.push(`${grs}: both N and an alias decision (${targets[0]})`);
      continue;
    }
    if (NEVER.has(grs)) {
      if (never || targets.length) result.ignored.push(`${grs}: decision ignored — ${NEVER.get(grs)}`);
      continue;
    }
    if (never) {
      if (grs in aliases) { delete aliases[grs]; result.removed.push(grs); }
      continue;
    }
    if (targets.length === 1) {
      const target = targets[0];
      if (grs in aliases && aliases[grs] !== target) result.overrides.push(`${grs}: ${aliases[grs]} -> ${target}`);
      if (KEY_RE.exec(grs)[3] !== KEY_RE.exec(target)[3]) result.differentNumber.push(`${grs} -> ${target}`);
      aliases[grs] = target;
      result.fromDecisions.push(grs);
    }
  }
  return result;
}

// Aliases in the current src/data/grsAliases.js, or {} if it isn't there yet.
function readExisting() {
  if (!fs.existsSync(OUTPUT_PATH)) return {};
  const out = {};
  for (const m of fs.readFileSync(OUTPUT_PATH, 'utf8').matchAll(/^\s+(GRS\w+): '(CAS\w+)',$/gm)) out[m[1]] = m[2];
  return out;
}

function main() {
  const csvPath = path.resolve(argValue('--csv') ?? DEFAULT_CSV);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
  const auto = build(rows);
  const { skipped, held, autoRows, kept } = auto;
  let aliases = auto.aliases;
  const decisionsArg = argValue('--decisions');
  if (process.argv.includes('--decisions') && !decisionsArg) {
    console.error('Usage: --decisions <path>');
    process.exit(1);
  }
  let decisionReport = null;
  if (decisionsArg) {
    const decisionsPath = path.resolve(decisionsArg);
    if (!fs.existsSync(decisionsPath)) {
      console.error(`Decisions CSV not found: ${decisionsPath}`);
      process.exit(1);
    }
    const decisionRows = parse(fs.readFileSync(decisionsPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
    if (decisionRows.length === 0 || !('grsKey' in decisionRows[0]) || !('decision' in decisionRows[0])) {
      console.error(`Decisions CSV needs grsKey, casKey and decision columns: ${decisionsPath}`);
      process.exit(1);
    }
    decisionReport = applyDecisions(auto.aliases, decisionRows);
    aliases = decisionReport.aliases;
    console.log(`Decisions: ${decisionsPath} (${decisionRows.length} rows, ${decisionRows.filter((r) => String(r.decision ?? '').trim()).length} with a decision)`);
  }
  const pairs = Object.entries(aliases);

  console.log(`CSV: ${csvPath} (${rows.length} rows)`);
  console.log(`Aliases: ${pairs.length}`);
  if (decisionReport) {
    const d = decisionReport;
    console.log(`  from decisions: ${d.fromDecisions.length} (${d.overrides.length} replace an automatic alias to a different target)`);
    console.log(`  removed by N:   ${d.removed.length}`);
    console.log(`  ignored:        ${d.ignored.length}`);
    for (const x of d.ignored) console.log(`    ${x}`);
    for (const x of d.overrides) console.log(`    override ${x}`);
    if (d.differentNumber.length) console.log(`  NOTE decisions to a different catalog number (${d.differentNumber.length}): ${d.differentNumber.join(', ')}`);
    console.log(`  CONFLICTS:      ${d.conflicts.length}`);
    for (const x of d.conflicts) console.log(`    ${x}`);
    if (d.conflicts.length) {
      console.error('\nFix the conflicts above; nothing written.');
      process.exit(1);
    }
  }
  const existing = readExisting();
  const added = pairs.filter(([g, c]) => existing[g] !== c);
  const removed = Object.entries(existing).filter(([g, c]) => aliases[g] !== c);
  console.log(`vs current src/data/grsAliases.js (${Object.keys(existing).length}): +${added.length} new, -${removed.length} dropped`);
  for (const [g, c] of added) console.log(`  + ${g} -> ${c}`);
  for (const [g, c] of removed) console.log(`  - ${g} -> ${c}`);
  console.log(`  built-in KEEP aliases: ${kept.length} (${kept.map((g) => `${g}->${KEEP.get(g)}`).join(', ')})`);
  const reasonCounts = {};
  for (const h of held) for (const r of h.reasons) reasonCounts[r.replace(/\d+ GRS keys/, 'N GRS keys')] = (reasonCounts[r.replace(/\d+ GRS keys/, 'N GRS keys')] || 0) + 1;
  console.log(`Held back for review: ${held.length} (a row can have both reasons)`);
  for (const [r, n] of Object.entries(reasonCounts)) console.log(`  ${r}: ${n}`);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lowCsv = ['grsKey,grsName,casKey,casName,grsLastTerm,casFirstTerm,rule,nameScore,reason,decision'].concat(
    held.map((h) => [h.grs, h.name, h.cas, h.casName, h.grsLast, h.casFirst, h.rule, Number.isFinite(h.score) ? h.score.toFixed(2) : '', h.reasons.join('; '), ''].map(esc).join(',')),
  );
  fs.mkdirSync(path.dirname(LOW_SCORE_CSV), { recursive: true });
  fs.writeFileSync(LOW_SCORE_CSV, lowCsv.join('\n') + '\n');
  console.log(`  -> ${LOW_SCORE_CSV}`);
  const lowAuto = autoRows.filter((x) => x.score < 0.5);
  console.log(`Auto-aliased rows with nameScore < 0.5: ${lowAuto.length}; 20 random:`);
  {
    const r = mulberry32(20261010);
    for (const x of [...lowAuto].sort(() => r() - 0.5).slice(0, 20)) {
      console.log(`  ${x.grs} "${x.name}" -> ${x.cas} "${x.casName}"  [${x.score.toFixed(2)}, ${x.rule}]`);
    }
  }
  console.log(`Skipped: ${skipped.length}`);
  for (const s of skipped) console.log(`  ${s.grs} "${s.name}" -> [${s.cas.join(', ')}]  ${s.reason}`);

  const rand = mulberry32(20261009);
  console.log(`\n${Math.min(SAMPLE, pairs.length)} random pairs:`);
  for (const [g, c] of [...pairs].sort(() => rand() - 0.5).slice(0, SAMPLE)) console.log(`  ${g} -> ${c}`);

  if (!process.argv.includes('--write')) {
    console.log('\nDRY RUN — nothing written. Pass --write to write src/data/grsAliases.js.');
    return;
  }
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, render(aliases));
  console.log(`\nWrote ${path.relative(REPO_ROOT, OUTPUT_PATH)} (${pairs.length} aliases).`);
}

if (require.main === module) main();

module.exports = { build, render, isGenericName, applyDecisions };
