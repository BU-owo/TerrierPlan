import { HUB_COLOR_FOR } from '../../utils/hubConstants';
import { getOfferingBadge } from '../../utils/offeringPattern';
import { CURRENT_TERM_LABEL } from '../../utils/term';
import { marineKind } from '../../data/marineSemester';

// The HUB unit tags and season-agnostic offering badge shared by search
// results, the Paw-tential Courses tab, and requirement course rows — one
// copy of the markup instead of one per list.

// Up to `max` hub-chip tags, colored by HUB group. No wrapper — callers
// place them (e.g. inside .search-result-hub).
export function HubUnitTags({ units, max = 4 }) {
  if (!units?.length) return null;
  return units.slice(0, max).map((unit) => (
    <span key={unit} className={`hub-chip hub-chip-${HUB_COLOR_FOR[unit]?.groupId ?? 'def'}`}>
      {unit}
    </span>
  ));
}

const CURRENT_TERM_TEXT = `Offered ${CURRENT_TERM_LABEL}`;
// "Spring 2027" -> "Spring" (the season word), for medium/narrow rows.
const CURRENT_TERM_SHORT = CURRENT_TERM_LABEL.split(' ')[0];
const SNAPSHOT_NOTE = 'Based on the latest imported schedule';

// Green ✓ "{CURRENT_TERM_LABEL}" badge when the course has a section in
// CURRENT_TERM (catalog `inCurrentTerm`), in place of the season/pattern
// badge. Otherwise the "Usually Fall" / "Offered some years" / … badge, or
// nothing (see getOfferingBadge). Container queries in planner.css step it
// down by width: ✓ full label -> ● season word -> green dot only.
export function OfferingBadge({ offeringPattern, upcomingSeasons, inCurrentTerm = false }) {
  if (inCurrentTerm) {
    return (
      <span
        className="offering-badge offering-badge-current"
        role="img"
        aria-label={CURRENT_TERM_TEXT}
        title={`${CURRENT_TERM_TEXT}. ${SNAPSHOT_NOTE}.`}
      >
        <span className="offering-badge-check">✓</span>
        <span className="offering-badge-dot" />
        <span className="offering-badge-long">{CURRENT_TERM_LABEL}</span>
        <span className="offering-badge-short">{CURRENT_TERM_SHORT}</span>
      </span>
    );
  }
  const badge = getOfferingBadge(offeringPattern, upcomingSeasons);
  if (!badge) return null;
  return (
    <span className={`offering-badge ${badge.className}`} title={badge.text}>
      {badge.label}
    </span>
  );
}

// "{CURRENT_TERM_LABEL}" filter pill for browsing lists (search, HUB finder,
// requirement course lists), off by default — outlined off, filled green
// with a ✓ on, like the HUB code chips. When on, a muted one-line note that
// it's a snapshot. Never used for claimed rows.
export function OfferedFilterToggle({ checked, onChange }) {
  return (
    <div className="offered-filter">
      <button
        type="button"
        className={`hub-chip offered-filter-chip${checked ? ' is-on' : ''}`}
        aria-pressed={checked}
        title={checked ? 'Show all courses' : `Only courses offered ${CURRENT_TERM_LABEL}`}
        onClick={() => onChange(!checked)}
      >
        {checked && <span aria-hidden="true">✓ </span>}
        {CURRENT_TERM_LABEL}
      </button>
      {checked && <span className="offered-filter-note">{SNAPSHOT_NOTE}</span>}
    </div>
  );
}

const MARINE_PILL_TITLE = {
  only: 'Taught as part of the Marine Semester. Requires admission to the Marine Semester.',
  also: 'Also taught in the Marine Semester. Open to students another way too.',
};

// "Marine Semester" pill on a course the Marine Semester lists as ONLY or
// ALSO (src/data/marineSemester.js); nothing for any other course.
export function MarineSemesterPill({ courseKey }) {
  const kind = marineKind(courseKey);
  if (!kind) return null;
  return <span className="marine-pill" title={MARINE_PILL_TITLE[kind]}>Marine Semester</span>;
}
