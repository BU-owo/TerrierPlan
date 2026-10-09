// Read ONCE, when the app bundle loads, before PickYourPath (or anything
// else) can set these keys. "Returning" = the old beta modal was dismissed
// (terrierplan_beta_seen) and the new first-visit card never was
// (terrierplan_onboarded_v2, set by PickYourPath on any choice or dismissal).
// Returning browsers skip the first-timer defaults (right panel starts
// collapsed, one-time hints); anyone who went through the card stays a
// first-timer for hints they haven't met yet.
function readReturning() {
  try {
    return localStorage.getItem('terrierplan_beta_seen') === 'true'
      && localStorage.getItem('terrierplan_onboarded_v2') !== 'true';
  } catch {
    return false;
  }
}

const returning = readReturning();

export function isReturningUser() {
  return returning;
}
