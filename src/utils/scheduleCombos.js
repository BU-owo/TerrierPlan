import { sectionsConflict } from './sectionTime';

// Safety valves against a pathological input (e.g. 8 courses × 6 sections
// each = 1.6M raw combinations) freezing the tab — NOT the "artificial cap
// on results shown" the scheduler is explicitly built to avoid. Generation
// still explores/returns far more than the old ~10-result limit; these only
// guard against genuinely runaway input, and the UI says so explicitly
// rather than truncating silently.
export const MAX_EXPLORED = 200_000;
export const MAX_RESULTS = 2_000;

// draftCourses: [{ courseKey, considering: sectionId[] }]. sectionsById:
// { sectionId: sectionDoc }. Backtracks course-by-course (rather than
// building the full cartesian product then filtering) so a conflict prunes
// an entire branch early instead of being discovered after the fact.
// Courses with an empty `considering` list are skipped entirely — callers
// should gate the "Generate" action on every draft course having at least
// one section selected instead, so an accidental all-courses schedule
// silently missing one course never happens.
export function generateSchedules(draftCourses, sectionsById) {
  const lists = draftCourses
    .filter((c) => c.considering.length > 0)
    .map((c) => c.considering);

  const schedules = [];
  let explored = 0;
  let truncated = false;

  function backtrack(i, chosen) {
    if (i === lists.length) {
      schedules.push([...chosen]);
      if (schedules.length >= MAX_RESULTS) truncated = true;
      return;
    }
    for (const sectionId of lists[i]) {
      if (truncated) return;
      explored++;
      if (explored > MAX_EXPLORED) {
        truncated = true;
        return;
      }
      const candidate = sectionsById[sectionId];
      if (!candidate) continue;
      const conflicts = chosen.some((id) => sectionsConflict(sectionsById[id], candidate));
      if (conflicts) continue;
      chosen.push(sectionId);
      backtrack(i + 1, chosen);
      chosen.pop();
    }
  }

  if (lists.length > 0) backtrack(0, []);

  return { schedules, truncated };
}

// Sum of `credits` across a set of sectionIds — used for the generated-combo
// summary and the grid/save panel's credit total.
export function totalCredits(sectionIds, sectionsById) {
  return sectionIds.reduce((sum, id) => sum + (sectionsById[id]?.credits ?? 0), 0);
}
