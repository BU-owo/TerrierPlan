import { sectionsConflict } from './sectionTime.js';
import { classifyComponent } from './sectionComponents.js';

// Manual mode: which placed sections would `candidate` overlap? Only the
// OTHER (course, component) groups count — picking the candidate replaces
// whatever is placed in its own group. Uses sectionsConflict, so exam
// meetings and sections with no meetings never overlap.
export function placedOverlaps(candidate, placed) {
  return placed.filter((p) => !(p.courseKey === candidate.courseKey && classifyComponent(p) === classifyComponent(candidate))
    && sectionsConflict(p, candidate));
}

// "CS 112 Lecture", or "CS 112 Lecture +2" when it overlaps several.
// `nameOf` turns a placed section into its short name.
export function overlapTagText(overlaps, nameOf) {
  if (overlaps.length === 0) return '';
  const extra = overlaps.length - 1;
  return `${nameOf(overlaps[0])}${extra > 0 ? ` +${extra}` : ''}`;
}
