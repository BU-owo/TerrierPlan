import { useState, useEffect, useMemo, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { HUB_COLOR_FOR } from '../../utils/hubConstants';
import { parseCourseKey } from '../../utils/courseKey';
import { getOfferingBadge } from '../../utils/offeringPattern';
import SemesterPickerModal from './SemesterPickerModal';

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
  isStashed,
  activeSemIndex,
  onAddCourse,
  onPickSemester,
  onAddToStash,
  onRemoveFromStash,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `search-${course.id}`,
    data: { from: 'search', courseKey: course.id, course },
    disabled: alreadyAdded,
  });

  const offeringBadge = getOfferingBadge(course.offeringPattern);
  const courseLabel = course.courseNumber ?? course.id;

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
        <div className="search-result-name-row">
          <span className="search-result-name">{course.name ?? '—'}</span>
          {offeringBadge && (
            <span className={`offering-badge ${offeringBadge.className}`}>
              {offeringBadge.label}
            </span>
          )}
        </div>
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
      {/* Secondary action, independent of the card's own add-to-planner
          click/drag — saves the course to the stash instead. Stops
          propagation so it never triggers the card's click or arms a drag. */}
      <button
        type="button"
        className={`search-result-stash-btn${isStashed ? ' is-stashed' : ''}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (isStashed) onRemoveFromStash(course.id);
          else onAddToStash(course.id);
        }}
        aria-label={isStashed ? `Remove ${courseLabel} from Paw-tential Courses` : `Add ${courseLabel} to Paw-tential Courses`}
        title={isStashed ? 'Remove from Paw-tential Courses' : 'Add to Paw-tential Courses'}
      >
        {isStashed ? '★' : '☆'}
      </button>
    </div>
  );
}

export default function CourseSearch({
  theme = 'light',
  activeSemIndex,
  onActiveSemChange,
  semesterOptions,
  coursesInPlan,
  onAddCourse,
  rangeFilter = null,
  onClearRangeFilter,
  stash = [],
  onAddToStash,
  onRemoveFromStash,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [hubFilters, setHubFilters] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedCourseForPicker, setSelectedCourseForPicker] = useState(null);
  const [allCourses, setAllCourses] = useState([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const debounceRef = useRef(null);

  // A fresh range filter (e.g. from "Browse eligible courses" in the
  // Requirements panel) replaces whatever the user was searching for, rather
  // than ANDing against stale text/HUB filters that would just hide it.
  useEffect(() => {
    if (rangeFilter) {
      setSearchQuery('');
      setHubFilters([]);
    }
  }, [rangeFilter]);

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

  // Filter courses client-side on keystroke / HUB filter / range filter change
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const term = searchQuery.trim();
    const hasHubFilter = hubFilters.length > 0;
    const hasRangeFilter = Boolean(rangeFilter);

    if (!term && !hasHubFilter && !hasRangeFilter) {
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
      const excludeSet = new Set(rangeFilter?.exclude ?? []);

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

        let rangeMatch = true;
        if (hasRangeFilter) {
          const parsed = parseCourseKey(course.id);
          rangeMatch =
            Boolean(parsed) &&
            parsed.subject === rangeFilter.subject &&
            parsed.number >= rangeFilter.min &&
            parsed.number <= rangeFilter.max &&
            !excludeSet.has(course.id);
        }

        return textMatch && hubMatch && rangeMatch;
      });

      setResults(matches.slice(0, 20));
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, hubFilters, rangeFilter, coursesLoaded, allCourses]);

  const hasActiveQuery = Boolean(searchQuery.trim()) || hubFilters.length > 0 || Boolean(rangeFilter);
  const stashSet = useMemo(() => new Set(stash), [stash]);

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <h2>Add Course</h2>
        <div className="search-input-wrap">
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
        {rangeFilter && (
          <div className="search-active-filter">
            <span>
              Showing {rangeFilter.subject} {rangeFilter.min}–{rangeFilter.max}
            </span>
            <button
              type="button"
              className="search-active-filter-clear"
              onClick={onClearRangeFilter}
              aria-label="Clear range filter"
              title="Clear range filter"
            >
              ×
            </button>
          </div>
        )}
        <HubFilterSelect selected={hubFilters} onChange={setHubFilters} />
        <div className="search-sem-target">
          <label htmlFor="sem-target">Add to</label>
          <select
            id="sem-target"
            className="search-sem-select"
            value={activeSemIndex}
            onChange={(e) => {
              const raw = e.target.value;
              // Grid slots are numeric values; a Summer slot's value is the
              // string "summer:{year}" and must pass through as-is.
              onActiveSemChange(/^\d+$/.test(raw) ? Number(raw) : raw);
            }}
          >
            {semesterOptions.map(({ value, label }) => (
              <option key={value} value={value}>
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
              src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
              alt="TerrierPlan"
              width={28}
              height={28}
            />
            {searchQuery.trim()
              ? <>No courses found for &ldquo;{searchQuery.trim()}&rdquo;</>
              : 'No courses found for the current filters'}
            <div className="search-hint">
              Try a course code like &ldquo;CAS CS 111&rdquo;, a name prefix
              like &ldquo;Calculus&rdquo;, or a different HUB/range filter
            </div>
          </div>
        )}

        {!loading && !hasActiveQuery && (
          <div className="search-empty">
            <img
              className="search-empty-paw"
              src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
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
            isStashed={stashSet.has(course.id)}
            activeSemIndex={activeSemIndex}
            onAddCourse={onAddCourse}
            onPickSemester={setSelectedCourseForPicker}
            onAddToStash={onAddToStash}
            onRemoveFromStash={onRemoveFromStash}
          />
        ))}

        {/* Semester picker modal */}
        <SemesterPickerModal
          course={selectedCourseForPicker}
          semesterOptions={semesterOptions}
          onPick={(target) => {
            onAddCourse(selectedCourseForPicker.id, target);
            setSelectedCourseForPicker(null);
          }}
          onClose={() => setSelectedCourseForPicker(null)}
        />
      </div>
    </div>
  );
}
