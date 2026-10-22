// The fields of a plan doc a save can carry besides name/semesters/isTransfer.
// externalCredits is deliberately absent: it's student-level (the profile).
export const PLAN_SNAPSHOT_FIELDS = [
  'gridSummerTerms',
  'majorBulletinUrl',
  'extraTerms',
  'cumulativeGpa',
  'earnedCredits',
  'gradePoints',
  'requirementOverrides',
  'stash',
];

// The updateDoc payload for one plan save, built ONLY from the snapshot it is
// given (the plan the edit was made on), never from whatever plan is on screen
// when the save runs. A captured null stays null; a field the snapshot doesn't
// have (or holds as undefined) is left out, so updateDoc leaves the doc's own
// value alone. `semesters` must already be in Firestore form. No updatedAt:
// the caller adds the server timestamp.
export function buildPlanPayload({ name, semesters, isTransfer }, extras = {}) {
  const payload = {};
  if (name !== undefined) payload.name = name;
  if (semesters !== undefined) payload.semesters = semesters;
  if (isTransfer !== undefined) payload.isTransfer = isTransfer;
  for (const field of PLAN_SNAPSHOT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(extras ?? {}, field) && extras[field] !== undefined) {
      payload[field] = extras[field];
    }
  }
  return payload;
}
