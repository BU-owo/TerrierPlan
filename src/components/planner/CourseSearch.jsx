import { useState, useEffect, useRef } from 'react';
import { collection, getDocs } from 'firebase/firestore';
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
  const [selectedCourseForPicker, setSelectedCourseForPicker] = useState(null);
  const [allCourses, setAllCourses] = useState([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const debounceRef = useRef(null);

  // Load all courses once on first mount
  useEffect(() => {
    const loadAllCourses = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'courses'));
        const courses = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAllCourses(courses);
        setCoursesLoaded(true);
      } catch (err) {
        console.error('Failed to load courses:', err);
        setCoursesLoaded(true); // Still mark as loaded even on error
      }
    };

    loadAllCourses();
  }, []);

  // Filter courses client-side on keystroke
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const term = searchQuery.trim();

    if (!term) {
      setResults([]);
      return;
    }

    // Don't search until courses are loaded
    if (!coursesLoaded) {
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);

      // Normalize query: strip spaces, uppercase
      const normalizedQuery = term.replace(/\s+/g, '').toUpperCase();

      // Filter in-memory using substring matching
      const matches = allCourses.filter((course) => {
        const normalizedCourseNum = (course.courseNumber || '')
          .replace(/\s+/g, '')
          .toUpperCase();
        const normalizedCourseName = (course.name || '').toUpperCase();

        return (
          normalizedCourseNum.includes(normalizedQuery) ||
          normalizedCourseName.includes(normalizedQuery)
        );
      });

      setResults(matches.slice(0, 20));
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, coursesLoaded, allCourses]);

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
            Search by course code or name, then click a result to add it to a
            semester.
          </div>
        )}

        {results.map((course) => {
          const alreadyAdded = coursesInPlan.has(course.id);
          return (
            <div
              key={course.id}
              className={`search-result-card${alreadyAdded ? ' already-added' : ''}`}
              title={
                alreadyAdded
                  ? 'Already in your plan'
                  : 'Click to add to a semester or drag to a semester column'
              }
              onClick={() => {
                if (!alreadyAdded) {
                  // If a semester is focused/selected, auto-add directly
                  if (activeSemIndex !== undefined && activeSemIndex !== null) {
                    onAddCourse(course.id, activeSemIndex);
                  } else {
                    // Otherwise, show picker modal for user to select semester
                    setSelectedCourseForPicker(course);
                  }
                }
              }}
              style={{ cursor: alreadyAdded ? 'default' : 'pointer' }}
              draggable={!alreadyAdded}
              onDragStart={(e) => {
                if (alreadyAdded) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('courseId', course.id);
              }}
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
                        className={`hub-chip hub-chip-${
                          HUB_COLOR_FOR[unit]?.groupId ?? 'def'
                        }`}
                      >
                        {unit}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Semester picker modal */}
        {selectedCourseForPicker && (
          <div className="search-picker-overlay" onClick={() => setSelectedCourseForPicker(null)}>
            <div
              className="search-picker-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="search-picker-header">
                <h3>
                  Add to semester:{' '}
                  <span className="search-picker-course-code">
                    {selectedCourseForPicker.courseNumber ??
                      selectedCourseForPicker.id}
                  </span>
                </h3>
                <button
                  className="search-picker-close"
                  onClick={() => setSelectedCourseForPicker(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="search-picker-options">
                {SEMESTER_LABELS.map((label, i) => (
                  <button
                    key={i}
                    className="search-picker-option"
                    onClick={() => {
                      onAddCourse(selectedCourseForPicker.id, i);
                      setSelectedCourseForPicker(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
