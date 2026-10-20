// Single source of truth for "which term is the Scheduler showing" — v1 is
// scoped to one hardcoded term (no term-switching UI yet), so every place
// that needs it should import this rather than repeating the string. Moving
// to a new term later is changing this one constant, not a rewrite.
export const CURRENT_TERM = '2271';
export const CURRENT_TERM_LABEL = 'Spring 2027';

// "2268" -> "Fall 2026". PeopleSoft code: "2", a two-digit year, then a
// season digit (1 Spring, 5/6 Summer, 8 Fall). Anything else comes back as
// the raw code so an unknown term still shows something.
const SEASON_BY_DIGIT = { 1: 'Spring', 5: 'Summer', 6: 'Summer', 8: 'Fall' };
export function termLabel(code) {
  const m = /^2(\d{2})([1568])$/.exec(String(code ?? ''));
  return m ? `${SEASON_BY_DIGIT[m[2]]} ${2000 + Number(m[1])}` : String(code ?? '');
}

// ── Planner slots ↔ real terms ──────────────────────────────────────────────
// A student's `startTerm` is a Fall or Spring term code ("2248", "2251"). The
// planner grid stays Fall-anchored: slot 0 is the Fall of startTerm's
// academic year, even slots Fall, odd slots Spring, so a Spring starter's
// slot 0 is the Fall before they started. A Summer slot (`summer:{year}`)
// is the Summer after that year's Spring. None of this is CURRENT_TERM,
// which is the Scheduler's term, not today's.
const START_TERM_RE = /^2(\d{2})([18])$/;
const TERM_RE = /^2(\d{2})([1568])$/;

// Calendar year of the Fall that opens startTerm's academic year, or null.
function anchorYear(startTerm) {
  const m = START_TERM_RE.exec(String(startTerm ?? ''));
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  return m[2] === '8' ? year : year - 1;
}

// A stored startTerm if it's a valid Fall/Spring term code, else null.
export function normalizeStartTerm(value) {
  return typeof value === 'string' && START_TERM_RE.test(value) ? value : null;
}

// Guest → account profile merge: the account's startTerm wins; the guest's
// only fills in an account that has none. null if neither is valid.
export function mergeStartTerm(accountValue, localValue) {
  return normalizeStartTerm(accountValue) ?? normalizeStartTerm(localValue);
}

function termCode(year, digit) {
  if (!Number.isInteger(year) || year < 2000 || year > 2099) return null;
  return `2${String(year - 2000).padStart(2, '0')}${digit}`;
}

// Where `code` sits on the same timeline as targetChronoValue in
// courseEntry.js (year index * 3, + 0 Fall, 1 Spring, 2 Summer), counted
// from startTerm's anchor Fall. Negative before the anchor; null if either
// code is invalid. Both Summer digits (5, 6) are the same Summer.
export function termChronoValue(startTerm, code) {
  const anchor = anchorYear(startTerm);
  const m = TERM_RE.exec(String(code ?? ''));
  if (anchor == null || !m) return null;
  const year = 2000 + Number(m[1]);
  if (m[2] === '8') return (year - anchor) * 3;
  if (m[2] === '1') return (year - 1 - anchor) * 3 + 1;
  return (year - 1 - anchor) * 3 + 2;
}

// Term code for a slot target (grid index or `summer:{year}`), or null.
// Summer comes back with digit 5. Slots past the grid still get a term.
export function termFromSlot(startTerm, target) {
  const anchor = anchorYear(startTerm);
  if (anchor == null) return null;
  if (typeof target === 'string' && target.startsWith('summer:')) {
    const year = Number(target.slice('summer:'.length));
    if (!Number.isInteger(year) || year < 0) return null;
    return termCode(anchor + year + 1, '5');
  }
  const index = Number(target);
  if (!Number.isInteger(index) || index < 0) return null;
  const academicYear = anchor + Math.floor(index / 2);
  return index % 2 === 0 ? termCode(academicYear, '8') : termCode(academicYear + 1, '1');
}

// Slot target for a term code: a grid index for Fall/Spring, `summer:{year}`
// for Summer. null for a term before the anchor Fall or an invalid code. The
// index can be past the plan's grid; the caller decides what to do then.
export function slotFromTerm(startTerm, code) {
  const value = termChronoValue(startTerm, code);
  if (value == null || value < 0) return null;
  const year = Math.floor(value / 3);
  const offset = value % 3;
  return offset === 2 ? `summer:${year}` : year * 2 + offset;
}

// The term a date falls in: Jan 1–May 31 Spring, Jun 1–Aug 31 Summer,
// Sep 1–Dec 31 Fall (the gap between terms counts as the next one). Summer
// comes back with digit 5. `today` is a parameter so tests can pin it.
export function termForDate(today) {
  if (!(today instanceof Date) || Number.isNaN(today.getTime())) return null;
  const month = today.getMonth();
  const digit = month < 5 ? '1' : month < 8 ? '5' : '8';
  return termCode(today.getFullYear(), digit);
}

// Start-term choices (term codes), newest first: every Spring and Fall from
// the Fall seven academic years before today's through the first Spring
// after today. [] for an invalid date.
export function startTermOptions(today) {
  if (!termForDate(today)) return [];
  const year = today.getFullYear();
  const academicYear = today.getMonth() >= 8 ? year : year - 1;
  const codes = [];
  for (let fallYear = year; fallYear >= academicYear - 7; fallYear--) {
    codes.push(termCode(fallYear + 1, '1'), termCode(fallYear, '8'));
  }
  return codes.filter(Boolean);
}

// Which term a saved schedule belongs to: its `term` field, or — for one
// saved without it — the term prefix of its section ids ("2268_1234"), and
// only then the current term. Read-only: never written back to the schedule.
export function scheduleTerm(schedule) {
  if (schedule?.term) return String(schedule.term);
  const m = /^(\d{4})_/.exec(schedule?.selectedSectionIds?.[0] ?? '');
  return m ? m[1] : CURRENT_TERM;
}
