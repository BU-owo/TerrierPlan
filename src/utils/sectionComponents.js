// Which "piece" of a course a section represents — sourced directly from
// BU's `component` field (raw PeopleSoft codes: "LEC", "DIS", "LAB", "SML",
// "PLB" (pre-lab), etc. — see import-sections.cjs and SCHEMA.md). This
// replaced an earlier version of this file that only had `classType`
// ("Enrollment" vs "Non-Enroll") to go on and had to lump every companion
// piece into one undifferentiated "Discussion / Lab" pool, unable to tell
// a discussion from a lab from a pre-lab — now that `component` exists, a
// course with distinct LEC + DIS + LAB sections gets three distinct
// groups, each genuinely required, instead of one pool the student had to
// manually multi-lock to get right.
//
// A blank `component` (sections imported before schedule_with_types.csv
// existed, or roster-less cancelled-class rows) falls into its own single
// "Other" group per course rather than being dropped or crashing.
const UNKNOWN_KEY = '__unknown__';

export function classifyComponent(section) {
  return section?.component?.trim() || UNKNOWN_KEY;
}

function labelForGroup(key, groupSections) {
  if (key === UNKNOWN_KEY) return 'Other';
  const withLabel = groupSections.find((s) => s.componentLabel?.trim());
  return withLabel?.componentLabel?.trim() || key;
}

function hintForGroup(group, index, groups) {
  if (group.key === UNKNOWN_KEY) {
    return "This term's data doesn't list a section type for these — check the notes below, and pick or lock whichever applies to you.";
  }
  if (index === 0) {
    return `Pick the ${group.label.toLowerCase()} you plan to attend.`;
  }
  const primary = groups[0];
  const primaryLabel = primary.key === UNKNOWN_KEY ? 'section above' : `${primary.label.toLowerCase()} above`;
  return `Required alongside the ${primaryLabel} — pick one section from this group.`;
}

// Groups a course's sections by distinct `component` code, sorted within
// each group by `comparator`. Group order: the "LEC" (lecture) group first
// if present, then the rest alphabetically by label, with the blank-
// component "Other" group always last (least meaningful, pure fallback).
// When every section in a group shares one identical, non-empty `notes`
// string, it's hoisted to `commonNotes` so it can be shown once instead of
// repeated per row.
export function groupSectionsByComponent(sections, comparator) {
  const byKey = new Map();
  for (const section of sections) {
    const key = classifyComponent(section);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(section);
  }

  const groups = [...byKey.entries()].map(([key, groupSections]) => {
    if (comparator) groupSections.sort(comparator);
    const notesSet = new Set(groupSections.map((s) => (s.notes || '').trim()).filter(Boolean));
    return {
      key,
      label: labelForGroup(key, groupSections),
      sections: groupSections,
      commonNotes: notesSet.size === 1 ? [...notesSet][0] : null,
    };
  });

  groups.sort((a, b) => {
    if (a.key === 'LEC') return -1;
    if (b.key === 'LEC') return 1;
    if (a.key === UNKNOWN_KEY) return 1;
    if (b.key === UNKNOWN_KEY) return -1;
    return a.label.localeCompare(b.label);
  });

  groups.forEach((group, index) => {
    group.hint = hintForGroup(group, index, groups);
  });

  return groups;
}
