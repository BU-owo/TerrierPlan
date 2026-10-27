// scripts/audit-class-stat.cjs
//
// READ-ONLY against Firestore — this script never writes to the database.
// Prints every distinct `classStat` value (with counts) among the `sections`
// docs whose term is CURRENT_TERM (read from src/utils/term.js), so you can
// check that the hidden set in src/utils/sectionVisibility.js (and its copy
// in scripts/export-catalog.cjs) matches the strings actually stored.
// Values are printed JSON-quoted so stray whitespace shows.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json node scripts/audit-class-stat.cjs

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const TERM_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'src', 'utils', 'term.js'), 'utf8');
const CURRENT_TERM = /export const CURRENT_TERM = '(\d{4})'/.exec(TERM_SOURCE)?.[1];
if (!CURRENT_TERM) {
  console.error('Could not read CURRENT_TERM from src/utils/term.js.');
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set — point it at the service-account key (outside the repo).');
  process.exit(1);
}
if (path.resolve(keyPath).startsWith(REPO_ROOT + path.sep)) {
  console.warn(`WARNING: service-account key is inside the repo (${keyPath}). Move it out so it can't be committed.`);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

async function main() {
  const snap = await db.collection('sections').where('term', '==', CURRENT_TERM).select('classStat').get();
  const counts = new Map();
  for (const doc of snap.docs) {
    const value = doc.get('classStat');
    const label = value === undefined ? '(missing)' : JSON.stringify(value);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  console.log(`Term ${CURRENT_TERM}: ${snap.size} sections, ${counts.size} distinct classStat values\n`);
  for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${label}`);
  }
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
