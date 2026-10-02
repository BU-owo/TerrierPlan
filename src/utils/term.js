// Single source of truth for "which term is the Scheduler showing" — v1 is
// scoped to one hardcoded term (no term-switching UI yet), so every place
// that needs it should import this rather than repeating the string. Moving
// to a new term later is changing this one constant, not a rewrite.
export const CURRENT_TERM = '2271';
export const CURRENT_TERM_LABEL = 'Spring 2027';
