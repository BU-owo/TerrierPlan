// Which "piece" of a course a section represents. BU's PeopleSoft export
// has no explicit Component field (Lecture/Discussion/Lab/Prelab) — only
// classType ("Enrollment" vs "Non-Enroll") and a classSection code ("A1",
// "B3", ...). We deliberately stop at that binary split: a course's
// classSection *letter* prefix looks like it might encode finer structure
// (e.g. MA 213's own notes: "a discussion section: B1-B6, and a lab
// section: C1-C4"), but it doesn't hold up catalog-wide — other courses
// use a fresh letter per *alternative* time slot for the exact same single
// requirement (e.g. AH 111 has 12 one-off discussion letters that are all
// interchangeable, not 12 separate mandatory pieces). There's no reliable
// way to tell those two patterns apart from the structured fields alone, so
// treating "distinct letter" as "distinct requirement" would silently force
// impossible schedules for courses like AH 111. Non-Enroll sections stay
// one pool; a course that genuinely needs more than one companion piece
// (both a discussion AND a lab) is handled by letting the student lock more
// than one section at once — see SchedulerPage's `locked` handling — after
// reading the section's own `notes`, which is the only authoritative source
// for exactly what's required.
const LECTURE = 'lecture';
const COMPANION = 'companion';

export function classifyComponent(section) {
  return section?.classType === 'Non-Enroll' ? COMPANION : LECTURE;
}

// Groups a course's sections into up to two buckets — Lecture (if any
// Enrollment sections exist) and Discussion/Lab (if any Non-Enroll sections
// exist) — sorted by `comparator` within each. When every section in a
// group shares one identical, non-empty `notes` string (the common case —
// BU repeats the same instruction on every companion row), it's hoisted to
// `commonNotes` on the group so it can be shown once instead of repeated
// per row.
export function groupSectionsByComponent(sections, comparator) {
  const byKey = { [LECTURE]: [], [COMPANION]: [] };
  for (const section of sections) {
    byKey[classifyComponent(section)].push(section);
  }

  const defs = [
    {
      key: LECTURE,
      label: 'Lecture',
      hint: 'Pick the lecture section you plan to attend.',
    },
    {
      key: COMPANION,
      label: 'Discussion / Lab',
      hint: "Tied to the lecture above. Most courses need just one of these — but some need more than one (e.g. a lab AND a discussion). Check the notes below, and lock every piece you're required to take.",
    },
  ];

  return defs
    .map((def) => {
      const groupSections = byKey[def.key];
      if (comparator) groupSections.sort(comparator);
      const notesSet = new Set(groupSections.map((s) => (s.notes || '').trim()).filter(Boolean));
      return {
        ...def,
        sections: groupSections,
        commonNotes: notesSet.size === 1 ? [...notesSet][0] : null,
      };
    })
    .filter((group) => group.sections.length > 0);
}
