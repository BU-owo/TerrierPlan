import { createContext } from 'react';

// What the planner hands down so the Marine Semester pieces (the term header
// menu, the requirements card) can act on the plan
// without threading a handler through every list. PlannerPage provides it;
// the defaults make every consumer a no-op when it isn't there.
//   hasTerm / slots  — the plan has a Marine Semester term / how many course
//                      slots it still holds
//   onOpenCreatePicker()     — pick an empty Fall, then create it there
//   onAddCourse(courseKey)   — add a Marine course to the plan's Marine term
//                              (or pick an empty Fall to start one)
//   onMoveTerm(fromTarget)   — pick another Fall to move the whole term to
//   onRemoveTerm(target)     — remove the marker and placeholders
export const MarineSemesterContext = createContext({
  hasTerm: false,
  slots: 0,
  onOpenCreatePicker: null,
  onAddCourse: null,
  onMoveTerm: null,
  onRemoveTerm: null,
});
