import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { normalizeCourseKey, parseCourseKey } from '../../utils/courseKey';

// Left panel: add a course to the schedule draft. Same normalization/
// subject-prefix approach as the Planner's CourseSearch (courseKey.js is
// the shared piece — see that component for the fuller version with HUB
// filters and drag-and-drop, neither of which matters here). HUB filtering
// is planner-specific (degree requirements), not relevant when the goal is
// just "which sections can I take this term."
export default function SchedulerSearch({ draftCourseKeys, onAddCourse }) {
  const [query, setQuery] = useState('');
  const [allCourses, setAllCourses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef(null);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    getDocs(collection(db, 'courses'))
      .then((snap) => setAllCourses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((err) => console.error('Failed to load courses:', err))
      .finally(() => setLoaded(true));
  }, []);

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
          .sort((a, b) => (parseCourseKey(a.id)?.number ?? 0) - (parseCourseKey(b.id)?.number ?? 0));
      } else {
        matches = allCourses.filter((c) => {
          const normalizedCourseNum = normalizeCourseKey(c.courseNumber || '');
          const normalizedCourseName = (c.name || '').toUpperCase();
          return normalizedCourseNum.includes(normalizedQuery) || normalizedCourseName.includes(normalizedQuery);
        });
      }
      setResults(matches.slice(0, 20));
      setSearching(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query, loaded, allCourses, subjectPrefixes]);

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
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="search-results">
        {searching && <div className="search-loading">Searching…</div>}

        {!searching && query.trim() && results.length === 0 && (
          <div className="search-empty">
            No courses found for &ldquo;{query.trim()}&rdquo;
          </div>
        )}

        {!searching && !query.trim() && (
          <div className="search-empty">
            Search by course code or name, then add it to build your schedule.
          </div>
        )}

        {results.map((course) => {
          const added = draftCourseKeys.has(course.id);
          return (
            <button
              type="button"
              key={course.id}
              className={`search-result-card sched-search-result${added ? ' already-added' : ''}`}
              disabled={added}
              onClick={() => onAddCourse(course.id)}
              title={added ? 'Already in your draft' : 'Add to schedule draft'}
            >
              <div className="search-result-info">
                <div className="search-result-code">{course.courseNumber ?? course.id}</div>
                <div className="search-result-name-row">
                  <span className="search-result-name">{course.name ?? '—'}</span>
                </div>
              </div>
              <span className="sched-search-add-icon" aria-hidden="true">{added ? '✓' : '+'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
