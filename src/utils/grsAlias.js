import aliases from '../data/grsAliases';

// Read-time GRS -> CAS alias lookup (see scripts/build-grs-aliases.cjs). A
// GRS course renumbered into CAS borrows the CAS course's data for display
// only; the GRS key itself is never replaced in a plan or a course doc.
export function aliasFor(courseKey) {
  return Object.prototype.hasOwnProperty.call(aliases, courseKey) ? aliases[courseKey] : null;
}

// Reverse lookup, built once: CAS key -> every GRS key aliased to it, sorted.
// Several GRS keys can share one CAS key (GRSEE/GRSGE/GRSES938 -> CASEE938).
const NO_KEYS = Object.freeze([]);
const formerKeys = new Map();
for (const [grsKey, casKey] of Object.entries(aliases)) {
  if (!formerKeys.has(casKey)) formerKeys.set(casKey, []);
  formerKeys.get(casKey).push(grsKey);
}
for (const list of formerKeys.values()) list.sort();

// GRS keys that now live at `casKey` (empty array if none). The returned
// array is shared and stable — don't mutate it.
export function formerKeysFor(casKey) {
  return formerKeys.get(casKey) ?? NO_KEYS;
}

// "CASBI623" -> "CAS BI 623"; anything that isn't a plain key is returned as-is.
export function formatCourseKey(courseKey) {
  const m = /^([A-Z]{3})([A-Z]{2})(\d+[A-Z]*)$/.exec(courseKey);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : courseKey;
}
