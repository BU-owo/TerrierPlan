import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeCourseKey, parseCourseKey } from './courseKey';

// The whole `courses` collection, loaded once and shared by every caller
// (CourseSearch's live search, the HUB Tracker's department browse panel,
// ...) instead of each mounting its own getDocs call. A module-level
// promise (not component state) so it survives across mounts/unmounts and
// concurrent callers await the same in-flight request rather than each
// firing their own.
let coursesPromise = null;

export function loadAllCourses() {
  if (!coursesPromise) {
    coursesPromise = getDocs(collection(db, 'courses'))
      .then((snapshot) => snapshot.docs.map((d) => ({ id: d.id, ...d.data() })))
      .catch((err) => {
        coursesPromise = null; // let the next caller retry instead of caching a failure
        throw err;
      });
  }
  return coursesPromise;
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

  return matches.sort(
    (a, b) => (parseCourseKey(a.id)?.number ?? 0) - (parseCourseKey(b.id)?.number ?? 0),
  );
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
