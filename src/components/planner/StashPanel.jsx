import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { HUB_COLOR_FOR } from '../../utils/hubConstants';
import { getOfferingBadge } from '../../utils/offeringPattern';
import SemesterPickerModal from './SemesterPickerModal';
import useUpcomingSeasons from '../../hooks/useUpcomingSeasons';

// Reuses CourseSearch's result-card visual style AND its drag-and-drop
// wiring (same `useDraggable` shape, tagged `from: 'stash'` instead of
// `from: 'search'` — see PlannerPage's handleDragEnd, which treats the two
// identically: drop onto a semester column adds the course there, same as
// a click). Click-to-add-a-semester still works too — see .search-result-card.
function StashResultCard({
  course,
  alreadyAdded,
  activeSemIndex,
  onAddCourse,
  onPickSemester,
  onRemoveFromStash,
  onShowInfo,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `stash-${course.id}`,
    data: { from: 'stash', courseKey: course.id, course },
    disabled: alreadyAdded,
  });

  const upcomingSeasons = useUpcomingSeasons(course.id);
  const offeringBadge = getOfferingBadge(course.offeringPattern, upcomingSeasons);
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
        <div className="search-result-code">{courseLabel}</div>
        <div className="search-result-name-row">
          <span className="search-result-name">{course.name ?? '—'}</span>
          {offeringBadge && (
            <span className={`offering-badge ${offeringBadge.className}`} title={offeringBadge.text}>
              {offeringBadge.label}
            </span>
          )}
        </div>
        {course.hubUnits?.length > 0 && (
          <div className="search-result-hub">
            {course.hubUnits.slice(0, 4).map((unit) => (
              <span
                key={unit}
                className={`hub-chip hub-chip-${HUB_COLOR_FOR[unit]?.groupId ?? 'def'}`}
              >
                {unit}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Stacked like CourseSearch's result card — see the note there. */}
      <div className="search-result-actions">
        <button
          type="button"
          className="search-result-unstash-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemoveFromStash(course.id); }}
          aria-label={`Remove ${courseLabel} from Paw-tential Courses`}
          title="Remove from Paw-tential Courses"
        >
          ×
        </button>
        <button
          type="button"
          className="search-result-info-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onShowInfo(course.id); }}
          aria-label={`View details for ${courseLabel}`}
          title="Course details"
        >
          i
        </button>
      </div>
    </div>
  );
}

// The "Paw-tential Courses" tab (see SearchPanelTabs) — a saved-for-later
// list, separate from the planner grid. `stash` is just courseKey[]; course
// display data comes from the same courseMap PlannerPage already keeps
// populated (including a prefetch for stashed keys on plan load, so a
// reloaded plan doesn't show blank chips until the user searches again).
export default function StashPanel({
  theme = 'light',
  stash = [],
  courseMap = {},
  activeSemIndex,
  semesterOptions,
  coursesInPlan,
  onAddCourse,
  onRemoveFromStash,
  onShowCourseInfo,
}) {
  const [selectedCourseForPicker, setSelectedCourseForPicker] = useState(null);

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <h2>Paw-tential Courses</h2>
        <p className="stash-panel-hint">
          Save courses here while you browse, then add them to a semester whenever you're ready.
        </p>
      </div>

      <div className="search-results">
        {stash.length === 0 && (
          <div className="search-empty">
            <img
              className="search-empty-paw"
              src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
              alt="TerrierPlan"
              width={28}
              height={28}
            />
            Courses you might take. Tap the paw on any course to save it here.
            They don&apos;t count toward anything until you place them.
          </div>
        )}

        {stash.map((courseKey) => (
          <StashResultCard
            key={courseKey}
            course={{ id: courseKey, ...(courseMap[courseKey] || {}) }}
            alreadyAdded={coursesInPlan?.has(courseKey)}
            activeSemIndex={activeSemIndex}
            onAddCourse={onAddCourse}
            onPickSemester={setSelectedCourseForPicker}
            onRemoveFromStash={onRemoveFromStash}
            onShowInfo={onShowCourseInfo}
          />
        ))}

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
