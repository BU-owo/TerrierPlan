import { classifyComponent, groupSectionsByComponent } from './sectionComponents.js';

// Generation explores at most this many options (scheduleCombos.js's
// MAX_EXPLORED); a draft whose combination count is above it can be slow or
// stop early. Only used to warn — selecting is never blocked.
export const SLOW_GENERATION_PRODUCT = 200_000;

// How many schedules the draft could have, the way generation counts them: one
// slot per component group (its checked sections) and one single-option slot
// per pinned section, multiplied across the courses that are complete (the
// others aren't generated). `selectAllFor` pretends every section of that
// course is checked, to ask "what if the student selects everything here?".
// `passes(section)` (the Global Time Filter) limits the count to sections that
// pass it; without it every section counts.
export function combinationProduct(draftCourses, sectionsByCourse, selectAllFor = null, passes = null) {
  let product = 1;
  for (const course of draftCourses) {
    const sections = sectionsByCourse[course.courseKey] || [];
    if (sections.length === 0) continue;
    const everything = course.courseKey === selectAllFor;
    const locked = new Set(course.locked);
    const byId = new Map(sections.map((s) => [s.id, s]));
    const counts = (s) => !passes || passes(s);
    const lockedGroups = new Set(sections.filter((s) => locked.has(s.id)).map(classifyComponent));
    const slots = [];
    let complete = true;
    for (const group of groupSectionsByComponent(sections)) {
      if (lockedGroups.has(group.key)) continue; // pinned: single-option slots, factor 1
      const count = everything
        ? group.sections.filter(counts).length
        : (course.considering[group.key] || []).filter((id) => byId.has(id) && counts(byId.get(id))).length;
      if (count === 0) complete = false;
      else slots.push(count);
    }
    if (complete) for (const n of slots) product *= n;
  }
  return product;
}
