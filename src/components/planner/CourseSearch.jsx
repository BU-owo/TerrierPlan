import { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  orderBy,
  startAt,
  endAt,
  limit,
  getDocs,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { HUB_COLOR_FOR, SEMESTER_LABELS } from '../../utils/hubConstants';

export default function CourseSearch({
  activeSemIndex,
  onActiveSemChange,
  coursesInPlan,
  onAddCourse,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const term = searchQuery.trim();

    if (!term) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const merged = new Map();

        // Query 1: courseNumber prefix (e.g. "CAS CS")
        const upper = term.toUpperCase();
        const q1 = query(
          collection(db, 'courses'),
          orderBy('courseNumber'),
          startAt(upper),
          endAt(upper + '\uf8ff'),
          limit(15),
        );
        const s1 = await getDocs(q1);
        s1.docs.forEach((d) => merged.set(d.id, { id: d.id, ...d.data() }));

        // Query 2: name prefix (title-cased, e.g. "Calculus")
        const titled =
          term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();
        const q2 = query(
          collection(db, 'courses'),
          orderBy('name'),
          startAt(titled),
          endAt(titled + '\uf8ff'),
          limit(15),
        );
        const s2 = await getDocs(q2);
        s2.docs.forEach((d) => {
          if (!merged.has(d.id)) merged.set(d.id, { id: d.id, ...d.data() });
        });

        setResults(Array.from(merged.values()).slice(0, 20));
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <h2>Add Course</h2>
        <div className="search-input-wrap">
          <span className="search-input-icon">🔍</span>
          <input
            className="search-input"
            type="text"
            placeholder="e.g. CAS CS 111 or Calculus"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="search-sem-target">
          <label htmlFor="sem-target">Add to</label>
          <select
            id="sem-target"
            className="search-sem-select"
            value={activeSemIndex}
            onChange={(e) => onActiveSemChange(Number(e.target.value))}
          >
            {SEMESTER_LABELS.map((label, i) => (
              <option key={i} value={i}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="search-results">
        {loading && <div className="search-loading">Searching…</div>}

        {!loading && searchQuery.trim() && results.length === 0 && (
          <div className="search-empty">
            <div className="search-empty-paw">🐾</div>
            No courses found for &ldquo;{searchQuery.trim()}&rdquo;
            <div className="search-hint">
              Try a course code like &ldquo;CAS CS 111&rdquo; or a name prefix
              like &ldquo;Calculus&rdquo;
            </div>
          </div>
        )}

        {!loading && !searchQuery.trim() && (
          <div className="search-empty">
            <div className="search-empty-paw">🐾</div>
            Search by course code or name, then click&nbsp;+ to add it to the
            selected semester.
          </div>
        )}

        {results.map((course) => {
          const alreadyAdded = coursesInPlan.has(course.id);
          return (
            <div
              key={course.id}
              className={`search-result-card${alreadyAdded ? ' already-added' : ''}`}
              title={alreadyAdded ? 'Already in your plan' : undefined}
            >
              <div className="search-result-info">
                <div className="search-result-code">
                  {course.courseNumber ?? course.id}
                </div>
                <div className="search-result-name">{course.name ?? '—'}</div>
                {course.hubUnits?.length > 0 && (
                  <div className="search-result-hub">
                    {course.hubUnits.slice(0, 4).map((unit) => (
                      <span
                        key={unit}
                        className={`hub-chip hub-chip-${HUB_COLOR_FOR[unit] ?? 'def'}`}
                      >
                        {unit}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {!alreadyAdded && (
                <button
                  className="search-result-add"
                  onClick={() => onAddCourse(course.id, activeSemIndex)}
                  aria-label={`Add ${course.courseNumber ?? course.id}`}
                >
                  +
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
