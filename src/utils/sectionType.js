import { classifyComponent } from './sectionComponents.js';

// The type of a section ("Lecture", "Discussion Section", "Laboratory", ...) as a
// fixed 3-letter code for tight spots, plus the full label the picker shows.
// BU's `component` codes are already 3 letters, so the code is used as is,
// except where it isn't the obvious abbreviation. A code that isn't short falls
// back to a label map, then to the first three letters.
const CODE_OVERRIDES = { PLB: 'PRE', SML: 'SEM' };
const LABEL_ABBR = {
  lecture: 'LEC',
  'discussion section': 'DIS',
  laboratory: 'LAB',
  'pre-lab section': 'PRE',
  seminar: 'SEM',
  recitation: 'REC',
  studio: 'STU',
  'independent course': 'IND',
  other: 'OTH',
};

// { abbr, full } for a section. `full` is the label as the picker's headings
// show it ("Discussion Section"); a blank component is "Other".
export function sectionTypeLabel(section) {
  const key = classifyComponent(section);
  const blank = key === '__unknown__';
  const code = blank ? '' : key.toUpperCase();
  const full = blank ? 'Other' : (section?.componentLabel?.trim() || key);
  let abbr;
  if (CODE_OVERRIDES[code]) abbr = CODE_OVERRIDES[code];
  else if (code && code.length <= 3) abbr = code;
  else abbr = LABEL_ABBR[full.toLowerCase()] || full.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'OTH';
  return { abbr: abbr.padEnd(3, 'X').slice(0, 3), full };
}

// "LEC A1" — the type and section code, for lists and tooltips.
export function describeTypeAndSection(section) {
  return `${sectionTypeLabel(section).abbr} ${section?.classSection ?? ''}`.trim();
}

// "CAS CH 110 LEC A1" — a section named in a list.
export function describeSectionName(section, courseLabel) {
  return `${courseLabel} ${describeTypeAndSection(section)}`.trim();
}

// "CAS CH 110" -> "CH 110": without the school prefix, for narrow spots.
export function shortCourseCode(courseCode) {
  return String(courseCode).replace(/^[A-Z]{2,4}\s+(?=\S+\s+\S+)/, '');
}

// "K. Bravaya, M. Reis", or "" when there are none listed.
export function describeInstructors(section) {
  return (section?.instructors || [])
    .map((i) => `${i.first ? `${i.first[0]}. ` : ''}${i.last}`.trim())
    .filter(Boolean)
    .join(', ');
}
