// The Marine Semester course lists, hand-curated. Plain JS (no Vite-only
// imports) so the requirements engine and node tests can load it.
//
// Three lists of courseKeys, cross-listed twins listed explicitly (a student
// takes ONE of a pair; see TWIN_GROUPS):
//   ONLY      — requires enrollment/admission in the Marine Semester, no other
//               route. Putting one in a Fall term makes that term a Marine
//               Semester term.
//   ALSO      — has another route in (consent of instructor, another
//               prerequisite, an open section), so no placement rule.
//   RESEARCH  — also allowed in a Marine term, where it fills one of the four
//               slots ("in lieu of one of the four block courses").
// A course in none of them has no rule: this module fails open, so a stale
// list never blocks planning. Excluded on purpose: CASBI260 (a prerequisite
// of the Marine Semester, not part of it) and CASMR501 (0-credit co-requisite).
// Inactive ES-subject keys (CASES558, CASES591...) are skipped.
//
// Tracker pool (marinePool): ONLY plus CASEE557 and CASMR500, the bulletin's
// Marine Semester list. NOT CASBI423/CASEE423/CASEE623: those are in the
// Marine Breadth pool and would double-claim.
//
// YEARLY REFRESH (when the next Fall's schedule CSV arrives):
//   1. node scripts/list-marine-semester-offerings.cjs [path/to/FallCSV]
//      (read-only, local files) prints BUMP-noted Fall courses that are not
//      in ONLY/ALSO/RESEARCH below.
//   2. Read each one's prerequisite text (bu_courses_all.csv) and put it in
//      ONLY (enrollment/admission required, no alternative), ALSO or
//      RESEARCH. Add its cross-listed twin to the same list and TWIN_GROUPS.
//   3. Replace fallOfferings with the new year and the keys the script lists
//      (BUMP note, section not Cancelled).
//   4. node --test src/utils/marineSemester.test.js (keys exist in
//      public/courses.json, no key in two lists, twins agree).
import { normalizeCourseKey } from '../utils/courseKey.js';

export const ONLY = [
  'CASBI511', 'CASBI521', 'CASBI523', 'CASBI531', 'CASBI539', 'CASBI541', 'CASBI546',
  'CASBI548', 'CASBI558', 'CASBI562', 'CASBI569', 'CASBI578', 'CASBI591', 'CASBI593',
  'CASEE523', 'CASEE539', 'CASEE542', 'CASEE543', 'CASEE544', 'CASEE558', 'CASEE562',
  'CASEE578', 'CASEE591', 'CASEE593',
  'CASMR533',
];

export const ALSO = ['CASEE557', 'CASMR500', 'CASBI423', 'CASEE423', 'CASEE623'];

export const RESEARCH = ['CASMR391', 'CASMR392', 'CASMR491', 'CASMR492'];

// Cross-listed twins: the same course under two codes.
export const TWIN_GROUPS = [
  ['CASBI523', 'CASEE523'],
  ['CASBI539', 'CASEE539'],
  ['CASBI558', 'CASEE558'],
  ['CASBI562', 'CASEE562'],
  ['CASBI578', 'CASEE578'],
  ['CASBI591', 'CASEE591'],
  ['CASBI593', 'CASEE593'],
  ['CASBI423', 'CASEE423', 'CASEE623'],
];

// Fall 2026 (term 2268) sections carrying a "BUMP" note in
// Fall2026Courses.csv, Cancelled sections left out (CASBI521). Matched on
// "BUMP" because one note is misspelled "Marine Semster Class" (EE 544).
export const fallOfferings = {
  year: 2026,
  keys: [
    'CASBI511', 'CASBI531', 'CASBI546', 'CASBI548', 'CASBI569', 'CASBI578', 'CASBI593',
    'CASEE542', 'CASEE543', 'CASEE544', 'CASEE562', 'CASEE578',
    'CASMR500', 'CASMR533',
  ],
};

const ONLY_SET = new Set(ONLY);
const ALSO_SET = new Set(ALSO);
const RESEARCH_SET = new Set(RESEARCH);

// The bulletin's Marine Semester list: ONLY plus these two ALSO courses.
const POOL_EXTRA = ['CASEE557', 'CASMR500'];

// 'only' | 'also' | null. Research courses are 'also' (see isMarineResearch).
export function marineKind(courseKey) {
  if (typeof courseKey !== 'string') return null;
  const key = normalizeCourseKey(courseKey);
  if (ONLY_SET.has(key)) return 'only';
  if (ALSO_SET.has(key) || RESEARCH_SET.has(key)) return 'also';
  return null;
}

// A research-in-lieu course (allowed in a Marine term, fills one slot).
export function isMarineResearch(courseKey) {
  return typeof courseKey === 'string' && RESEARCH_SET.has(normalizeCourseKey(courseKey));
}

// The courseKey and its cross-listed twins ([courseKey] alone when it has none).
export function twinGroup(courseKey) {
  if (typeof courseKey !== 'string') return [];
  const key = normalizeCourseKey(courseKey);
  return [...(TWIN_GROUPS.find((group) => group.includes(key)) ?? [key])];
}

// Flat courseKeys of the tracker card's browse list (twins both listed).
export function marinePoolKeys() {
  return [...ONLY, ...POOL_EXTRA];
}

// True for a course that fills one of a Marine term's four slots: any pool
// course, or a research course.
export function fillsMarineSlot(courseKey) {
  if (typeof courseKey !== 'string') return false;
  const key = normalizeCourseKey(courseKey);
  return RESEARCH_SET.has(key) || marinePoolKeys().includes(key);
}

// The tracker pool as requirements-engine pool entries: a courseKey string, or
// an OR_EQUIVALENT for cross-listed twins so a pair counts once.
export function marinePool() {
  const seen = new Set();
  const pool = [];
  for (const key of marinePoolKeys()) {
    if (seen.has(key)) continue;
    const members = twinGroup(key).filter((member) => marinePoolKeys().includes(member));
    members.forEach((member) => seen.add(member));
    pool.push(members.length > 1 ? { type: 'OR_EQUIVALENT', options: members } : key);
  }
  return pool;
}

// Whether any twin of the course has a Fall offering in `fallOfferings`.
export function isFallOffering(courseKey) {
  const offered = new Set(fallOfferings.keys);
  return twinGroup(courseKey).some((key) => offered.has(key));
}

// The tracker card's browse list: one row per course, twins as one
// ({ key: the first twin (what "+" and a drag add), keys: all twins in the
// list, offered }), in pool order.
export function marinePoolRows() {
  return marinePool().map((entry) => {
    const keys = typeof entry === 'string' ? [entry] : entry.options;
    return { key: keys[0], keys, offered: keys.some((key) => isFallOffering(key)) };
  });
}

// Whether a search query should show the pinned "Marine Semester" row: the
// RAW trimmed query contains "marine" (case-insensitive). Deliberately not the
// normalized course-key query, which strips spaces ("marine semester" would
// become one word).
export function matchesMarineQuery(rawQuery) {
  return typeof rawQuery === 'string' && rawQuery.trim().toLowerCase().includes('marine');
}

// Marine Semester courses are 4 units (the bulletin says so), but a few were
// never scheduled under their own code (CASEE593 has no section in any
// imported schedule, so nothing supplies its credits). Returns a copy of the
// credits map where each pool or ALSO course (not research, whose credits
// vary) with unknown credits (absent, null or not a positive number) gets its
// cross-listed twin's credits if known, else MARINE_COURSE_CREDITS. Known
// credits are never changed.
export const MARINE_COURSE_CREDITS = 4;

export function withMarineCreditFallback(creditsMap) {
  const base = creditsMap || {};
  const known = (key) => typeof base[key] === 'number' && base[key] > 0;
  const out = { ...base };
  for (const key of new Set([...marinePoolKeys(), ...ALSO])) {
    if (known(key)) continue;
    const twin = twinGroup(key).find((other) => other !== key && known(other));
    out[key] = twin ? base[twin] : MARINE_COURSE_CREDITS;
  }
  return out;
}
