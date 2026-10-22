import { useState, useEffect, useMemo, useRef } from 'react';
import { normalizeCourseKey, parseCourseKey, compareByCatalogNumber } from '../../utils/courseKey';
import { loadAllCourses, isProfessionalCareer } from '../../utils/courseQuery';
import { CURRENT_TERM_LABEL } from '../../utils/term';
import SchedulerCourseRow from './SchedulerCourseRow';
import PawLoader from '../PawLoader';
import useDelayedBusy from '../../hooks/useDelayedBusy';

// Left panel: add a course to the schedule draft. Same normalization/
// subject-prefix approach as the Planner's CourseSearch (courseKey.js is
// the shared piece — see that component for the fuller version with HUB
// filters and drag-and-drop, neither of which matters here). HUB filtering
// is planner-specific (degree requirements), not relevant when the goal is
// just "which sections can I take this term."
export default function SchedulerSearch({ draftCourseKeys, onAddCourse, onShowCourseInfo, theme = 'light' }) {
  const [query, setQuery] = useState('');
  const [allCourses, setAllCourses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const debounceRef = useRef(null);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  // In-memory only; "Only available" hides courses with no CURRENT_TERM sections.
  const [onlyAvailable, setOnlyAvailable] = useState(true);

  // Shared catalog cache (courseQuery.js) — resolves from the same promise
  // as the planner's search instead of downloading the catalog again.
  useEffect(() => {
    let cancelled = false;
    loadAllCourses()
      .then((courses) => {
        if (!cancelled) setAllCourses(courses);
      })
      .catch((err) => {
        console.error('Failed to load courses:', err);
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only gate once the catalog carries `inCurrentTerm` (static file
  // re-exported); an older cached catalog or the Firestore fallback has none,
  // and gating then would disable every course.
  const gateByCurrentTerm = useMemo(() => allCourses.some((c) => c.inCurrentTerm), [allCourses]);

  const subjectPrefixes = useMemo(() => {
    const set = new Set();
    for (const course of allCourses) {
      const parsed = parseCourseKey(course.id);
      if (parsed) set.add(parsed.subject);
    }
    return set;
  }, [allCourses]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    if (!loaded) return;

    debounceRef.current = setTimeout(() => {
      setSearching(true);
      const normalizedQuery = normalizeCourseKey(term);
      const isSubjectMode = /^[A-Z]+$/.test(normalizedQuery) && subjectPrefixes.has(normalizedQuery);

      let matches;
      if (isSubjectMode) {
        matches = allCourses
          .filter((c) => c.id.startsWith(normalizedQuery))
          .sort(compareByCatalogNumber);
      } else {
        matches = allCourses.filter((c) => {
          const normalizedCourseNum = normalizeCourseKey(c.courseNumber || '');
          const normalizedCourseName = (c.name || '').toUpperCase();
          return normalizedCourseNum.includes(normalizedQuery) || normalizedCourseName.includes(normalizedQuery);
        });
      }
      // Law/Dental/Medical last, before the cut to 20 — same rule as the
      // planner's CourseSearch. Stable sort keeps each group's order.
      matches.sort((a, b) => isProfessionalCareer(a.career) - isProfessionalCareer(b.career));
      setResults(matches);
      setSearching(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query, loaded, allCourses, subjectPrefixes]);

  // Filtered and cut to 20 at render time (not in the search effect) so the
  // toggle and draft changes don't re-run the debounced search, and hidden
  // courses don't use up the 20 slots. Draft courses always stay visible.
  const visibleResults = useMemo(() => {
    const shown =
      gateByCurrentTerm && onlyAvailable
        ? results.filter((c) => c.inCurrentTerm || draftCourseKeys.has(c.id))
        : results;
    return shown.slice(0, 20);
  }, [results, gateByCurrentTerm, onlyAvailable, draftCourseKeys]);

  // Typed before the catalog arrived: the paw stands in for "Searching…".
  const catalogLoaderVisible = useDelayedBusy(Boolean(query.trim()) && !loaded);
  const catalogWaiting = (Boolean(query.trim()) && !loaded) || catalogLoaderVisible;

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <h2>Add a Course</h2>
        <div className="search-input-wrap">
          <input
            className="search-input"
            type="text"
            placeholder="e.g. CAS CS 111 or Calculus"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Same update as the query, so the empty message can't flash
              // for a render before the debounced search starts.
              if (e.target.value.trim()) setSearching(true);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {gateByCurrentTerm && (
          <div className="search-sem-target">
            <div
              className="hub-year-toggle-group"
              role="group"
              aria-label="Filter courses by term offering"
              style={{ flex: 1, marginBottom: 0 }}
            >
              <button
                type="button"
                className={`hub-year-toggle-btn${onlyAvailable ? ' active' : ''}`}
                aria-pressed={onlyAvailable}
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => setOnlyAvailable(true)}
                title={`Only courses offered ${CURRENT_TERM_LABEL}`}
              >
                {CURRENT_TERM_LABEL}
              </button>
              <button
                type="button"
                className={`hub-year-toggle-btn${onlyAvailable ? '' : ' active'}`}
                aria-pressed={!onlyAvailable}
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => setOnlyAvailable(false)}
                title="Show every course, including ones with no sections"
              >
                All
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="search-results">
        {catalogWaiting ? (
          <div className="search-loading" role="status" aria-busy="true">
            {catalogLoaderVisible && <PawLoader size="small" theme={theme} label="Loading courses…" />}
          </div>
        ) : searching && <div className="search-loading">Searching…</div>}

        {!searching && !catalogWaiting && query.trim() && loadFailed && (
          <div className="search-empty" role="alert">Couldn&apos;t load courses. Reload to try again.</div>
        )}

        {!searching && !catalogWaiting && !loadFailed && query.trim() && visibleResults.length === 0 && (
          <div className="search-empty">
            No courses found for &ldquo;{query.trim()}&rdquo;
          </div>
        )}

        {!searching && !query.trim() && (
          <div className="search-empty">
            <img
              className="search-empty-paw"
              src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
              alt="TerrierPlan paw logo"
              width={28}
              height={28}
            />
            Search by course code or name, then add it to build your schedule.
          </div>
        )}

        {!catalogWaiting && visibleResults.map((course) => (
          <SchedulerCourseRow
            key={course.id}
            courseKey={course.id}
            course={course}
            added={draftCourseKeys.has(course.id)}
            noCurrentTerm={gateByCurrentTerm && !course.inCurrentTerm}
            showCatalogFlags
            onAdd={onAddCourse}
            onShowInfo={onShowCourseInfo}
          />
        ))}
      </div>
    </div>
  );
}
