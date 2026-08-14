import { sectionMeeting, parse24HourTimeToMinutes } from './sectionTime';

// Two independent filter layers for the section picker: one global time
// range (applies to every course in the draft at once) and each course's
// own time range + professor filter. A section only shows if it passes
// BOTH. Shared between DraftCourseCard (which sections to actually
// render) and SchedulerPage (the "why is Generate disabled" blocker list,
// which needs to tell "hidden by a filter" apart from "never picked" —
// see filterBlockDetail below) so the two never drift out of sync on what
// "passes the filter" means.
export const EMPTY_COURSE_FILTERS = { startTime: '', endTime: '', professor: '' };
export const EMPTY_GLOBAL_FILTERS = { startTime: '', endTime: '' };

function passesTimeBounds(section, startTime, endTime) {
  const startBound = parse24HourTimeToMinutes(startTime);
  const endBound = parse24HourTimeToMinutes(endTime);
  if (startBound == null && endBound == null) return true;
  const meeting = sectionMeeting(section);
  if (!meeting) return false; // no determinable time — can't match a time bound
  if (startBound != null && meeting.startMin < startBound) return false;
  if (endBound != null && meeting.startMin > endBound) return false;
  return true;
}

export function passesGlobalFilter(section, globalFilter) {
  return passesTimeBounds(section, globalFilter.startTime, globalFilter.endTime);
}

export function passesCourseFilter(section, courseFilter) {
  const professor = courseFilter.professor.trim();
  if (professor) {
    const names = (section.instructors || [])
      .map((i) => `${i.first || ''} ${i.last || ''}`)
      .join(' ')
      .toLowerCase();
    if (!names.includes(professor.toLowerCase())) return false;
  }
  return passesTimeBounds(section, courseFilter.startTime, courseFilter.endTime);
}

export function matchesFilters(section, courseFilter, globalFilter) {
  return passesGlobalFilter(section, globalFilter) && passesCourseFilter(section, courseFilter);
}

export function isGlobalFilterActive(globalFilter) {
  return Boolean(globalFilter.startTime || globalFilter.endTime);
}

export function isCourseFilterActive(courseFilter) {
  return Boolean(courseFilter.startTime || courseFilter.endTime || courseFilter.professor.trim());
}

// Which filter (if any) is the reason every section in a component group
// is currently hidden — 'global', 'course', 'both', or null (either
// something's still visible, or no filter is active at all, so a missing
// pick is genuinely just "never picked," not a filtering artifact). Used
// only for the blocker-list explanation; DraftCourseCard's own rendering
// just needs matchesFilters.
export function filterBlockDetail(groupSections, courseFilter, globalFilter) {
  if (!groupSections || groupSections.length === 0) return null;
  const anyVisible = groupSections.some((s) => matchesFilters(s, courseFilter, globalFilter));
  if (anyVisible) return null;

  const globalActive = isGlobalFilterActive(globalFilter);
  const courseActive = isCourseFilterActive(courseFilter);
  if (!globalActive && !courseActive) return null;
  if (!courseActive) return 'global';
  if (!globalActive) return 'course';

  // Both are active — figure out whether relaxing just one of them alone
  // would actually reveal something, to blame the specific filter(s)
  // responsible rather than a blanket "filtered."
  const passesCourseAlone = groupSections.some((s) => passesCourseFilter(s, courseFilter));
  const passesGlobalAlone = groupSections.some((s) => passesGlobalFilter(s, globalFilter));
  if (passesCourseAlone && !passesGlobalAlone) return 'global';
  if (passesGlobalAlone && !passesCourseAlone) return 'course';
  return 'both';
}
