import { useState, useEffect, useCallback } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { HUB_COLOR_FOR } from '../../utils/hubConstants';
import { getOfferingBadge } from '../../utils/offeringPattern';
import useUpcomingSeasons from '../../hooks/useUpcomingSeasons';
import { isProfessionalCareer } from '../../utils/courseQuery';
import { CURRENT_TERM, CURRENT_TERM_LABEL } from '../../utils/term';
import { describeSectionTime, describeExamTime, describeSeatStatus } from '../../utils/sectionTime';
import { withMockMeetings } from '../../utils/mockMeetings';
import { sectionTypeLabel } from '../../utils/sectionType';
import { groupSectionsByComponent } from '../../utils/sectionComponents';
import { instructorLabel } from '../../utils/sectionInstructors';
import './CourseInfoPanel.css';

// Past offerings ignores history before this year, in both the grid and the
// "N of M years" summary.
const OFFERING_HISTORY_MIN_YEAR = 2020;

// Matches the planner's own mobile breakpoint (planner.css) — above it the
// panel is a scrimless right drawer, at or below it a modal bottom sheet.
const MOBILE_QUERY = '(max-width: 860px)';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

// ── Data ────────────────────────────────────────────────────────────────────
// Three independent, read-only fetches per course, each cached for the
// session in its own module-level Map so reopening a course (or flipping
// between two) costs nothing. Only successful reads are cached — a failure
// or a missing doc is retried the next time the panel opens on that course.
// At most four Firestore requests per open: the course doc, the
// offeringHistory doc, the Fall 2026 sections query, and (only when that
// yields no credits) one fallback sections query.
const courseDocCache = new Map();
const offeringHistoryCache = new Map();
const fall2026Cache = new Map();

async function fetchCourseDoc(courseKey) {
  const snap = await getDoc(doc(db, 'courses', courseKey));
  return snap.exists() ? snap.data() : null;
}

async function fetchOfferingHistory(courseKey) {
  const snap = await getDoc(doc(db, 'offeringHistory', courseKey));
  return snap.exists() ? snap.data() : null;
}

// {min, max} over every numeric credits value, or null when there is none.
function creditsRange(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

// Fall 2026 sections for a course plus its credits. Two equality filters on
// separate fields — Firestore serves that from its built-in single-field
// indexes, no composite index needed. Credits come from those sections; if
// they give none (usually because there are no sections), one limit(1) query
// for the course in any term is the fallback. Never resolves to null: an
// empty `sections` array is a valid answer, and is cached like any other.
async function fetchFall2026(courseKey) {
  const snap = await getDocs(
    query(collection(db, 'sections'), where('courseKey', '==', courseKey), where('term', '==', CURRENT_TERM)),
  );
  const sections = snap.docs.map((d) => withMockMeetings({ id: d.id, ...d.data() }));
  let credits = creditsRange(sections.map((s) => s.credits));
  if (!credits) {
    const fallback = await getDocs(query(collection(db, 'sections'), where('courseKey', '==', courseKey), limit(1)));
    credits = creditsRange(fallback.docs.map((d) => d.get('credits')));
  }
  return { sections, credits };
}

// Fetches `fetcher(key)` once per key, caching successes in `cache`. A
// fetcher resolves to null for "doesn't exist". Results are tagged with the
// key they belong to, so a late or stale one is never shown against a
// different course. `retry` re-runs a failed or missing fetch.
function useCachedFetch(cache, key, fetcher) {
  const [result, setResult] = useState({ key: null, status: 'idle', data: null });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!key || cache.has(key)) return undefined;
    let cancelled = false;
    fetcher(key)
      .then((data) => {
        if (cancelled) return;
        if (data == null) {
          setResult({ key, status: 'missing', data: null });
          return;
        }
        cache.set(key, data);
        setResult({ key, status: 'ready', data });
      })
      .catch((err) => {
        console.error('Failed to load course info:', err);
        if (!cancelled) setResult({ key, status: 'error', data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [cache, key, fetcher, retryToken]);

  const retry = useCallback(() => {
    setResult({ key: null, status: 'idle', data: null });
    setRetryToken((n) => n + 1);
  }, []);

  if (!key) return { status: 'idle', data: null, retry };
  const cached = cache.get(key);
  if (cached) return { status: 'ready', data: cached, retry };
  if (result.key === key) return { status: result.status, data: result.data, retry };
  return { status: 'loading', data: null, retry };
}

// ── Display helpers ─────────────────────────────────────────────────────────
// Missing (undefined/null) and empty-string are different states on purpose:
// a name-only course created from schedule history has no description or
// prerequisites field at all ("we haven't got this yet"), while a catalog
// course can carry '' ("the catalog says there's nothing").
function textState(value) {
  if (value === undefined || value === null) return 'missing';
  if (typeof value !== 'string' || value.trim() === '') return 'empty';
  return 'text';
}

function DetailText({ value, emptyLabel }) {
  const state = textState(value);
  if (state === 'text') return <p className="course-info-text">{value.trim()}</p>;
  return (
    <p className="course-info-empty">{state === 'missing' ? 'Details not available yet' : emptyLabel}</p>
  );
}

function formatCredits(credits) {
  if (!credits) return '—';
  return credits.min === credits.max ? String(credits.min) : `${credits.min}–${credits.max}`;
}

const SEASONS = ['Fall', 'Spring', 'Summer']; // column order

// Calendar order within a year — decides which terms are still in the future
// and which is the most recent.
const SEASON_ORDER = { Spring: 0, Summer: 1, Fall: 2 };
const SEASON_BY_TERM_DIGIT = { 1: 'Spring', 5: 'Summer', 6: 'Summer', 8: 'Fall' };
// CURRENT_TERM is a PeopleSoft code: "2", a two-digit year, then a season
// digit ("2268" = Fall 2026).
const CURRENT_TERM_YEAR = 2000 + Number(CURRENT_TERM.slice(1, 3));
const CURRENT_TERM_SEASON = SEASON_BY_TERM_DIGIT[CURRENT_TERM.slice(3)];

// True for a term that comes after the current one. If the current season
// can't be read from the code, no term in the current year counts as future.
function isFutureTerm(year, season) {
  if (year !== CURRENT_TERM_YEAR) return year > CURRENT_TERM_YEAR;
  return CURRENT_TERM_SEASON != null && SEASON_ORDER[season] > SEASON_ORDER[CURRENT_TERM_SEASON];
}

// True for a term strictly before the current one. Mirror of isFutureTerm:
// if the current season can't be read, no term in the current year is past.
function isPastTerm(year, season) {
  if (year !== CURRENT_TERM_YEAR) return year < CURRENT_TERM_YEAR;
  return CURRENT_TERM_SEASON != null && SEASON_ORDER[season] < SEASON_ORDER[CURRENT_TERM_SEASON];
}

// offeringHistory `history` → one row per year from OFFERING_HISTORY_MIN_YEAR
// through the current term's year, newest first, whether or not the course
// has an entry for that year. Uses each entry's `year` and `season` as-is
// (no term-code conversion). A cell is the section count, or null when that
// season has no entry; whether a cell is in the future is decided at render
// time by isFutureTerm. Entries outside the row range or in the future are
// ignored. `rows` is [] when no entry is in range at all (the "no history"
// state), and `lastOffered` is the most recent in-range term.
function buildOfferingRows(history) {
  const offered = new Map(); // `${year}-${season}` → section count
  let lastOffered = null;
  for (const entry of Array.isArray(history) ? history : []) {
    const year = Number(entry?.year);
    if (!Number.isInteger(year) || !SEASONS.includes(entry.season)) continue;
    if (year < OFFERING_HISTORY_MIN_YEAR || year > CURRENT_TERM_YEAR || isFutureTerm(year, entry.season)) continue;
    const key = `${year}-${entry.season}`;
    const count = Number.isFinite(entry.sectionCount) ? entry.sectionCount : 0;
    offered.set(key, (offered.get(key) ?? 0) + count);
    if (!lastOffered || year * 3 + SEASON_ORDER[entry.season] > lastOffered.year * 3 + SEASON_ORDER[lastOffered.season]) {
      lastOffered = { year, season: entry.season };
    }
  }
  if (offered.size === 0) return { rows: [], lastOffered: null };
  const rows = [];
  for (let year = CURRENT_TERM_YEAR; year >= OFFERING_HISTORY_MIN_YEAR; year -= 1) {
    rows.push({
      year,
      Fall: offered.get(`${year}-Fall`) ?? null,
      Spring: offered.get(`${year}-Spring`) ?? null,
      Summer: offered.get(`${year}-Summer`) ?? null,
    });
  }
  return { rows, lastOffered };
}

// The current term is usually not in offeringHistory yet (it is a published
// schedule, not completed history), so when the course has sections this term
// (cancelled ones don't count) add one history entry for it. History wins: if
// it already has an entry for the current term, nothing is added.
function withCurrentTermEntry(history, currentSections) {
  if (!currentSections || CURRENT_TERM_SEASON == null) return history;
  const hasEntry = history.some(
    (entry) => Number(entry?.year) === CURRENT_TERM_YEAR && entry.season === CURRENT_TERM_SEASON,
  );
  if (hasEntry) return history;
  const sectionCount = currentSections.filter((s) => s.classStat !== 'Cancelled').length;
  if (sectionCount === 0) return history;
  return [...history, { year: CURRENT_TERM_YEAR, season: CURRENT_TERM_SEASON, sectionCount }];
}

// "Fall 4 of 4 · Spring 3 of 4 · Summer 0 of 4". Per season, M is the number
// of terms of that season from the course's first offered year (in the row
// range) up to, but not including, the current term, and N is how many of
// those have a dot. Takes rows built from offeringHistory alone, so the
// current term (counted from sections, not history) is in neither N nor M.
function summarizeSeasons(rows) {
  const offeredYears = rows
    .filter((row) => SEASONS.some((season) => row[season] != null))
    .map((row) => row.year);
  const firstYear = Math.min(...offeredYears);
  return SEASONS.map((season) => {
    const happened = rows.filter((row) => row.year >= firstYear && isPastTerm(row.year, season));
    const offered = happened.filter((row) => row[season] != null).length;
    return `${season} ${offered} of ${happened.length}`;
  }).join(' · ');
}

function offeringCellLabel(year, season, count) {
  if (isFutureTerm(year, season)) return `${season} ${year}: not yet happened`;
  if (count == null) return `${season} ${year}: not offered`;
  return `${season} ${year}: offered`;
}

function offeringCellTitle(year, season, count) {
  if (count == null || isFutureTerm(year, season)) return undefined;
  return `${season} ${year}: ${count} section${count === 1 ? '' : 's'}`;
}

function SectionStatus({ status, onRetry, children }) {
  if (status === 'loading') return <p className="course-info-empty">Loading…</p>;
  if (status === 'error') {
    return (
      <div className="course-info-status course-info-status-inline">
        <p>Couldn&apos;t load this.</p>
        <button type="button" className="course-info-retry" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return children;
}

// Most recent non-future term in the UNFILTERED history — unlike
// buildOfferingRows it ignores OFFERING_HISTORY_MIN_YEAR, so a course that
// last ran before the grid's range can still say when.
function latestOfferingEver(history) {
  let latest = null;
  for (const entry of Array.isArray(history) ? history : []) {
    const year = Number(entry?.year);
    if (!Number.isInteger(year) || !SEASONS.includes(entry.season) || isFutureTerm(year, entry.season)) continue;
    if (!latest || year * 3 + SEASON_ORDER[entry.season] > latest.year * 3 + SEASON_ORDER[latest.season]) {
      latest = { year, season: entry.season };
    }
  }
  return latest;
}

function PastOfferings({ status, data, currentSections, onRetry }) {
  const history = Array.isArray(data?.history)
    ? data.history.filter((entry) => Number(entry?.year) >= OFFERING_HISTORY_MIN_YEAR)
    : [];
  // No offeringHistory doc ('missing', e.g. a course created from the
  // schedule) counts as an empty history, so current-term sections still
  // give the table its one row.
  const noHistoryDoc = status === 'missing';
  const { rows, lastOffered } = status === 'ready' || noHistoryDoc
    ? buildOfferingRows(withCurrentTermEntry(history, currentSections))
    : { rows: [], lastOffered: null };
  const historyRows = status === 'ready' ? buildOfferingRows(history).rows : [];
  const latestEver = status === 'ready' ? latestOfferingEver(data?.history) : null;
  const emptyText = status === 'missing'
    ? 'No offering history available'
    : latestEver
      ? `Last offered ${latestEver.season} ${latestEver.year}`
      : 'No offerings on record';
  return (
    <section className="course-info-section">
      <h4 className="course-info-section-title">Past offerings</h4>
      <SectionStatus status={status === 'missing' ? 'ready' : status} onRetry={onRetry}>
        {rows.length === 0 ? (
          <p className="course-info-empty">{emptyText}</p>
        ) : (
          <>
            {noHistoryDoc ? (
              <>
                <p className="course-info-offerings-last">
                  Scheduled {lastOffered.season} {lastOffered.year}
                </p>
                <p className="course-info-offerings-summary">No earlier offerings on record</p>
              </>
            ) : (
              <p className="course-info-offerings-last">
                Last offered: {lastOffered.season} {lastOffered.year}
              </p>
            )}
            {historyRows.length > 0 && (
              <p className="course-info-offerings-summary">{summarizeSeasons(historyRows)}</p>
            )}
            <table className="course-info-offerings">
              <caption className="course-info-sr-only">Which seasons the course was offered, by year</caption>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  {SEASONS.map((season) => (
                    <th key={season} scope="col">
                      {season}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.year}>
                    <th scope="row">{row.year}</th>
                    {SEASONS.map((season) => (
                      <td
                        key={season}
                        className={isFutureTerm(row.year, season) ? 'is-future' : undefined}
                        title={offeringCellTitle(row.year, season, row[season])}
                        aria-label={offeringCellLabel(row.year, season, row[season])}
                      >
                        {isFutureTerm(row.year, season) ? null : row[season] == null ? (
                          <span className="course-info-offerings-dash" aria-hidden="true">–</span>
                        ) : (
                          <span className="course-info-offerings-dot" aria-hidden="true">●</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="course-info-offerings-legend">● = offered that term</p>
          </>
        )}
      </SectionStatus>
    </section>
  );
}

function compareClassSection(a, b) {
  return (a.classSection || '').localeCompare(b.classSection || '', undefined, { numeric: true });
}

function CurrentTermSections({ status, data, onRetry }) {
  const sections = status === 'ready' ? data.sections : [];
  const groups = groupSectionsByComponent(sections, compareClassSection);
  return (
    <section className="course-info-section">
      <h4 className="course-info-section-title">{CURRENT_TERM_LABEL} sections</h4>
      <SectionStatus status={status} onRetry={onRetry}>
        {sections.length === 0 ? (
          <p className="course-info-empty">Not scheduled for {CURRENT_TERM_LABEL}</p>
        ) : (
          groups.map((group) => (
            <details key={group.key} className="course-info-group" open>
              <summary className="course-info-group-title">
                {group.label} <span className="course-info-group-count">({group.sections.length})</span>
              </summary>
              <ul className="course-info-sections">
                {group.sections.map((section) => {
                  const isOpen = (section.enrlStat || '').trim().toLowerCase() === 'open';
                  return (
                    <li key={section.id} className="course-info-section-row">
                      <div className="course-info-section-top">
                        <span className="course-info-section-label">
                          <span className="sched-type-pill" title={sectionTypeLabel(section).full}>{sectionTypeLabel(section).abbr}</span>{' '}
                          Section {section.classSection}
                        </span>
                        <span className="course-info-section-time">{describeSectionTime(section)}</span>
                      </div>
                      {describeExamTime(section) && (
                        <div className="course-info-section-exam">Exam: {describeExamTime(section)}</div>
                      )}
                      <div className="course-info-section-instructor">{instructorLabel(section)}</div>
                      <div className={`course-info-section-seats ${isOpen ? 'is-open' : 'is-closed'}`}>
                        {describeSeatStatus(section)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))
        )}
      </SectionStatus>
    </section>
  );
}

// Detail panel for one course, opened from a search or stash result. Driven
// entirely by `courseKey` (null = closed) and `onClose`, so it has no
// planner-specific wiring and can be mounted from another page later.
// Read-only: nothing is ever written.
export default function CourseInfoPanel({ courseKey, onClose }) {
  const isMobile = useIsMobile();
  const courseFetch = useCachedFetch(courseDocCache, courseKey, fetchCourseDoc);
  const historyFetch = useCachedFetch(offeringHistoryCache, courseKey, fetchOfferingHistory);
  const termFetch = useCachedFetch(fall2026Cache, courseKey, fetchFall2026);
  const upcomingSeasons = useUpcomingSeasons(courseKey);

  useEffect(() => {
    if (!courseKey) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [courseKey, onClose]);

  if (!courseKey) return null;

  const { status, data: course } = courseFetch;
  const courseNumber = course?.courseNumber ?? courseKey;
  const offeringBadge = course ? getOfferingBadge(course.offeringPattern, upcomingSeasons) : null;
  const hubUnits = course?.hubUnits ?? [];

  return (
    <div
      className="course-info-overlay"
      // Only the mobile scrim is an interactive surface; on desktop this
      // wrapper is display: contents and never receives clicks.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="course-info-panel"
        role="dialog"
        aria-modal={isMobile}
        aria-labelledby="course-info-title"
      >
        <div className="course-info-header">
          <div className="course-info-heading">
            <div className="course-info-code">{courseNumber}</div>
            <h3 id="course-info-title" className="course-info-title">
              {status === 'ready' ? course.name || '—' : status === 'loading' ? 'Loading…' : 'Course details'}
            </h3>
            {status === 'ready' && course.nameIsAbbreviated === true && (
              <p className="course-info-name-note">Name may be shortened</p>
            )}
            {/* Credits come from the sections fetch, not the course doc, so
                they appear when that resolves; nothing is shown while it loads. */}
            {termFetch.status !== 'loading' && (
              <p className="course-info-credits">
                Credits: {termFetch.status === 'ready' ? formatCredits(termFetch.data.credits) : '—'}
              </p>
            )}
          </div>
          <button type="button" className="course-info-close" onClick={onClose} aria-label="Close course details">
            ×
          </button>
        </div>

        <div className="course-info-body">
          {status === 'loading' && <p className="course-info-status">Loading course details…</p>}

          {status === 'missing' && (
            <p className="course-info-status">No catalog entry found for this course.</p>
          )}

          {status === 'error' && (
            <div className="course-info-status">
              <p>Couldn&apos;t load course details.</p>
              <button type="button" className="course-info-retry" onClick={courseFetch.retry}>
                Try again
              </button>
            </div>
          )}

          {status === 'ready' && (
            <>
              <div className="course-info-chips">
                {hubUnits.map((unit) => (
                  <span key={unit} className={`hub-chip hub-chip-${HUB_COLOR_FOR[unit]?.groupId ?? 'def'}`}>
                    {unit}
                  </span>
                ))}
                {course.career && (
                  <span
                    className={`offering-badge ${
                      isProfessionalCareer(course.career) ? 'offering-badge-career' : 'offering-badge-neutral'
                    }`}
                  >
                    {course.career}
                  </span>
                )}
                {course.studyAbroad && <span className="offering-badge offering-badge-abroad">Study abroad</span>}
                {offeringBadge ? (
                  <span className={`offering-badge ${offeringBadge.className}`} title={offeringBadge.text}>
                    {offeringBadge.label}
                  </span>
                ) : (
                  course.offeringPattern && (
                    <span className="offering-badge offering-badge-neutral">{course.offeringPattern}</span>
                  )
                )}
              </div>

              <section className="course-info-section">
                <h4 className="course-info-section-title">Description</h4>
                <DetailText value={course.description} emptyLabel="No description available" />
              </section>

              <section className="course-info-section">
                <h4 className="course-info-section-title">Prerequisites</h4>
                <DetailText value={course.prerequisites} emptyLabel="None listed" />
              </section>

              <PastOfferings
                status={historyFetch.status}
                data={historyFetch.data}
                currentSections={termFetch.status === 'ready' ? termFetch.data.sections : null}
                onRetry={historyFetch.retry}
              />

              <CurrentTermSections status={termFetch.status} data={termFetch.data} onRetry={termFetch.retry} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
