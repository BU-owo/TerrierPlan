// patch-fyw-wri.cjs
// One-time patch: adds the missing 'FYW' and 'WRI' HUB codes to the
// specific courses that fulfill them, per bu.edu/hub (fetched live).
// These two codes were absent from the original catalog CSV entirely,
// so this can't be derived from existing data — it's a manual patch
// against BU's published Hub course lists for these two areas.
//
// Usage:
//   node scripts/patch-fyw-wri.cjs
//
// Safe to re-run: uses arrayUnion, so it won't duplicate the tag if
// run more than once.

const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.applicationDefault(),
});
const db = admin.firestore();

function normalizeCourseKey(courseNumber) {
  return courseNumber.replace(/\s+/g, '').toUpperCase();
}

// Source: bu.edu/hub/hub-courses/first-year-writing-seminar/
const FYW_COURSES = [
  'CAS CC 101',
  'CAS EN 120',
  'CAS WR 120',
  'CAS WR 120S',
  'CGS RH 104E',
  'CGS RH 104S',
  'KHC ST 111',
];

// Source: bu.edu/hub/hub-courses/writing-research-and-inquiry/
const WRI_COURSES = [
  'CAS CC 201',
  'CAS CH 112',
  'CAS CH 182',
  'CAS EN 220',
  'CAS EN 220S',
  'CAS WR 151',
  'CAS WR 151E',
  'CAS WR 151S',
  'CAS WR 152',
  'CAS WR 152E',
  'CAS WR 152S',
  'CAS WR 153',
  'CAS WR 153E',
  'CAS WR 153S',
  'CGS RH 103',
  'KHC ST 112',
  'QST SM 275',
  'QST SM 275S',
  'SHA HF 282',
];

async function patch(courseNumbers, hubCode) {
  let updated = 0;
  let missing = [];

  for (const courseNumber of courseNumbers) {
    const key = normalizeCourseKey(courseNumber);
    const ref = db.collection('courses').doc(key);
    const doc = await ref.get();

    if (!doc.exists) {
      missing.push(courseNumber);
      continue;
    }

    await ref.update({
      hubUnits: admin.firestore.FieldValue.arrayUnion(hubCode),
    });
    updated++;
  }

  return { updated, missing };
}

async function run() {
  const fyw = await patch(FYW_COURSES, 'FYW');
  console.log(`FYW: updated ${fyw.updated} course(s).`);
  if (fyw.missing.length) {
    console.log(`FYW: not found in catalog (may need adding separately): ${fyw.missing.join(', ')}`);
  }

  const wri = await patch(WRI_COURSES, 'WRI');
  console.log(`WRI: updated ${wri.updated} course(s).`);
  if (wri.missing.length) {
    console.log(`WRI: not found in catalog (may need adding separately): ${wri.missing.join(', ')}`);
  }

  console.log('Done.');
}

run().catch((err) => {
  console.error('Patch failed:', err);
  process.exit(1);
});
