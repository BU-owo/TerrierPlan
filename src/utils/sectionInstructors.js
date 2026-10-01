// "T. Januario, D. Sullivan" for a `sections` doc's instructors array
// ({first, last}[]); "Staff" when none are listed. Same output as the inline
// logic in SectionRow.jsx, copied here so read-only displays (the course info
// panel) can share it without touching the scheduler's component.
export function instructorLabel(section) {
  return section.instructors?.length
    ? section.instructors.map((i) => `${i.first ? i.first[0] + '. ' : ''}${i.last}`.trim()).join(', ')
    : 'Staff';
}
