// AP / IB → BU Hub credit eligibility
//
// Source: BU Advanced Credit Guide 2026-2027
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
//
// Every entry (AP flat or per-score, IB) also carries `credits` and either
// a single confident BU course — `courseKey` (one course) or `courses`
// (an array, for exams that require a specific multi-course sequence) —
// or a `courseNote` describing why no single course can be asserted
// (the source lists multiple options with "or", the second course in a
// sequence is an unnumbered "topics" placeholder, or there's no fixed
// equivalent at all). Never fabricate a courseKey out of an "or" list or
// a TR placeholder — use courseNote instead so callers know to show a
// human-readable note rather than a course chip.

// ---------------------------------------------------------------------
// AP
// ---------------------------------------------------------------------

// Canonical exam name (normalized, see normalize() below) -> HUB result
// (+ credits + course info, see file header). Most exams give the same
// HUB unit(s)/credits/course regardless of score (4 vs 5 only changes
// credit hours for a handful). Exams where hub, credits, or the mapped
// course actually differ by score use `byScore` instead of the flat
// hub/credits/course fields — each byScore[score] carries its own
// hub/credits/courseKey|courses|courseNote, same shape as a flat entry.
export const AP_HUB_CREDIT = {
  'art history': { hub: [], credits: 4, courseNote: 'CAS AH 1TR (elective; specific section varies)' },
  'african american studies': { hub: [], credits: 4, courseNote: 'No fixed BU course equivalent (elective credit only)' },
  biology: {
    byScore: {
      4: { hub: ['SI1'], credits: 4, courseNote: 'CAS BI 105, BI 107, or BI 108 (advisor determines exact course)' },
      5: { hub: ['SI1', 'SI2'], credits: 8, courseNote: 'CAS BI 107 & 108, BI 105 & 107, or BI 1TR & 108 (advisor determines exact pairing)' },
    },
  },
  'calculus ab': { hub: ['QR2'], credits: 4, courseKey: 'CASMA123' },
  // BU's real rule for AP Calc BC scores 1-3 depends on the AB subscore
  // (main score 1-3 + subscore 4/5 => 4 credits; no qualifying subscore
  // => 0 credits) — a field this app has no way to collect. Scores 1-3
  // are deliberately left unmodeled here rather than guessed at; the
  // score picker in the UI derives its options from these byScore keys,
  // so it only ever offers 4 and 5 for this exam.
  'calculus bc': {
    byScore: {
      4: { hub: ['QR2'], credits: 8, courses: ['CASMA123', 'CASMA124'] },
      5: { hub: ['QR2'], credits: 8, courses: ['CASMA123', 'CASMA124'] },
    },
  },
  chemistry: { hub: ['SI1'], credits: 4, courseKey: 'CASCH131' },
  'chinese language and culture': { hub: ['GCI'], credits: 4, courseNote: 'CAS LC 212 at score 4, or CAS LC 311 at score 5' },
  'computer science a': { hub: ['QR2'], credits: 4, courseKey: 'CASCS111' },
  'computer science principles': { hub: ['QR1'], credits: 4, courseNote: 'CAS CS 101 or CDS DS 100' },
  macroeconomics: { hub: ['SO1'], credits: 4, courseKey: 'CASEC102' },
  microeconomics: { hub: ['SO1'], credits: 4, courseKey: 'CASEC101' },
  'english language and composition': { hub: [], credits: 4, courseNote: 'No fixed BU course equivalent (elective credit only)' },
  'english literature and composition': { hub: [], credits: 4, courseKey: 'CASEN100' },
  'environmental science': { hub: ['SO1'], credits: 4, courseKey: 'CASEE100' }, // as printed in BU's chart — not SI1
  'european history': { hub: [], credits: 4, courseNote: 'No fixed BU course equivalent (elective credit only)' },
  'french language and culture': { hub: ['GCI'], credits: 4, courseNote: 'CAS LF 212 at score 4, or an advisor-approved CAS LF 3xx course at score 5' },
  'german language and culture': { hub: ['GCI'], credits: 4, courseNote: 'CAS LG 212 at score 4, or an advisor-approved CAS LG 3xx course at score 5' },
  'comparative government and politics': { hub: ['SO1'], credits: 4, courseKey: 'CASPO151' },
  'united states government and politics': { hub: ['SO1'], credits: 4, courseKey: 'CASPO111' },
  'human geography': { hub: ['SO1'], credits: 4, courseKey: 'CASEE100' },
  'italian language and culture': { hub: ['GCI'], credits: 4, courseNote: 'CAS LI 212 at score 4, or an advisor-approved CAS LI 3xx course at score 5' },
  'japanese language and culture': { hub: ['GCI'], credits: 4, courseNote: 'CAS LJ 212 at score 4, or CAS LJ 303 at score 5' },
  // Score 4 maps to a single confident course; score 5 extends into an
  // advisor-approved CAS CL 3TR (topics) course with no fixed number, so
  // that half is a courseNote rather than a fabricated key.
  latin: {
    byScore: {
      4: { hub: [], credits: 4, courseKey: 'CASCL212' },
      5: { hub: [], credits: 8, courseNote: 'CAS CL 212, followed by an advisor-approved CAS CL 3TR (topics) course' },
    },
  },
  'music theory': { hub: ['AEX'], credits: 4, courseKey: 'CASMT105' },
  'physics 1': { hub: ['SI1'], credits: 4, courseKey: 'CASPY105' },
  'physics 2': { hub: ['SI2'], credits: 4, courseKey: 'CASPY106' },
  'physics c mechanics': { hub: ['SI1'], credits: 4, courseNote: 'CAS PY 211 or CAS PY 251' },
  'physics c electricity and magnetism': { hub: ['SI2'], credits: 4, courseNote: 'CAS PY 212 or CAS PY 252' },
  psychology: { hub: ['SO1'], credits: 4, courseKey: 'CASPS101' },
  'spanish language and culture': { hub: ['GCI'], credits: 4, courseNote: 'CAS LS 212 at score 4, or an advisor-approved CAS LS 3xx course at score 5' },
  'spanish literature and culture': { hub: ['GCI'], credits: 4, courseNote: 'CAS LS 212 at score 4, or CAS LS 307 at score 5' },
  statistics: { hub: ['QR2'], credits: 4, courseKey: 'CASMA115' },
  'united states history': { hub: [], credits: 4, courseNote: 'No fixed BU course equivalent (elective credit only)' },
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

// Every IB exam awards a flat 8 credits and requires HL + score >= 5 (see
// getIbHub/getIbCredits/getIbCourseInfo below) — no byScore nesting needed
// here the way AP has it, since score only ever gates on/off, it doesn't
// change which course(s) apply. `courses` lists every BU course required
// (BU's IB equivalence is generally a 2-course sequence); when only some
// of that sequence is confidently known, `courses` holds just the known
// part and `courseNote` explains the rest — see file header.
export const IB_HUB_CREDIT = {
  'art history': { hub: ['AEX', 'HCO'], credits: 8, courses: ['CASAH111', 'CASAH112'] },
  biology: { hub: ['SI1', 'SI2'], credits: 8, courseNote: 'Course equivalents vary by score combination — contact BU Academic Advising to confirm your CAS BI courses' },
  chemistry: { hub: ['SI1', 'QR1'], credits: 8, courses: ['CASCH101', 'CASCH102'] },
  'classical studies greek': { hub: ['AEX'], credits: 8, courses: ['CASCL261', 'CASCL262'] },
  'classical studies latin': { hub: ['AEX'], credits: 8, courses: ['CASCL211', 'CASCL212'] },
  'computer science': { hub: ['QR2'], credits: 8, courses: ['CASCS111', 'CASCS112'] },
  economics: { hub: ['SO1'], credits: 8, courses: ['CASEC101', 'CASEC102'] },
  // "English A: Literature" (earns credit) — do NOT confuse with
  // "English A: Language and Literature" (IB_NO_CREDIT, below)
  'english language a literature': { hub: ['AEX'], credits: 8, courses: ['CASEN121'], courseNote: 'CAS EN 121 plus a second, advisor-approved English course' },
  geography: { hub: ['SI1', 'SO1'], credits: 8, courses: ['CASEE101', 'CASEE201'] },
  'global politics': { hub: ['GCI'], credits: 8, courses: ['CASPO171'], courseNote: 'CAS PO 171 plus a second, advisor-approved course' },
  'history africa and the middle east': { hub: ['HCO'], credits: 8, courses: ['CASHI176'], courseNote: 'CAS HI 176 plus a second, advisor-approved history course' },
  'history europe': { hub: ['HCO'], credits: 8, courses: ['CASHI217', 'CASHI218'] },
  'history the americas': { hub: ['HCO'], credits: 8, courses: ['CASHI152'], courseNote: 'CAS HI 152 plus a second, advisor-approved history course' },
  'history asia and oceania': { hub: ['HCO'], credits: 8, courses: ['CASHI176'], courseNote: 'CAS HI 176 plus a second, advisor-approved history course' },
  'language arabic': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLY211', 'CASLY212'] },
  'language chinese': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLC211', 'CASLC212'] },
  'language mandarin': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLC211', 'CASLC212'] },
  'language french': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLF211', 'CASLF212'] },
  'language german': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLG211', 'CASLG212'] },
  'language italian': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLI211', 'CASLI212'] },
  'language japanese': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLJ211', 'CASLJ212'] },
  'language hindi': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLN211', 'CASLN212'] },
  'language korean': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLK211', 'CASLK212'] },
  'language portuguese': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLP211', 'CASLP212'] },
  'language russian': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLR211', 'CASLR212'] },
  'language spanish': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLS211', 'CASLS212'] },
  // Per BU's source PDF, Turkish maps to the same CAS LK 211/212 pair as
  // Korean — possibly a source typo, but this mirrors the PDF as printed
  // rather than "fixing" it.
  'language turkish': { hub: ['IIC', 'GCI'], credits: 8, courses: ['CASLK211', 'CASLK212'] },
  'mathematics analysis': { hub: ['QR2'], credits: 8, courses: ['CASMA123', 'CASMA124'] },
  'mathematics applications and interpretation': { hub: ['QR2'], credits: 8, courses: ['CASMA115', 'CASMA123'] },
  philosophy: { hub: ['PLM'], credits: 8, courses: ['CASPH100'], courseNote: 'CAS PH 100 plus a second, advisor-approved philosophy course' },
  physics: { hub: ['SI1', 'SI2'], credits: 8, courses: ['CASPY105', 'CASPY106'] }, // "Physics 1 & 2"
  psychology: { hub: ['SO1'], credits: 8, courses: ['CASPS101'], courseNote: 'CAS PS 101 plus a second, advisor-approved psychology course' },
  'social cultural anthropology': { hub: ['SO1'], credits: 8, courses: ['CASAN101'], courseNote: 'CAS AN 101 plus a second, advisor-approved anthropology course' },
  'theatre arts': { hub: [], credits: 8, courseNote: 'CAS TH 1TR (elective; specific section varies)' },
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
 * @param {number} [score] - required only for score-dependent exams (Biology, Latin, Calculus BC)
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
    const scoped = entry.byScore[score];
    return scoped ? scoped.hub : [];
  }
  return entry.hub;
}

/**
 * Look up the BU credit hours granted for an AP exam — same resolution as
 * getApHub (fuzzy subject match, byScore lookup for score-dependent exams).
 * @param {string} rawSubject
 * @param {number} [score] - required only for score-dependent exams
 * @returns {number|null} credit hours, or null if unresolved (unknown
 *   exam, or a score-dependent exam with a missing/unmodeled score —
 *   deliberately null rather than a guessed 0, e.g. AP Calc BC scores 1-3).
 */
export function getApCredits(rawSubject, score) {
  const key = fuzzyMatchKey(normalize(rawSubject), AP_HUB_CREDIT, AP_ALIASES);
  if (!key) return null;
  const entry = AP_HUB_CREDIT[key];
  if (entry.byScore) {
    if (score == null) return null;
    const scoped = entry.byScore[score];
    return scoped ? scoped.credits : null;
  }
  return entry.credits;
}

/**
 * Look up the BU course equivalent(s) for an AP exam — same resolution as
 * getApHub/getApCredits.
 * @param {string} rawSubject
 * @param {number} [score] - required only for score-dependent exams
 * @returns {{courseKey: string|null, courses: string[]|null, courseNote: string|null}|null}
 *   null if unresolved. Otherwise exactly one of courseKey (single course),
 *   courses (a required multi-course sequence), or courseNote (no single
 *   confident answer — e.g. an "or" list, or a topics-placeholder course)
 *   is populated; the others are null.
 */
export function getApCourseInfo(rawSubject, score) {
  const key = fuzzyMatchKey(normalize(rawSubject), AP_HUB_CREDIT, AP_ALIASES);
  if (!key) return null;
  const entry = AP_HUB_CREDIT[key];
  const scoped = entry.byScore ? (score != null ? entry.byScore[score] : null) : entry;
  if (!scoped) return null;
  return {
    courseKey: scoped.courseKey ?? null,
    courses: scoped.courses ?? null,
    courseNote: scoped.courseNote ?? null,
  };
}

/**
 * Shared IB gating: no-credit subject, SL, or score < 5 all resolve to "no
 * credit" (not an error); missing HL/score with an otherwise-real subject
 * resolves to "can't tell yet"; a genuinely unrecognized subject resolves
 * to "can't tell yet" too. getIbHub/getIbCredits/getIbCourseInfo all read
 * from this one place so the gating can't drift between them.
 * @returns {{key: string|null, noCredit: boolean}}
 */
function resolveIbKey(rawSubject, score, isHigherLevel) {
  const normalized = normalize(rawSubject);
  const noCreditTable = Object.fromEntries(IB_NO_CREDIT.map((k) => [k, true]));
  if (fuzzyMatchKey(normalized, noCreditTable, null)) return { key: null, noCredit: true };
  if (isHigherLevel === false) return { key: null, noCredit: true };
  if (score != null && score < 5) return { key: null, noCredit: true };
  if (isHigherLevel == null || score == null) return { key: null, noCredit: false };
  return { key: fuzzyMatchKey(normalized, IB_HUB_CREDIT, null), noCredit: false };
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
  const { key, noCredit } = resolveIbKey(rawSubject, score, isHigherLevel);
  if (noCredit) return [];
  if (!key) return null;
  return IB_HUB_CREDIT[key].hub;
}

/**
 * Look up the BU credit hours granted for an IB exam — only non-null when
 * isHigherLevel is true and score >= 5, matching getIbHub's own gating.
 * @param {string} rawSubject
 * @param {number} [score]
 * @param {boolean} [isHigherLevel]
 * @returns {number|null}
 */
export function getIbCredits(rawSubject, score, isHigherLevel) {
  const { key, noCredit } = resolveIbKey(rawSubject, score, isHigherLevel);
  if (noCredit || !key) return null;
  return IB_HUB_CREDIT[key].credits;
}

/**
 * Look up the BU course equivalent(s) for an IB exam — only non-null when
 * isHigherLevel is true and score >= 5, matching getIbHub's own gating.
 * @param {string} rawSubject
 * @param {number} [score]
 * @param {boolean} [isHigherLevel]
 * @returns {{courses: string[]|null, courseNote: string|null}|null}
 *   null if unresolved/not-yet-eligible. Otherwise `courses` holds every
 *   confidently-known course in BU's required sequence (may be a partial
 *   list) and `courseNote` is set whenever that list is incomplete or
 *   there's no confident course at all.
 */
export function getIbCourseInfo(rawSubject, score, isHigherLevel) {
  const { key, noCredit } = resolveIbKey(rawSubject, score, isHigherLevel);
  if (noCredit || !key) return null;
  const entry = IB_HUB_CREDIT[key];
  return {
    courses: entry.courses ?? null,
    courseNote: entry.courseNote ?? null,
  };
}
