import { classifyComponent } from './sectionComponents.js';

// The Global Time Filter unchecks the checked sections that fail it, and puts
// exactly those back when the filter loosens. `remembered` is the set of
// section ids that were unchecked by a filter (not by the student), kept apart
// from the student's own picks. Pure: callers supply how to find a section by id
// (`sectionOf`) and whether one passes the current filter (`passes`).
//
// - Tightening: every checked section that fails is unchecked and remembered.
//   Pinned sections are never touched.
// - Loosening or clearing: each remembered section that now passes is checked
//   again and forgotten. One that still fails stays remembered, so it comes back
//   when the filter loosens further. One whose course is gone is forgotten.
// A section the student toggles by hand while a filter is on is dropped from
// `remembered` by the caller and put in `exempt`, so it's never changed
// automatically again (until the filter is cleared).
//
// Returns { draftCourses, remembered }, the same objects when nothing changed.
export function applyFilterToPicks(draftCourses, remembered, sectionOf, passes, exempt = new Set()) {
  const nextRemembered = new Set(remembered);
  let changed = false;

  const courses = draftCourses.map((course) => {
    const locked = new Set(course.locked);
    let touched = false;
    const considering = {};
    for (const [group, ids] of Object.entries(course.considering)) {
      considering[group] = ids.filter((id) => {
        if (locked.has(id) || exempt.has(id)) return true;
        const section = sectionOf(id);
        if (!section || passes(section)) return true;
        nextRemembered.add(id);
        touched = true;
        return false;
      });
    }
    if (!touched) return course;
    changed = true;
    return { ...course, considering };
  });

  for (const id of remembered) {
    const section = sectionOf(id);
    const index = section ? courses.findIndex((c) => c.courseKey === section.courseKey) : -1;
    if (index === -1) {
      nextRemembered.delete(id);
      changed = true;
      continue;
    }
    if (!passes(section)) continue;
    nextRemembered.delete(id);
    changed = true;
    const group = classifyComponent(section);
    const course = courses[index];
    const current = course.considering[group] || [];
    if (!current.includes(id) && !course.locked.includes(id)) {
      courses[index] = { ...course, considering: { ...course.considering, [group]: [...current, id] } };
    }
  }

  return changed ? { draftCourses: courses, remembered: nextRemembered } : { draftCourses, remembered };
}
