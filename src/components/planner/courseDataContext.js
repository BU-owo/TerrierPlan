import { createContext } from 'react';

// Where the planner's course-doc lookups (PlannerPage's fetchCourseData) stand,
// for cards still waiting on their courseMap entry:
//   fetching     a lookup is in flight (a card without data shows a small paw)
//   unavailable  Set of courseKeys a finished lookup came back without (no
//                such doc, served empty while offline, or the read failed);
//                those cards say "Details unavailable" instead of waiting
// Default (no provider): nothing in flight, nothing unavailable.
export const CourseDataStatusContext = createContext({ fetching: false, unavailable: new Set() });
