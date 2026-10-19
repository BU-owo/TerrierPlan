// scripts/list-marine-semester-offerings.cjs
//
// READ-ONLY, local files only (no Firestore, no network, writes nothing).
// Part of the yearly refresh of src/data/marineSemester.js (see its header).
//
// Reads a term's schedule CSV (default: Fall2026Courses.csv at the repo
// root) and prints every course with a section whose Notes mention "BUMP"
// (matched on BUMP because one note is misspelled "Marine Semster") that is
// NOT yet in the module's ONLY / ALSO / RESEARCH lists. Cancelled sections are
// reported separately and left out of the keys line, like fallOfferings.
// Finish with the "fallOfferings.keys" line it prints.
//
// Usage:
//   node scripts/list-marine-semester-offerings.cjs [path/to/Fall2027Courses.csv]

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { parse } = require('csv-parse/sync');

const REPO_ROOT = path.resolve(__dirname, '..');
const csvPath = path.resolve(process.argv[2] || path.join(REPO_ROOT, 'Fall2026Courses.csv'));

async function main() {
  const mod = await import(pathToFileURL(path.join(REPO_ROOT, 'src', 'data', 'marineSemester.js')).href);
  const listed = new Set([...mod.ONLY, ...mod.ALSO, ...mod.RESEARCH]);

  const rows = parse(fs.readFileSync(csvPath, 'utf8'), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  });

  const active = new Map(); // courseKey -> description
  const cancelledOnly = new Map();
  for (const row of rows) {
    if (!/bump/i.test(row.Notes || '')) continue;
    const key = `${row['Subject Area']}${row['Catalog Nbr']}`.replace(/\s+/g, '').toUpperCase();
    const title = row.Description || '';
    if (/cancel/i.test(row['Class Stat'] || '')) {
      if (!active.has(key)) cancelledOnly.set(key, title);
    } else {
      active.set(key, title);
      cancelledOnly.delete(key);
    }
  }

  console.log(`${path.basename(csvPath)}: ${active.size} BUMP-noted course(s) with a section that is not cancelled.`);
  const missing = [...active].filter(([key]) => !listed.has(key));
  if (missing.length === 0) {
    console.log('Every one is already in ONLY / ALSO / RESEARCH.');
  } else {
    console.log('\nNOT in the module yet (classify from the prerequisite text, add the twin too):');
    for (const [key, title] of missing) console.log(`  ${key}  ${title}`);
  }
  if (cancelledOnly.size > 0) {
    console.log('\nBUMP-noted but every section cancelled (leave out of fallOfferings):');
    for (const [key, title] of cancelledOnly) console.log(`  ${key}  ${title}`);
  }
  const keys = [...active.keys()].sort();
  console.log('\nfallOfferings.keys for this file:');
  console.log(`  ${JSON.stringify(keys)}`);
  const stale = [...mod.fallOfferings.keys].filter((key) => !active.has(key));
  if (stale.length > 0) {
    console.log(`\nIn the module's current fallOfferings but not in this file: ${stale.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
