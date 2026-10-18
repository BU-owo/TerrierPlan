// Special terms: a whole term a program places a student into, stored in the
// plan as a "block" entry (a placeholder plus `blockType` — see isBlockEntry
// in src/utils/courseEntry.js). Keyed by blockType. The planner reads
// everything about a special term from here, so adding one is one entry.
//   seasons      — terms it can be added to ('fall' | 'spring' | 'summer')
//   credits      — what the block counts for in every credit total
//   courseCount  — how many courses it stands for (shown on the card)
//   exclusive    — the term holds nothing else: new adds and drops are refused
//   maxPerPlan   — at most this many blocks of this type in one plan
// Open to anyone admitted, so nothing here depends on the plan's major.
export const SPECIAL_TERMS = {
  marine: {
    id: 'marine',
    label: 'Marine Semester',
    seasons: ['fall'],
    credits: 16,
    courseCount: 4,
    exclusive: true,
    maxPerPlan: 1,
    helperText: "BU Marine Program places you in four month-long courses, so there's nothing to pick here.",
    admissionNote: 'Requires admission to the Marine Semester.',
  },
};

// The registry entry for a blockType, or null for an unknown one (an
// unknown blockType is kept and shown as a generic "Special term").
export function getSpecialTerm(blockType) {
  return typeof blockType === 'string' && Object.prototype.hasOwnProperty.call(SPECIAL_TERMS, blockType)
    ? SPECIAL_TERMS[blockType]
    : null;
}

// The toast shown when an add or drop into an exclusive term is refused.
export function exclusiveTermMessage(term) {
  return `The ${term.label} fills the whole term.`;
}
