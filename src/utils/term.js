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

// Which term a saved schedule belongs to: its `term` field, or — for one
// saved without it — the term prefix of its section ids ("2268_1234"), and
// only then the current term. Read-only: never written back to the schedule.
export function scheduleTerm(schedule) {
  if (schedule?.term) return String(schedule.term);
  const m = /^(\d{4})_/.exec(schedule?.selectedSectionIds?.[0] ?? '');
  return m ? m[1] : CURRENT_TERM;
}
