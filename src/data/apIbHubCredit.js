// AP / IB → BU Hub credit eligibility
//
// Source: BU Advanced Credit Guide 2025-2026
//   https://www.bu.edu/admissions/files/2018/06/Advanced-Credit-Guide.pdf
// Source: BU International Baccalaureate Guide 2024-2025
//   https://www.bu.edu/admissions/files/2018/05/ib_course_equivalence.pdf
// (Reference copies also saved to docs/reference/ in this repo.)
//
// IMPORTANT POLICY, straight from the Advanced Credit Guide:
// "Courses taken through other universities do not meet BU Hub
// requirements, even if they are equated to a BU course that carries
// one or more Hub unit(s)."
// => Transfer credit (type: 'transfer') NEVER earns HUB. Full stop.
//    Do not run transfer credit through this file at all.
//
// AP credit is HUB-eligible only for specific exams, per BU's chart —
// several exams are explicitly HUB-ineligible (empty hub: []), even
// though they still earn elective/BU credit. Don't infer HUB from the
// mapped BU course's normal `hubUnits` field — several exams are N/A
// for HUB despite mapping to a course that normally carries HUB units
// for regularly-enrolled students.
//
// IB credit only applies to Higher Level exams scored 5, 6, or 7.

// ---------------------------------------------------------------------
// AP
// ---------------------------------------------------------------------

// Canonical exam name (normalized, see normalize() below) -> HUB result.
// Most exams give the same HUB unit(s) regardless of score (4 vs 5 only
// changes credit hours). A few give a different HUB combo per score —
// those use `byScore` instead of `hub`.
export const AP_HUB_CREDIT = {
  'art history': { hub: [] },
  'african american studies': { hub: [] },
  biology: { byScore: { 4: ['SI1'], 5: ['SI1', 'SI2'] } },
  'calculus ab': { hub: ['QR2'] },
  'calculus bc': { hub: ['QR2'] },
  chemistry: { hub: ['SI1'] },
  'chinese language and culture': { hub: ['GCI'] },
  'computer science a': { hub: ['QR2'] },
  'computer science principles': { hub: ['QR1'] },
  macroeconomics: { hub: ['SO1'] },
  microeconomics: { hub: ['SO1'] },
  'english language and composition': { hub: [] },
  'english literature and composition': { hub: [] },
  'environmental science': { hub: ['SO1'] }, // as printed in BU's chart — not SI1
  'european history': { hub: [] },
  'french language and culture': { hub: ['GCI'] },
  'german language and culture': { hub: ['GCI'] },
  'comparative government and politics': { hub: ['SO1'] },
  'united states government and politics': { hub: ['SO1'] },
  'human geography': { hub: ['SO1'] },
  'italian language and culture': { hub: ['GCI'] },
  'japanese language and culture': { hub: ['GCI'] },
  latin: { hub: [] },
  'music theory': { hub: ['AEX'] },
  'physics 1': { hub: ['SI1'] },
  'physics 2': { hub: ['SI2'] },
  'physics c mechanics': { hub: ['SI1'] },
  'physics c electricity and magnetism': { hub: ['SI2'] },
  psychology: { hub: ['SO1'] },
  'spanish language and culture': { hub: ['GCI'] },
  'spanish literature and culture': { hub: ['GCI'] },
  statistics: { hub: ['QR2'] },
  'united states history': { hub: [] },
};

// Raw "Test Subject" text as it may actually appear on a BU transcript ->
// canonical key above, for the rare cases the fuzzy word-matching below
// can't handle on its own (e.g. "Macroeconomics" as one fused word vs.
// "Economics: Macro" as two separate words).
export const AP_ALIASES = {
  'economics macro': 'macroeconomics',
  'economics micro': 'microeconomics',
};

// Canonical exam subjects a student can pick from (e.g. for a manual
// "add external credit" form) — kept as the single source of truth so a
// picker never drifts out of sync with what getApHub() can actually
// resolve. Each key here is already normalize()-safe: passing it straight
// back into getApHub()/isApScoreDependent() as `rawSubject` matches exactly.
export const AP_EXAM_SUBJECTS = Object.keys(AP_HUB_CREDIT);

// ---------------------------------------------------------------------
// IB (Higher Level only, score 5-7)
// ---------------------------------------------------------------------

export const IB_HUB_CREDIT = {
  'art history': { hub: ['AEX', 'HCO'] },
  biology: { hub: ['SI1', 'SI2'] },
  chemistry: { hub: ['SI1', 'QR1'] },
  'classical studies greek': { hub: ['AEX'] },
  'classical studies latin': { hub: ['AEX'] },
  'computer science': { hub: ['QR2'] },
  economics: { hub: ['SO1'] },
  // "English A: Literature" (earns credit) — do NOT confuse with
  // "English A: Language and Literature" (IB_NO_CREDIT, below)
  'english language a literature': { hub: ['AEX'] },
  geography: { hub: ['SI1', 'SO1'] },
  'global politics': { hub: ['GCI'] },
  'history africa and the middle east': { hub: ['HCO'] },
  'history europe': { hub: ['HCO'] },
  'history the americas': { hub: ['HCO'] },
  'history asia and oceania': { hub: ['HCO'] },
  'language arabic': { hub: ['IIC', 'GCI'] },
  'language chinese': { hub: ['IIC', 'GCI'] },
  'language mandarin': { hub: ['IIC', 'GCI'] },
  'language french': { hub: ['IIC', 'GCI'] },
  'language german': { hub: ['IIC', 'GCI'] },
  'language italian': { hub: ['IIC', 'GCI'] },
  'language japanese': { hub: ['IIC', 'GCI'] },
  'language korean': { hub: ['IIC', 'GCI'] },
  'language portuguese': { hub: ['IIC', 'GCI'] },
  'language russian': { hub: ['IIC', 'GCI'] },
  'language spanish': { hub: ['IIC', 'GCI'] },
  'language turkish': { hub: ['IIC', 'GCI'] },
  'mathematics analysis': { hub: ['QR2'] },
  'mathematics applications and interpretation': { hub: ['QR2'] },
  philosophy: { hub: ['PLM'] },
  physics: { hub: ['SI1', 'SI2'] }, // "Physics 1 & 2"
  psychology: { hub: ['SO1'] },
  'social cultural anthropology': { hub: ['SO1'] },
  'theatre arts': { hub: [] },
};

// Canonical IB exam subjects a student can pick from — see AP_EXAM_SUBJECTS
// above for why this is exported rather than re-listed elsewhere. Subjects
// in IB_NO_CREDIT are deliberately excluded: they should never be
// selectable in a picker in the first place.
export const IB_EXAM_SUBJECTS = Object.keys(IB_HUB_CREDIT);

// IB subjects with NO credit at all (not just no HUB) — if one of these
// is ever encountered, do not create an external-credit entry for it,
// don't just zero out its HUB units.
export const IB_NO_CREDIT = [
  'english a language and literature',
  'art design',
  'business and management',
  'music',
  'visual arts',
  'itgs',
  'design technology',
  'dance',
  'film',
];

// ---------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------

function normalize(str) {
  let s = String(str || '')
    .toLowerCase()
    .replace(/^ap\s+/, '')
    .replace(/^ib\s+/, '')
    .replace(/[.:\-–—&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // known real-world abbreviations/synonyms, applied as whole-word swaps
  // BEFORE word-set matching, so e.g. "U.S." and "American" both line up
  // with the "united states" wording used in the table keys.
  s = s.replace(/\bu s\b/g, 'united states');
  s = s.replace(/\bus\b/g, 'united states');
  s = s.replace(/\bamerican\b/g, 'united states');
  s = s.replace(/\bcompostn\b/g, 'composition');
  return s;
}

// Words to ignore when comparing word sets — filler words that some
// transcripts include and others drop, which shouldn't block a match.
const STOPWORDS = new Set(['and']);

function wordSet(phrase) {
  return new Set(phrase.split(' ').filter((w) => w && !STOPWORDS.has(w)));
}

function isSubset(a, b) {
  for (const w of a) if (!b.has(w)) return false;
  return true;
}

/**
 * Match a normalized subject string against a lookup table's keys.
 * Real transcripts abbreviate, reorder, and drop words inconsistently
 * (e.g. "AP Spanish Language" vs. the College Board's full "Spanish
 * Language and Culture") — matching on exact strings meant a new alias
 * was needed every time a new variant showed up. Instead, this matches
 * on word sets: if one side's meaningful words are entirely contained in
 * the other's, it's a match, regardless of order or missing filler words.
 * If more than one key matches with no clear best fit, this returns null
 * rather than guessing — genuine ambiguity should go to manual review,
 * not get silently resolved to the wrong exam.
 * @returns {string|null} the matched canonical key, or null if none/ambiguous
 */
function fuzzyMatchKey(normalizedInput, table, aliases) {
  if (aliases && aliases[normalizedInput]) return aliases[normalizedInput];
  if (table[normalizedInput]) return normalizedInput;
  const inputWords = wordSet(normalizedInput);
  const candidates = [];
  for (const key of Object.keys(table)) {
    const keyWords = wordSet(key);
    if (isSubset(keyWords, inputWords) || isSubset(inputWords, keyWords)) {
      candidates.push({ key, overlap: keyWords.size + inputWords.size });
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].key;
  candidates.sort((a, b) => b.overlap - a.overlap);
  if (candidates[0].overlap > candidates[1].overlap) return candidates[0].key;
  return null; // genuinely ambiguous — don't guess, flag for review
}

/**
 * Check whether an AP exam's HUB result actually depends on the score.
 * Use this to decide whether to show a score picker at all — most AP
 * exams have a fixed HUB result regardless of score (4 vs 5 only changes
 * credit hours, not HUB eligibility), so don't ask for a score unless
 * this returns true.
 * @param {string} rawSubject
 * @returns {boolean}
 */
export function isApScoreDependent(rawSubject) {
  const key = fuzzyMatchKey(normalize(rawSubject), AP_HUB_CREDIT, AP_ALIASES);
  const entry = key ? AP_HUB_CREDIT[key] : null;
  return Boolean(entry && entry.byScore);
}

/**
 * Look up HUB units granted for an AP exam.
 * @param {string} rawSubject - as printed on the transcript, e.g. "AP Biology"
 * @param {number} [score] - required only for score-dependent exams (currently just Biology)
 * @returns {string[]|null} HUB unit codes (may be empty array = no HUB),
 *   or null if the exam is unrecognized / score is required but missing —
 *   callers should treat null as "flag for manual review", not "no HUB".
 */
export function getApHub(rawSubject, score) {
  const key = fuzzyMatchKey(normalize(rawSubject), AP_HUB_CREDIT, AP_ALIASES);
  if (!key) return null;
  const entry = AP_HUB_CREDIT[key];
  if (entry.byScore) {
    if (score == null) return null;
    return entry.byScore[score] ?? [];
  }
  return entry.hub;
}

/**
 * Look up HUB units granted for an IB exam.
 * @param {string} rawSubject
 * @param {number} [score] - IB only awards credit at 5, 6, or 7
 * @param {boolean} [isHigherLevel] - IB only awards credit for HL, never SL
 * @returns {string[]|null} HUB unit codes (may be empty array = no HUB),
 *   or null if unresolvable (unknown subject, or HL/score not confidently
 *   parsed from the transcript) — treat null as "flag for manual review".
 */
export function getIbHub(rawSubject, score, isHigherLevel) {
  const normalized = normalize(rawSubject);
  const noCreditTable = Object.fromEntries(IB_NO_CREDIT.map((k) => [k, true]));
  if (fuzzyMatchKey(normalized, noCreditTable, null)) return []; // caller should also skip creating an entry at all, not just zero the HUB
  if (isHigherLevel === false) return [];
  if (score != null && score < 5) return [];
  if (isHigherLevel == null || score == null) return null;
  const key = fuzzyMatchKey(normalized, IB_HUB_CREDIT, null);
  if (!key) return null;
  return IB_HUB_CREDIT[key].hub;
}