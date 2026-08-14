import { sectionsConflict } from './sectionTime';
import { classifyComponent, groupSectionsByComponent } from './sectionComponents';

// Safety valves against a pathological input (e.g. 8 courses × 6 sections
// each = 1.6M raw combinations) freezing the tab — NOT the "artificial cap
// on results shown" the scheduler is explicitly built to avoid. Generation
// still explores/returns far more than the old ~10-result limit; these only
// guard against genuinely runaway input, and the UI says so explicitly
// rather than truncating silently.
export const MAX_EXPLORED = 200_000;
export const MAX_RESULTS = 2_000;

// slots: [{ options: sectionId[] }] — a generic "pick exactly one from each
// slot, with no time conflict against anything else picked" combinatorics
// core. It has no notion of "course" or "component"; see
// buildGenerationSlots below for how draftCourses become slots. Backtracks
// slot-by-slot (rather than building the full cartesian product then
// filtering) so a conflict prunes an entire branch early instead of being
// discovered after the fact.
export function generateSchedules(slots, sectionsById) {
  const lists = slots.filter((s) => s.options.length > 0).map((s) => s.options);

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

// draftCourses: [{ courseKey, considering: { lecture: sectionId[],
// companion: sectionId[] }, locked: sectionId[] }]. Turns that per-course
// state into flat generation slots — one slot per required component.
//
// `locked` deliberately has no size limit and isn't scoped to "one per
// component": a course that genuinely needs two simultaneous companion
// pieces (e.g. MA 213's separately-required discussion AND lab, both
// Non-Enroll) is handled by letting the student lock both — each locked
// section becomes its OWN forced single-option slot, so any number of
// locks within the same component all survive into every generated
// schedule together, rather than being treated as alternatives to each
// other. An unlocked component's checked alternatives become one ordinary
// "pick one" slot.
export function buildGenerationSlots(draftCourses, sectionsByCourse, sectionsById) {
  const slots = [];
  for (const course of draftCourses) {
    const sections = sectionsByCourse[course.courseKey] || [];
    const groups = groupSectionsByComponent(sections);
    const lockedByGroup = {};
    for (const id of course.locked) {
      const key = classifyComponent(sectionsById[id]);
      (lockedByGroup[key] ??= []).push(id);
    }
    for (const group of groups) {
      const locked = lockedByGroup[group.key] || [];
      if (locked.length > 0) {
        locked.forEach((id) => slots.push({ options: [id] }));
      } else {
        const considering = course.considering[group.key] || [];
        if (considering.length > 0) slots.push({ options: considering });
      }
    }
  }
  return slots;
}

// A course is ready to generate once every component it actually has
// sections for (Lecture, and Discussion/Lab if the course has any
// Non-Enroll sections) has at least one locked or considered option.
export function isCourseReady(course, sections, sectionsById) {
  const groups = groupSectionsByComponent(sections);
  if (groups.length === 0) return false;
  return groups.every((group) => {
    const lockedInGroup = course.locked.some((id) => classifyComponent(sectionsById[id]) === group.key);
    return lockedInGroup || (course.considering[group.key]?.length ?? 0) > 0;
  });
}

// Sum of `credits` across a set of sectionIds. BU's export repeats the same
// Credit Hours value on every companion row of a course (a 4-credit
// course's discussion/lab section also shows "4.0"), so summing every
// section naively double-counts once a schedule can include more than one
// section per course — dedupe by courseKey first.
export function totalCredits(sectionIds, sectionsById) {
  const creditsByCourse = {};
  for (const id of sectionIds) {
    const section = sectionsById[id];
    if (!section) continue;
    const credits = section.credits ?? 0;
    if (!(section.courseKey in creditsByCourse) || credits > creditsByCourse[section.courseKey]) {
      creditsByCourse[section.courseKey] = credits;
    }
  }
  return Object.values(creditsByCourse).reduce((sum, c) => sum + c, 0);
}
