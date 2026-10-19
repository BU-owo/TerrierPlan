import { HubUnitTags, MarineSemesterPill, OfferingBadge } from '../planner/CourseTags';
import { CURRENT_TERM_LABEL } from '../../utils/term';
import { isProfessionalCareer } from '../../utils/courseQuery';

// One course row in the scheduler's left panel — a div card like the
// planner's StashPanel cards (a <button> row can't hold the "i" button). Row
// click / Enter / Space adds to the draft; "+" and "i" are their own buttons.
// Added and dimmed rows go pointer-events: none; "i" opts back in
// (planner.css). Tag values come straight from the catalog entry (`course`),
// not the gated useUpcomingSeasons/useCurrentTermCourseKeys hooks, which wait
// on a catalog gate the scheduler never opens.
//
// `course` is the catalog entry or undefined (then the raw courseKey shows);
// `noCurrentTerm` dims the row with the "No … sections" badge; `planNames`,
// when non-empty, adds the All-plans chip line; `showCatalogFlags` adds the
// study-abroad and Law/Dental/Medical badges to the tags line (search rows).
export default function SchedulerCourseRow({
  courseKey,
  course,
  added,
  noCurrentTerm,
  planNames = [],
  showCatalogFlags = false,
  onAdd,
  onShowInfo,
}) {
  const courseLabel = course?.courseNumber ?? courseKey;
  const blocked = added || noCurrentTerm;

  return (
    <div
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked || undefined}
      className={[
        'search-result-card',
        'sched-search-result',
        added ? 'already-added' : '',
        noCurrentTerm && !added ? 'is-blocked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        if (!blocked) onAdd(courseKey);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        if (!blocked) onAdd(courseKey);
      }}
      title={
        added
          ? 'Already in your draft'
          : noCurrentTerm
            ? `No ${CURRENT_TERM_LABEL} sections`
            : 'Add to schedule draft'
      }
    >
      <div className="search-result-info">
        <div className="search-result-code">{courseLabel}</div>
        {course?.name && (
          <div className="search-result-name-row">
            <span className="search-result-name" title={course.name}>{course.name}</span>
          </div>
        )}
        {planNames.length > 0 && (
          <div className="sched-row-plan-line">
            <span className="offering-badge offering-badge-neutral sched-row-plan-chip" title={planNames.join(', ')}>
              {planNames.length === 1 ? planNames[0] : `${planNames.length} plans`}
            </span>
          </div>
        )}
        <div className="search-result-hub">
          <HubUnitTags units={course?.hubUnits} />
          <MarineSemesterPill courseKey={courseKey} />
          <OfferingBadge
            offeringPattern={course?.offeringPattern}
            upcomingSeasons={course?.upcomingSeasons}
            inCurrentTerm={Boolean(course?.inCurrentTerm)}
          />
          {showCatalogFlags && course?.studyAbroad && (
            <span className="offering-badge offering-badge-abroad">Study abroad</span>
          )}
          {showCatalogFlags && isProfessionalCareer(course?.career) && (
            <span className="offering-badge offering-badge-career">{course.career}</span>
          )}
        </div>
        {noCurrentTerm && !added && (
          <div className="sched-search-no-term">
            <span className="offering-badge offering-badge-neutral">No {CURRENT_TERM_LABEL} sections</span>
          </div>
        )}
      </div>
      <div className="search-result-actions">
        <button
          type="button"
          className="sched-row-add-btn"
          tabIndex={-1}
          disabled={blocked}
          onClick={(e) => {
            e.stopPropagation();
            onAdd(courseKey);
          }}
          aria-label={added ? `${courseLabel} is in your draft` : `Add ${courseLabel} to schedule draft`}
        >
          {added ? '✓' : '+'}
        </button>
        <button
          type="button"
          className="search-result-info-btn"
          onClick={(e) => {
            e.stopPropagation();
            onShowInfo(courseKey);
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
