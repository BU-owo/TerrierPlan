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
// canonical key above. BU's own transcript printout doesn't always match
// College Board's exact exam names (e.g. "AP Mathematics: Calculus AB").
// Add to this list as new real-world variants show up.
export const AP_ALIASES = {
  'mathematics calculus ab': 'calculus ab',
  'mathematics calculus bc': 'calculus bc',
  'economics macro': 'macroeconomics',
  'economics micro': 'microeconomics',
  'government and politics united states': 'united states government and politics',
  'government and politics comparative': 'comparative government and politics',
  'physics c mechanics': 'physics c mechanics',
  'physics c electricity and magnetism': 'physics c electricity and magnetism',
  'u s history': 'united states history',
  'us history': 'united states history',
  'u s government and politics': 'united states government and politics',
  'us government and politics': 'united states government and politics',
  'united states government & politics': 'united states government and politics',
  'english literature compostn': 'english literature and composition',
  'english language compostn': 'english language and composition',
};

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
  return String(str || '')
    .toLowerCase()
    .replace(/^ap\s+/, '')
    .replace(/^ib\s+/, '')
    .replace(/[.:\-–—&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const normalized = normalize(rawSubject);
  const key = AP_ALIASES[normalized] || normalized;
  const entry = AP_HUB_CREDIT[key];
  if (!entry) return null;
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
  const key = normalize(rawSubject);
  if (IB_NO_CREDIT.includes(key)) return []; // caller should also skip creating an entry at all, not just zero the HUB
  if (isHigherLevel === false) return [];
  if (score != null && score < 5) return [];
  if (isHigherLevel == null || score == null) return null;
  const entry = IB_HUB_CREDIT[key];
  if (!entry) return null;
  return entry.hub;
}