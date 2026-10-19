// scripts/backup-sections.cjs
//
// Backs up every `sections` doc with term == '2271' to
// ../TerrierPlan-out/sections-2271-backup-2026-10-19.json as { docId: data }.
//
// READ-ONLY against Firestore — this script never writes to the database.
// Refuses to overwrite an existing output file.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json \
//     node scripts/backup-sections.cjs

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const REPO_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '..', 'TerrierPlan-out');
const OUTPUT_PATH = path.join(OUT_DIR, 'sections-2271-backup-2026-10-19.json');

if (fs.existsSync(OUTPUT_PATH)) {
  console.error(`Refusing to overwrite existing file: ${OUTPUT_PATH}`);
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

(async () => {
  const snap = await db.collection('sections').where('term', '==', '2271').get();
  const out = {};
  for (const doc of snap.docs) out[doc.id] = doc.data();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 'wx' fails if the file appeared since the check above.
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n', { flag: 'wx' });
  console.log(`Backed up ${snap.size} sections to ${OUTPUT_PATH}`);
})().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
