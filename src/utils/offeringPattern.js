// Compares a course's historical `offeringPattern` (courses/{courseKey} doc)
// against the season it's actually been placed in, for the grid's
// non-blocking season-mismatch warning. Purely informational — historical
// data, not a guarantee, so this never affects drag-and-drop, HUB counting,
// or requirement evaluation. `season` is 'fall' | 'spring' | 'summer' |
// 'winter' (lowercase — see SemesterBoard for grid slots, extraTerms[].season
// for transcript-overflow terms).
//
// `shortLabel` is shown directly on the course card (so the warning is
// self-explanatory without a hover); `text` is the fuller sentence used as
// the hover tooltip for anyone who wants the detail.
const FALL_SPRING_ONLY = {
  Fall: { mismatchSeason: 'spring', shortLabel: 'Fall only', text: 'Usually only offered in Fall' },
  Spring: { mismatchSeason: 'fall', shortLabel: 'Spring only', text: 'Usually only offered in Spring' },
};

const ALTERNATING = {
  'Alternating Fall': {
    mainSeason: 'fall',
    mismatchSeason: 'spring',
    mismatchShortLabel: 'Fall only',
    mismatchText: 'Usually only offered in Fall',
    noticeShortLabel: 'Not every Fall',
    noticeText: 'Not offered every Fall — worth double-checking',
  },
  'Alternating Spring': {
    mainSeason: 'spring',
    mismatchSeason: 'fall',
    mismatchShortLabel: 'Spring only',
    mismatchText: 'Usually only offered in Spring',
    noticeShortLabel: 'Not every Spring',
    noticeText: 'Not offered every Spring — worth double-checking',
  },
};

// Returns { severity: 'warning' | 'notice', shortLabel, text } or null.
// 'warning' is a real mismatch (course likely isn't offered that term at
// all); 'notice' is the lighter alternating-pattern heads-up for a season
// it's usually — but not always — offered in.
export function getOfferingWarning(offeringPattern, season) {
  if (!offeringPattern || !season) return null;

  if (offeringPattern === 'Not offered in 5 years') {
    return {
      severity: 'warning',
      shortLabel: 'Rarely offered',
      text: "Hasn't been offered in 5+ years — check with the department",
    };
  }

  if (offeringPattern === 'Summer') {
    return season === 'fall' || season === 'spring'
      ? { severity: 'warning', shortLabel: 'Summer only', text: 'Usually only offered in Summer' }
      : null;
  }

  const fallOrSpring = FALL_SPRING_ONLY[offeringPattern];
  if (fallOrSpring) {
    return season === fallOrSpring.mismatchSeason
      ? { severity: 'warning', shortLabel: fallOrSpring.shortLabel, text: fallOrSpring.text }
      : null;
  }

  const alternating = ALTERNATING[offeringPattern];
  if (alternating) {
    if (season === alternating.mismatchSeason) {
      return { severity: 'warning', shortLabel: alternating.mismatchShortLabel, text: alternating.mismatchText };
    }
    if (season === alternating.mainSeason) {
      return { severity: 'notice', shortLabel: alternating.noticeShortLabel, text: alternating.noticeText };
    }
    return null;
  }

  // 'Fall and Spring', 'Insufficient data', 'Random', or anything
  // unrecognized — no warning.
  return null;
}

// Season-agnostic pattern badge shown on search results and stashed courses,
// where there's no placed semester to compare against yet — just "here's
// what this course's history generally looks like." Distinct from
// getOfferingWarning above, which needs a specific placed season.
const OFFERING_BADGES = {
  Fall: { className: 'offering-badge-neutral', label: 'Fall only' },
  Spring: { className: 'offering-badge-neutral', label: 'Spring only' },
  'Alternating Fall': { className: 'offering-badge-warn', label: 'Offered some years' },
  'Alternating Spring': { className: 'offering-badge-warn', label: 'Offered some years' },
  'Not offered in 5 years': { className: 'offering-badge-rare', label: 'Rarely offered' },
};

export function getOfferingBadge(offeringPattern) {
  return OFFERING_BADGES[offeringPattern] ?? null;
}
