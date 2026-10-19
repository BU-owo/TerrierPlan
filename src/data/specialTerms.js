// Special terms: a whole term a program places a student into. Today only
// the Marine Semester. A Marine Semester term is NOT a card: it is a marker
// note (blockType 'marine', 0 credits) plus plain placeholders, and any
// course tagged ONLY in src/data/marineSemester.js also makes a Fall term
// one (see isMarineTerm in src/utils/courseEntry.js). Keyed by blockType.
//   label             — the marker's text, the header badge, the toasts
//   placeholderLabel  — text of each placeholder a fresh term starts with
//   placeholderCredits — credits of each of those placeholders
//   slots             — course slots in the term (marker + this many placeholders)
//   seasons           — terms it can live in ('fall' | 'spring' | 'summer')
export const SPECIAL_TERMS = {
  marine: {
    id: 'marine',
    label: 'Marine Semester',
    placeholderLabel: 'Marine Semester course',
    placeholderCredits: 4,
    slots: 4,
    seasons: ['fall'],
  },
};

// The registry entry for a blockType, or null for an unknown one (an
// unknown blockType is kept and shown as a generic "Special term").
export function getSpecialTerm(blockType) {
  return typeof blockType === 'string' && Object.prototype.hasOwnProperty.call(SPECIAL_TERMS, blockType)
    ? SPECIAL_TERMS[blockType]
    : null;
}

// Toast text per placement outcome (see placeCourse in courseEntry.js): the
// four refusals, plus the neutral confirmations — a course added to a Marine
// Semester, and a Marine Semester created (with how many plain placeholders
// it replaced, when any).
export const MARINE_MESSAGES = {
  'not-fall': () => 'Marine Semester courses are only offered in the fall.',
  'non-empty-fall': () => 'This term already has other courses. The Marine Semester fills the whole term, so use an empty Fall.',
  full: () => 'Your Marine Semester is full (4 courses).',
  'untagged-in-marine': () => 'The Marine Semester fills the whole term.',
  added: () => 'Added to your Marine Semester',
  created: (termLabel, replaced = 0) => {
    const base = termLabel ? `Marine Semester created in ${termLabel}` : 'Marine Semester created';
    return replaced > 0 ? `${base}; replaced ${replaced} placeholder${replaced === 1 ? '' : 's'}` : base;
  },
};

// Refusals are shown in the dark notice style; confirmations in a neutral one.
export const CONFIRMATION_REASONS = ['added', 'created'];

// The toast text for a placement outcome reason, or null for an unknown one.
export function placementMessage(reason, termLabel, replaced) {
  const message = Object.prototype.hasOwnProperty.call(MARINE_MESSAGES, reason) ? MARINE_MESSAGES[reason] : null;
  return message ? message(termLabel, replaced) : null;
}
