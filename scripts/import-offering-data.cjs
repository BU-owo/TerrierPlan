// scripts/import-offering-data.cjs
//
// Merges offering-frequency data (from historical PeopleSoft schedule
// exports) onto existing courses/{courseKey} docs, and writes full
// per-term history to a separate offeringHistory/{courseKey} collection.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/import-offering-data.cjs path/to/courses.json
//
// Idempotent — safe to re-run (uses set with merge:true).

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node import-offering-data.cjs path/to/courses.json');
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const BATCH_SIZE = 400; // stay under Firestore's 500 write/batch limit

async function main() {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const entries = Object.entries(raw);
  console.log(`Loaded ${entries.length} offering-data entries.`);

  // Only merge onto courseKeys that already exist in `courses` — this file
  // includes non-catalog entries (e.g. BU Academy pre-college codes) that
  // shouldn't create stray docs.
  const existingKeys = new Set();
  const coursesSnap = await db.collection('courses').select().get();
  coursesSnap.forEach((doc) => existingKeys.add(doc.id));
  console.log(`Found ${existingKeys.size} existing course docs.`);

  let matched = 0;
  let skipped = 0;
  let batch = db.batch();
  let opsInBatch = 0;
  let batchesCommitted = 0;

  for (const [courseKey, entry] of entries) {
    if (!existingKeys.has(courseKey)) {
      skipped++;
      continue;
    }
    matched++;

    const detail = entry.offeringDetail || {};
    const courseRef = db.collection('courses').doc(courseKey);
    batch.set(
      courseRef,
      {
        offeringPattern: entry.offeringPattern || null,
        offeredSeasons: detail.offeredSeasons || [],
        fallRatio: detail.fallRatio ?? null,
        springRatio: detail.springRatio ?? null,
        summerRatio: detail.summerRatio ?? null,
        firstOfferedYear: detail.firstOfferedYear ?? null,
        lastOfferedYear: detail.lastOfferedYear ?? null,
        datasetYearsAvailable: detail.datasetYearsAvailable ?? null,
        offeringDataUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    opsInBatch++;

    const historyRef = db.collection('offeringHistory').doc(courseKey);
    batch.set(
      historyRef,
      {
        history: entry.history || [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    opsInBatch++;

    if (opsInBatch >= BATCH_SIZE) {
      await batch.commit();
      batchesCommitted++;
      console.log(`Committed batch ${batchesCommitted} (${matched} matched so far)...`);
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
    batchesCommitted++;
  }

  console.log(`Done. Matched & wrote: ${matched}. Skipped (no matching course doc): ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
