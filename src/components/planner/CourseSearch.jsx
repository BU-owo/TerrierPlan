import { useState, useEffect, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { HUB_COLOR_FOR, SEMESTER_LABELS } from '../../utils/hubConstants';

const HUB_FILTER_CODES = [
  'PLM',
  'AEX',
  'HCO',
  'SI1',
  'SO1',
  'SI2',
  'SO2',
  'QR1',
  'QR2',
  'IIC',
  'GCI',
  'ETR',
  'FYW',
  'WRI',
  'WIN',
  'OSC',
  'DME',
  'CRT',
  'RIL',
  'TWC',
  'CRI',
];

function HubFilterSelect({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const displayLabel =
    selected.length === 0
      ? 'All'
      : selected.length <= 3
        ? selected.join(', ')
        : `${selected.slice(0, 2).join(', ')} +${selected.length - 2}`;

  function toggleCode(code) {
    if (selected.includes(code)) {
      onChange(selected.filter((c) => c !== code));
    } else {
      onChange([...selected, code]);
    }
  }

  return (
    <div
      className="search-sem-target"
      ref={rootRef}
      style={{ position: 'relative', alignItems: 'flex-start' }}
    >
      <label htmlFor="hub-filter-trigger">Filter by HUB unit</label>
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <button
          type="button"
          id="hub-filter-trigger"
          className="search-sem-select"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{
            width: '100%',
            textAlign: 'left',
            cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayLabel}
        </button>

        {open && (
          <div
            role="listbox"
            aria-multiselectable="true"
            style={{
              position: 'absolute',
              zIndex: 40,
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              maxHeight: 220,
              overflowY: 'auto',
              background: 'var(--cream)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-xs)',
              padding: 4,
              boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(0,0,0,.12))',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px',
                fontSize: 12,
                color: 'var(--text)',
                cursor: 'pointer',
                borderRadius: 3,
              }}
            >
              <input
                type="checkbox"
                checked={selected.length === 0}
                onChange={() => onChange([])}
              />
              All
            </label>
            {HUB_FILTER_CODES.map((code) => (
              <label
                key={code}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  fontSize: 12,
                  color: 'var(--text)',
                  cursor: 'pointer',
                  borderRadius: 3,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(code)}
                  onChange={() => toggleCode(code)}
                />
                {code}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchResultCard({
  course,
  alreadyAdded,
  activeSemIndex,
  onAddCourse,
  onPickSemester,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `search-${course.id}`,
    data: { from: 'search', courseKey: course.id, course },
    disabled: alreadyAdded,
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        'search-result-card',
        alreadyAdded ? 'already-added' : '',
        isDragging ? 'is-dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={
        alreadyAdded
          ? 'Already in your plan'
          : 'Click to add to a semester or drag to a semester column'
      }
      onClick={() => {
        if (alreadyAdded) return;
        if (activeSemIndex !== undefined && activeSemIndex !== null) {
          onAddCourse(course.id, activeSemIndex);
        } else {
          onPickSemester(course);
        }
      }}
      {...(alreadyAdded ? {} : { ...attributes, ...listeners })}
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
}

export default function CourseSearch({
  activeSemIndex,
  onActiveSemChange,
  coursesInPlan,
  onAddCourse,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [hubFilters, setHubFilters] = useState([]);
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

  // Filter courses client-side on keystroke / HUB filter change
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const term = searchQuery.trim();
    const hasHubFilter = hubFilters.length > 0;

    if (!term && !hasHubFilter) {
      setResults([]);
      setLoading(false);
      return;
    }

    // Don't search until courses are loaded
    if (!coursesLoaded) {
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);

      // Normalize query: strip spaces, uppercase
      const normalizedQuery = term
        ? term.replace(/\s+/g, '').toUpperCase()
        : '';

      const matches = allCourses.filter((course) => {
        let textMatch = true;
        if (normalizedQuery) {
          const normalizedCourseNum = (course.courseNumber || '')
            .replace(/\s+/g, '')
            .toUpperCase();
          const normalizedCourseName = (course.name || '').toUpperCase();
          textMatch =
            normalizedCourseNum.includes(normalizedQuery) ||
            normalizedCourseName.includes(normalizedQuery);
        }

        let hubMatch = true;
        if (hasHubFilter) {
          const units = course.hubUnits ?? [];
          // OR: course matches if it has ANY of the selected HUB codes
          hubMatch = hubFilters.some((code) => units.includes(code));
        }

        return textMatch && hubMatch;
      });

      setResults(matches.slice(0, 20));
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, hubFilters, coursesLoaded, allCourses]);

  const hasActiveQuery = Boolean(searchQuery.trim()) || hubFilters.length > 0;

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
        <HubFilterSelect selected={hubFilters} onChange={setHubFilters} />
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

        {!loading && hasActiveQuery && results.length === 0 && (
          <div className="search-empty">
            <img
              className="search-empty-paw"
              src="/faviconlight.png"
              alt="TerrierPlan"
              width={28}
              height={28}
            />
            {searchQuery.trim()
              ? <>No courses found for &ldquo;{searchQuery.trim()}&rdquo;</>
              : 'No courses found for the selected HUB units'}
            <div className="search-hint">
              Try a course code like &ldquo;CAS CS 111&rdquo;, a name prefix
              like &ldquo;Calculus&rdquo;, or a different HUB filter
            </div>
          </div>
        )}

        {!loading && !hasActiveQuery && (
          <div className="search-empty">
            <img
              className="search-empty-paw"
              src="/faviconlight.png"
              alt="TerrierPlan"
              width={28}
              height={28}
            />
            Search by course code or name, then click a result to add it to a
            semester.
          </div>
        )}

        {results.map((course) => (
          <SearchResultCard
            key={course.id}
            course={course}
            alreadyAdded={coursesInPlan.has(course.id)}
            activeSemIndex={activeSemIndex}
            onAddCourse={onAddCourse}
            onPickSemester={setSelectedCourseForPicker}
          />
        ))}

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
