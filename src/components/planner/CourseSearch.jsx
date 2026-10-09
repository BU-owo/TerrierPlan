import { useState, useEffect, useMemo, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { HUB_COLOR_FOR } from '../../utils/hubConstants';
import { parseCourseKey, normalizeCourseKey, compareByCatalogNumber } from '../../utils/courseKey';
import {
  loadAllCoursesWhenRequested,
  requestCatalogLoad,
  isProfessionalCareer,
} from '../../utils/courseQuery';
import { getOfferingBadge } from '../../utils/offeringPattern';
import { aliasFor } from '../../utils/grsAlias';
import SemesterPickerModal from './SemesterPickerModal';

// Stash toggle glyph — filled paw = stashed, outline paw = not. `currentColor`
// so it inherits the button's own color (scarlet / stashed-amber / hover
// white — see .search-result-stash-btn in planner.css), same as the star
// glyphs it replaces, so dark mode needs no extra handling here.
export function PawIcon({ filled }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <ellipse cx="5.3" cy="10.1" rx="2.1" ry="2.6" />
      <ellipse cx="9.5" cy="5.9" rx="2.1" ry="2.7" />
      <ellipse cx="14.5" cy="5.9" rx="2.1" ry="2.7" />
      <ellipse cx="18.7" cy="10.1" rx="2.1" ry="2.6" />
      <path d="M12 12.4c-3.2 0-5.9 2.35-5.9 5.05 0 1.9 1.65 3 3.5 3 .9 0 1.55-.3 2.4-.3s1.5.3 2.4.3c1.85 0 3.5-1.1 3.5-3 0-2.7-2.7-5.05-5.9-5.05z" />
    </svg>
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
  onShowInfo,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `search-${course.id}`,
    data: { from: 'search', courseKey: course.id, course },
    disabled: alreadyAdded,
  });

  // Search results are the cached catalog's own entries, so upcomingSeasons
  // is already on them (absent on the Firestore fallback).
  const offeringBadge = getOfferingBadge(course.offeringPattern, course.upcomingSeasons);
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
            <span className={`offering-badge ${offeringBadge.className}`} title={offeringBadge.text}>
              {offeringBadge.label}
            </span>
          )}
          {course.studyAbroad && (
            <span className="offering-badge offering-badge-abroad">Study abroad</span>
          )}
          {isProfessionalCareer(course.career) && (
            <span className="offering-badge offering-badge-career">{course.career}</span>
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
      {/* Secondary actions, independent of the card's own add-to-planner
          click/drag. Stacked in a column (not side by side) so the narrow
          252px panel keeps its width for the course name. Each stops
          propagation so it never triggers the card's click or arms a drag. */}
      <div className="search-result-actions">
        <button
          type="button"
          className={`search-result-stash-btn${isStashed ? ' is-stashed' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (isStashed) onRemoveFromStash(course.id);
            else onAddToStash(course.id);
          }}
          aria-label={isStashed ? `Remove ${courseLabel} from Paw-tential Courses` : `Save ${courseLabel} to Paw-tential Courses (saved for later, not on your plan)`}
          title={isStashed ? 'Remove from Paw-tential Courses' : 'Save to Paw-tential Courses (saved for later, not on your plan)'}
        >
          <PawIcon filled={isStashed} />
        </button>
        <button
          type="button"
          className="search-result-info-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onShowInfo(course.id);
          }}
          aria-label={`View details for ${courseLabel}`}
          title="Course details"
        >
          i
        </button>
      </div>
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
  onShowCourseInfo,
  // Opens the full HUB tracker & course finder (PlannerPage's handler).
  onOpenHubFullView,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedCourseForPicker, setSelectedCourseForPicker] = useState(null);
  const [allCourses, setAllCourses] = useState([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  // { label, count } while a subject-prefix search ("CASCS", "CAS CS") is
  // active, so the results list can show "Showing all N CAS CS courses"
  // instead of a keyword-search list — see the filter effect below.
  const [subjectModeInfo, setSubjectModeInfo] = useState(null);
  const debounceRef = useRef(null);

  // Real subject prefixes present in the loaded catalog (e.g. "CASCS",
  // "ENGEK", "QSTMF") — derived from courseKey, not hardcoded, so it can't
  // drift from actual data. Used to decide whether a query "looks like" a
  // subject code rather than treating every short alpha query as one.
  // A GRS course that was renumbered into CAS is hidden here so only its CAS
  // twin shows (src/data/grsAliases.js). Plans and the info panel still open
  // the GRS key; searching the old GRS code finds the CAS course instead.
  const searchableCourses = useMemo(() => allCourses.filter((course) => !aliasFor(course.id)), [allCourses]);

  const subjectPrefixes = useMemo(() => {
    const set = new Set();
    for (const course of searchableCourses) {
      const parsed = parseCourseKey(course.id);
      if (parsed) set.add(parsed.subject);
    }
    return set;
  }, [searchableCourses]);

  // A fresh range filter (e.g. from "Browse eligible courses" in the
  // Requirements panel) replaces whatever the user was searching for, rather
  // than ANDing against stale text that would just hide it.
  useEffect(() => {
    if (rangeFilter) setSearchQuery('');
  }, [rangeFilter]);

  // Load all courses once — shared cache (see courseQuery.js) so this and
  // the HUB Tracker's department browse panel don't each open their own
  // Firestore read of the same collection. Subscribed on mount, but the
  // download itself waits for the catalog gate (see requestCatalogLoad) so
  // it doesn't hold up the signed-in plan load.
  useEffect(() => {
    let cancelled = false;
    loadAllCoursesWhenRequested()
      .then((courses) => {
        if (cancelled) return;
        setAllCourses(courses);
        setCoursesLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to load courses:', err);
        if (!cancelled) setCoursesLoaded(true); // Still mark as loaded even on error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter courses client-side on keystroke / range filter change
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const term = searchQuery.trim();
    const hasRangeFilter = Boolean(rangeFilter);

    if (!term && !hasRangeFilter) {
      setResults([]);
      setSubjectModeInfo(null);
      setLoading(false);
      return;
    }

    // Don't search until courses are loaded
    if (!coursesLoaded) {
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);

      // Normalize the same way courseKey itself is normalized (strip
      // spaces, uppercase) — reused here so "CAS CS", "cascs", and "CASCS"
      // all resolve identically.
      const typedQuery = term ? normalizeCourseKey(term) : '';
      const normalizedQuery = aliasFor(typedQuery) ?? typedQuery;
      const excludeSet = new Set(rangeFilter?.exclude ?? []);

      // Subject-prefix mode: the query, once normalized, IS a real subject
      // code from the loaded catalog (not just alpha-looking) — e.g.
      // "CASCS" for CAS CS, not an arbitrary short word. Guards against
      // hijacking ordinary short keyword searches.
      const isSubjectMode =
        Boolean(normalizedQuery) &&
        /^[A-Z]+$/.test(normalizedQuery) &&
        subjectPrefixes.has(normalizedQuery);

      let matches;
      if (isSubjectMode) {
        matches = searchableCourses
          .filter((course) => {
            if (!course.id.startsWith(normalizedQuery)) return false;

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

            return rangeMatch;
          })
          .sort(compareByCatalogNumber);
      } else {
        matches = searchableCourses.filter((course) => {
          let textMatch = true;
          if (normalizedQuery) {
            const normalizedCourseNum = normalizeCourseKey(course.courseNumber || '');
            const normalizedCourseName = (course.name || '').toUpperCase();
            textMatch =
              normalizedCourseNum.includes(normalizedQuery) ||
              normalizedCourseName.includes(normalizedQuery);
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

          return textMatch && rangeMatch;
        });
      }
      // Law/Dental/Medical courses (not open to undergrads) go after
      // everything else, before the keyword list is cut to 20. Stable sort,
      // so each group keeps the ordering above.
      matches.sort((a, b) => isProfessionalCareer(a.career) - isProfessionalCareer(b.career));

      if (isSubjectMode && matches.length > 0) {
        // Prefer the real, spaced display form ("CAS CS") over the bare
        // normalized query ("CASCS") — derived from an actual course's
        // courseNumber rather than guessed, so it matches however the
        // catalog actually spaces/labels that subject.
        const sampleLabel = (matches[0].courseNumber || normalizedQuery).replace(/\s*\d+\s*$/, '').trim();
        setSubjectModeInfo({ label: sampleLabel || normalizedQuery, count: matches.length });
        setResults(matches);
      } else {
        setSubjectModeInfo(null);
        setResults(matches.slice(0, 20));
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, rangeFilter, coursesLoaded, searchableCourses, subjectPrefixes]);

  const hasActiveQuery = Boolean(searchQuery.trim()) || Boolean(rangeFilter);
  const stashSet = useMemo(() => new Set(stash), [stash]);

  // A search started some other way than the search box (HUB filter, or
  // "Browse eligible courses" setting rangeFilter) needs the catalog now too.
  useEffect(() => {
    if (hasActiveQuery) requestCatalogLoad();
  }, [hasActiveQuery]);

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <h2>Add Course</h2>
        <div className="search-input-wrap">
          <input
            id="course-search-input"
            className="search-input"
            type="text"
            placeholder="e.g. CAS CS 111 or Calculus"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              // Same update as the query, so "No courses found" can't flash for
              // a render before the debounced search starts.
              if (e.target.value.trim() && coursesLoaded) setLoading(true);
            }}
            onFocus={requestCatalogLoad}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {onOpenHubFullView && (
          <button type="button" className="search-hub-finder-btn" onClick={onOpenHubFullView}>
            Find courses by HUB unit →
          </button>
        )}
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

        {/* The filter effect bails out until the catalog arrives, so without
            this an early search would read as "no results". */}
        {hasActiveQuery && !coursesLoaded && (
          <div className="search-loading" role="status">Loading courses…</div>
        )}

        {!loading && hasActiveQuery && coursesLoaded && results.length === 0 && (
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
              : 'No courses found for that range'}
            <div className="search-hint">
              Try a course code like &ldquo;CAS CS 111&rdquo; or a name prefix
              like &ldquo;Calculus&rdquo;
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

        {!loading && subjectModeInfo && results.length > 0 && (
          <div className="search-subject-mode-banner">
            Showing all {subjectModeInfo.count} {subjectModeInfo.label} course
            {subjectModeInfo.count === 1 ? '' : 's'}
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
            onShowInfo={onShowCourseInfo}
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
