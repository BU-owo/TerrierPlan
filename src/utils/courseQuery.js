import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeCourseKey, compareByCatalogNumber } from './courseKey';

// The whole `courses` collection, loaded once and shared by every caller
// (CourseSearch's live search, the HUB Tracker's department browse panel,
// ...) instead of each mounting its own getDocs call. A module-level
// promise (not component state) so it survives across mounts/unmounts and
// concurrent callers await the same in-flight request rather than each
// firing their own.
//
// Served from the static /courses.json (written by scripts/export-catalog.cjs)
// rather than read from Firestore on every visit. That file omits fields that
// are null/false/empty, so consumers must treat a missing field as absent.
// If the file is missing or unusable, falls back to reading the collection.
let coursesPromise = null;

async function loadCoursesFromStaticFile() {
  const res = await fetch('/courses.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const courses = await res.json();
  if (!Array.isArray(courses) || courses.length === 0) {
    throw new Error('expected a non-empty array');
  }
  return courses;
}

function loadCoursesFromFirestore() {
  return getDocs(collection(db, 'courses')).then((snapshot) => {
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
}

export function loadAllCourses() {
  if (!coursesPromise) {
    coursesPromise = loadCoursesFromStaticFile()
      .catch((err) => {
        console.warn('Static course catalog unavailable, falling back to Firestore:', err);
        return loadCoursesFromFirestore();
      })
      .catch((err) => {
        coursesPromise = null; // let the next caller retry instead of caching a failure
        throw err;
      });
  }
  return coursesPromise;
}

// The catalog is ~8k docs on the same Firestore connection as the signed-in
// plan load, and downloading it first delays the plans by seconds. So
// CourseSearch (always mounted on the planner) doesn't start it on mount —
// it waits for this one-way, session-wide gate, opened by whichever comes
// first: PlannerPage once a plan is showing (immediately for guests), or
// the student starting a search. Callers that need the catalog right away
// (HubFullView) keep calling loadAllCourses() directly.
let releaseCatalogGate;
const catalogGate = new Promise((resolve) => {
  releaseCatalogGate = resolve;
});

export function requestCatalogLoad() {
  releaseCatalogGate();
}

export function loadAllCoursesWhenRequested() {
  return catalogGate.then(loadAllCourses);
}

// Undergrads may take most Graduate courses, so Undergrad and Graduate are
// treated the same; only Law, Dental and Medical courses aren't open to
// them. Searches list these last (with a chip naming the school) and the
// HUB search drops them. A missing or unknown `career` is not professional.
const PROFESSIONAL_CAREERS = new Set(['Law', 'Dental', 'Medical']);

export function isProfessionalCareer(career) {
  return PROFESSIONAL_CAREERS.has(career);
}

// Valid `mode` values for the `hubUnitCodes` match below.
export const HUB_MATCH_MODES = { AND: 'and', OR: 'or' };

// Single filtering entrypoint over an already-loaded course list (from
// loadAllCourses), built so the department-prefix browse and the HUB gap-
// fill search share one implementation instead of growing into two
// parallel query paths.
//
// - `prefix`: a courseKey or subject prefix (e.g. "CAS CS", "CASCS") —
//   matched with the same normalize-then-startsWith rule CourseSearch's own
//   subject-mode search uses. Empty/omitted = no prefix filtering.
// - `hubUnitCodes` / `mode`: which HUB units a course must carry to match,
//   and how — HUB_MATCH_MODES.AND requires the course's hubUnits to be a
//   superset of hubUnitCodes (has all of them), HUB_MATCH_MODES.OR (the
//   default) requires only an intersection (has any of them). Empty/omitted
//   `hubUnitCodes` = no HUB-code filtering.
// - `excludeUnitCodes`: HUB codes a course must have NONE of to match —
//   deliberately a separate param rather than a third `mode`, since "has
//   none of these" isn't an AND/OR alternative, it's an independent
//   condition applied on top of whichever mode is chosen. Empty/omitted =
//   no exclusion.
// - `excludeKeys`: a Set of courseKeys to drop from the results regardless
//   of match (e.g. courses already in the plan or stash) — same
//   Set-membership exclusion collectPoolCourses uses in treeHelpers.js.
//
// Results are sorted by catalog number ascending, matching CourseSearch's
// subject-mode ordering.
export function queryCourses(
  courses,
  { prefix = '', hubUnitCodes = [], mode = HUB_MATCH_MODES.OR, excludeUnitCodes = [] } = {},
  excludeKeys = new Set(),
) {
  const normalizedPrefix = prefix ? normalizeCourseKey(prefix) : '';
  const includeCodes = hubUnitCodes.filter(Boolean);
  const excludeCodes = excludeUnitCodes.filter(Boolean);

  const matches = courses.filter((course) => {
    if (excludeKeys.has(course.id)) return false;
    if (normalizedPrefix && !course.id.startsWith(normalizedPrefix)) return false;

    const courseUnits = course.hubUnits ?? [];
    if (includeCodes.length > 0) {
      const passesInclude =
        mode === HUB_MATCH_MODES.AND
          ? includeCodes.every((code) => courseUnits.includes(code))
          : includeCodes.some((code) => courseUnits.includes(code));
      if (!passesInclude) return false;
    }
    if (excludeCodes.length > 0 && excludeCodes.some((code) => courseUnits.includes(code))) {
      return false;
    }
    return true;
  });

  return matches.sort(compareByCatalogNumber);
}

// Every real school-level ("CAS") and department-level ("CAS AA") prefix
// present in an already-loaded course list, derived from each course's own
// `courseNumber` field (always "SCHOOL DEPT NUMBER", e.g. "CAS AA 238" —
// the same spaced format bu_courses_all.csv/import-courses.cjs stores it
// in) rather than hardcoded, so the list can't drift from what's actually
// in the catalog and picks up new departments automatically. Used to
// auto-populate the HUB Tracker's department-prefix autocomplete.
export function collectDepartmentPrefixes(courses) {
  const prefixes = new Set();
  for (const course of courses) {
    const parts = (course.courseNumber || '').trim().split(/\s+/);
    if (parts.length < 2) continue;
    prefixes.add(parts[0]); // school-level, e.g. "CAS"
    prefixes.add(`${parts[0]} ${parts[1]}`); // department-level, e.g. "CAS AA"
  }
  return Array.from(prefixes).sort();
}

// Transcripts list session-specific sections with a trailing S
// ("CASWR151S") where the catalog key has none. Returns the key without that
// S, or null when the key doesn't end in digit+S. Never strips E — E keys
// are real study-abroad courses, not a session marker.
export function stripSessionSuffix(courseKey) {
  const match = /^(.*\d)S$/.exec(courseKey || '');
  return match ? match[1] : null;
}

// Firestore's `in` operator takes at most 30 values per query.
const IN_QUERY_LIMIT = 30;

async function findExistingCourseKeys(keys) {
  const found = new Set();
  for (let i = 0; i < keys.length; i += IN_QUERY_LIMIT) {
    const batch = keys.slice(i, i + IN_QUERY_LIMIT);
    const snap = await getDocs(query(collection(db, 'courses'), where(documentId(), 'in', batch)));
    snap.forEach((d) => found.add(d.id));
  }
  return found;
}

// Maps each transcript courseKey to the catalog key it should import as:
// the exact key if a course doc exists for it, else the session-stripped
// key (CASWR151S → CASWR151) if THAT exists, else the exact key unchanged.
// Point lookups rather than loadAllCourses() so importing a transcript
// doesn't pull the whole catalog.
export async function resolveCourseKeys(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  const exactHits = await findExistingCourseKeys(unique);

  const strippedFor = new Map(); // original key → stripped candidate
  for (const key of unique) {
    if (exactHits.has(key)) continue;
    const stripped = stripSessionSuffix(key);
    if (stripped) strippedFor.set(key, stripped);
  }
  const strippedHits = await findExistingCourseKeys([...new Set(strippedFor.values())]);

  const resolved = new Map();
  for (const key of unique) {
    const stripped = strippedFor.get(key);
    resolved.set(key, stripped && strippedHits.has(stripped) ? stripped : key);
  }
  return resolved;
}
