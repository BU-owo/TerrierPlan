#!/usr/bin/env node
/**
 * Fills in real titles / descriptions / prerequisites / HUB units on the course
 * docs that create-courses-from-schedule.cjs created on 2026-10-27, using data
 * copied by hand from BU's Hub and bulletin pages.
 *
 *   node scripts/patch-new-courses-oct27.cjs            # dry run (reads Firestore, writes nothing)
 *   node scripts/patch-new-courses-oct27.cjs --apply    # backs up the docs, then update()s them
 *
 * Safety:
 *  - Only touches courses/<key> docs that already exist and have source 'schedule-history'.
 *  - Uses update(), so no other field is touched.
 *  - HUB codes are checked against the codes already present in public/courses.json,
 *    and CASPO342's must match CASPO392's (same three Hub areas). Any mismatch aborts.
 *  - --apply writes a backup to ../TerrierPlan-out/ first.
 *  - Safe to re-run (idempotent). Afterwards run scripts/export-catalog.cjs.
 *
 * Needs GOOGLE_APPLICATION_CREDENTIALS (service-account key outside the repo).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, '..', 'TerrierPlan-out');
const CATALOG = path.join(ROOT, 'public', 'courses.json');
const DETAILS_SOURCE = 'manual-bu-pages';

// Hub area -> code (spelling verified against the catalog at runtime).
const CRT = 'CRT'; // Critical Thinking
const ETR = 'ETR'; // Ethical Reasoning
const PLM = 'PLM'; // Philosophical Inquiry and Life's Meanings

const PATCHES = {
  CASPO342: {
    name: 'Contemporary Political Theory',
    description:
      'Covers major debates in contemporary political theory, including equality, democracy, surveillance, gender, migration, and climate change. Students learn to analyze difficult texts, compare competing arguments, and apply theoretical concepts to ethical and public questions shaping their daily lives.',
    hubUnits: [CRT, ETR, PLM],
    hubSameAs: 'CASPO392', // same three Hub areas on BU's page
  },
  CASWS309: {
    name: 'The Politics of Gender and Identity in the US',
    description:
      'This course explores the complexities of gender and sexuality in American Politics, with a focus on how gender anxieties are reflected within nationalist and populist discourses throughout the Trump era.',
    hubUnits: [ETR],
  },
  CASEN581: {
    name: 'Senior Honors Thesis 2',
  },
  ENGBE506: {
    name: 'Physical Chemistry of Cell Structure and Machinery',
  },
  CASCL992: {
    name: 'Directed Study in Classical Studies',
    description: 'Directed study in a topic in classical studies.',
  },
  CASCX642: {
    name: 'Applied Machine Learning',
    prerequisites: 'CAS CX 641',
    description:
      'This module provides a rigorous introduction to machine learning concepts, techniques, and algorithms, with an emphasis on applied methods for classification, regression, clustering, dimensionality reduction, deep learning, reinforcement learning, generative models, and advanced neural network topics. The focus is on hands-on experience using Python and targeted libraries such as scikit-learn and PyTorch.',
  },
  CASCX652: {
    name: 'Cloud Computing',
    prerequisites: 'CAS CX 651',
    description:
      'Designed for working professionals, this course provides an application-oriented study of cloud computing to build both theoretical depth and practical expertise. Topics include virtualization, containerization, and cloud architectures, with an emphasis on modern infrastructure design, resource management, and orchestration. The course also covers principles of scalability, distributed computation, and cloud-native systems, teaching students how to design, deploy, and evaluate robust solutions using industry-standard platforms. Security and compliance frameworks are integrated throughout.',
  },
  CDSEA604: {
    name: 'Data Engineering & Strategy for AI',
    description:
      'This course covers building the robust data foundation that enterprise AI requires. You will learn to manage data at scale using SQL and NoSQL databases, and master modern Vector Databases essential for Retrieval-Augmented Generation (RAG) and other semantic AI applications.',
  },
  CDSEA620: {
    name: 'Designing & Building LLM Applications',
    description:
      'A hands-on course focused on the complete toolkit for customizing Large Language Models. You will master the three core methods for adapting LLMs to enterprise tasks: prompt engineering, Retrieval-Augmented Generation (RAG), and fine-tuning.',
  },
  CDSEA820: {
    name: 'Enterprise AI for Leaders 2',
    description:
      'A program-long, hands-on sequence of courses where you apply skills from all courses to solve a real-world enterprise problem. The capstone runs across all four semesters, moving from proposal and design to final prototype and presentation. The course also includes a speaker series. Students should take these courses in sequence and one per semester.',
  },
  WEDAP994: {
    name: 'Doctoral Seminar 4: Defining Your Methodology',
    description:
      "In this course students will define the methodology of their capstone project. Additionally, this course will support students' ongoing professional development and identify the connections between the Executive EdD coursework and their work as higher education leaders.",
  },
};

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function loadCatalog() {
  const arr = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const byId = new Map(arr.map((c) => [c.id, c]));
  const codes = new Set();
  for (const c of arr) for (const h of c.hubUnits || []) codes.add(h);
  return { byId, codes };
}

function validate({ byId, codes }) {
  const problems = [];
  for (const [key, p] of Object.entries(PATCHES)) {
    for (const h of p.hubUnits || []) {
      if (!codes.has(h)) problems.push(`${key}: HUB code "${h}" never appears in public/courses.json`);
    }
    if (p.hubSameAs) {
      const ref = byId.get(p.hubSameAs);
      const want = [...(ref?.hubUnits || [])].sort();
      const got = [...(p.hubUnits || [])].sort();
      if (!ref) problems.push(`${key}: reference course ${p.hubSameAs} not in catalog`);
      else if (!sameValue(want, got)) {
        problems.push(`${key}: hubUnits ${JSON.stringify(got)} differ from ${p.hubSameAs} ${JSON.stringify(want)}`);
      }
    }
  }
  return problems;
}

async function main() {
  console.log(APPLY ? 'APPLY MODE: will write to live Firestore' : 'DRY RUN: nothing is written (pass --apply to write)');

  const catalog = loadCatalog();
  const problems = validate(catalog);
  if (problems.length) {
    console.error('\nABORT, validation failed:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('HUB codes validated against public/courses.json.');

  initializeApp();
  const db = getFirestore();

  const backups = {};
  const writes = [];
  let skipped = 0;

  for (const [key, patch] of Object.entries(PATCHES)) {
    const ref = db.collection('courses').doc(key);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`\n${key}: SKIP, no course doc (run create-courses-from-schedule first)`);
      skipped++;
      continue;
    }
    const cur = snap.data();
    if (cur.source !== 'schedule-history') {
      console.log(`\n${key}: SKIP, source is "${cur.source}", not a schedule-history doc`);
      skipped++;
      continue;
    }

    const { hubSameAs, ...fields } = patch;
    const update = { ...fields, nameIsAbbreviated: false, detailsSource: DETAILS_SOURCE };
    console.log(`\n${key}`);
    let changed = 0;
    for (const [f, v] of Object.entries(update)) {
      if (sameValue(cur[f], v)) continue;
      changed++;
      const show = (x) => (typeof x === 'string' && x.length > 70 ? x.slice(0, 67) + '...' : JSON.stringify(x));
      console.log(`  ${f}: ${show(cur[f])}  ->  ${show(v)}`);
    }
    if (!changed) {
      console.log('  (already up to date)');
      continue;
    }
    backups[key] = cur;
    writes.push({ ref, update: { ...update, detailsImportedAt: FieldValue.serverTimestamp() } });
  }

  console.log(`\n${writes.length} doc(s) to update, ${skipped} skipped.`);
  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to write.');
    return;
  }
  if (!writes.length) return;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(OUT_DIR, `new-courses-patch-backup-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backups, null, 2));
  console.log(`Backup written: ${backupFile}`);

  const batch = db.batch();
  for (const w of writes) batch.update(w.ref, w.update);
  await batch.commit();
  console.log(`Done. Updated ${writes.length} docs. Now run: node scripts/export-catalog.cjs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
