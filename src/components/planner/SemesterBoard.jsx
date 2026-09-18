import SemesterColumn from './SemesterColumn';
import { getSemesterStatus, isSummerTarget, summerYearFromTarget } from '../../utils/courseEntry';
import { semesterLabel } from '../../utils/hubConstants';

// Target encoding shared with PlannerPage: a plain number is a grid slot
// index (Fall/Spring), the string `summer:{year}` is that year's optional
// Summer slot. Kept as a string rather than an object so it can sit directly
// in <select>/dnd-kit ids without extra (de)serialization.
function summerTarget(year) {
  return `summer:${year}`;
}

export default function SemesterBoard({
  semesters,
  gridSummerTerms = {},
  courseMap,
  creditsMap,
  activeTarget,
  onSemesterClick,
  onRemoveCourse,
  onToggleLock,
  onToggleSemesterLock,
  onToggleSummerYear,
  onAddYear,
  draggingId,
  semesterOptions = [],
  currentSemesterTarget = null,
  onSetCurrentSemester,
  // Set<courseKey> — the student's own global "completed" list (shared
  // across every plan, see PlannerPage), not scoped to this board.
  completedCourseKeys,
}) {
  const yearCount = Math.max(4, Math.ceil(semesters.length / 2));
  const years = Array.from({ length: yearCount }, (_, i) => i);

  // currentSemesterTarget is global (shared across every plan — see
  // PlannerPage) while semesterOptions is built from *this* plan's own
  // semesters/gridSummerTerms, so the stored target may not resolve to any
  // option here (e.g. it points at a Summer column this plan never toggled
  // on, or one it removed, or a plan with fewer years). The chrono value
  // behind it is still perfectly valid — getSemesterStatus doesn't need the
  // column to exist — so rather than clearing the global marker just
  // because this one plan can't display it, synthesize one extra <option>
  // using the same label logic PlannerPage uses to build semesterOptions,
  // so the select still shows what's actually selected.
  const currentTargetInOptions = currentSemesterTarget != null
    && semesterOptions.some((opt) => opt.value === currentSemesterTarget);
  const unresolvedCurrentOption = currentSemesterTarget != null && !currentTargetInOptions
    ? {
        value: currentSemesterTarget,
        label: `${
          isSummerTarget(currentSemesterTarget)
            ? `Year ${Number(summerYearFromTarget(currentSemesterTarget)) + 1} – Summer`
            : semesterLabel(currentSemesterTarget)
        } (not in this plan)`,
      }
    : null;
  const displayedSemesterOptions = unresolvedCurrentOption
    ? [...semesterOptions, unresolvedCurrentOption]
    : semesterOptions;

  return (
    <div className="semester-board">
      {/* Lets a student mark where they actually are in the program — shared
          across every plan of theirs, not just this one. Every course in a
          semester chronologically before it auto-locks as completed (same
          per-course lock as CourseCard's own button, and each semester's
          header has its own lock/unlock-all toggle too), so nothing here is
          a one-way door. Purely a self-report; nothing here enforces which
          courses "should" be done by when. */}
      <div className="current-semester-control">
        <label htmlFor="current-semester-select">I am currently in</label>
        <select
          id="current-semester-select"
          className="search-sem-select"
          value={currentSemesterTarget ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onSetCurrentSemester(currentSemesterTarget);
              return;
            }
            onSetCurrentSemester(/^\d+$/.test(raw) ? Number(raw) : raw);
          }}
        >
          <option value="">Not set</option>
          {displayedSemesterOptions.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {years.map((year) => {
        const fallIndex = year * 2;
        const springIndex = year * 2 + 1;
        const hasSummer = Object.prototype.hasOwnProperty.call(gridSummerTerms, year);
        const summerCourses = gridSummerTerms[year] || [];
        const fallStatus = getSemesterStatus(fallIndex, currentSemesterTarget);
        const springStatus = getSemesterStatus(springIndex, currentSemesterTarget);
        const summerStatus = hasSummer
          ? getSemesterStatus(summerTarget(year), currentSemesterTarget)
          : null;

        return (
          <div key={year} className="year-row">
            <div className="year-label">Year {year + 1}</div>
            <div className="year-semesters">
              <SemesterColumn
                dropId={`col-${fallIndex}`}
                label="Fall"
                season="fall"
                courses={semesters[fallIndex] || []}
                courseMap={courseMap}
                creditsMap={creditsMap}
                isActive={activeTarget === fallIndex}
                onColumnClick={() => onSemesterClick(fallIndex)}
                onRemoveCourse={(key) => onRemoveCourse(key, fallIndex)}
                onToggleLock={onToggleLock}
                onToggleSemesterLock={() => onToggleSemesterLock(fallIndex)}
                draggingId={draggingId}
                status={fallStatus}
                completedCourseKeys={completedCourseKeys}
              />
              <SemesterColumn
                dropId={`col-${springIndex}`}
                label="Spring"
                season="spring"
                courses={semesters[springIndex] || []}
                courseMap={courseMap}
                creditsMap={creditsMap}
                isActive={activeTarget === springIndex}
                onColumnClick={() => onSemesterClick(springIndex)}
                onRemoveCourse={(key) => onRemoveCourse(key, springIndex)}
                onToggleLock={onToggleLock}
                onToggleSemesterLock={() => onToggleSemesterLock(springIndex)}
                draggingId={draggingId}
                status={springStatus}
                completedCourseKeys={completedCourseKeys}
              />
              {hasSummer ? (
                <SemesterColumn
                  dropId={`col-summer-${year}`}
                  label="Summer"
                  season="summer"
                  courses={summerCourses}
                  courseMap={courseMap}
                  creditsMap={creditsMap}
                  isActive={activeTarget === summerTarget(year)}
                  onColumnClick={() => onSemesterClick(summerTarget(year))}
                  onRemoveCourse={(key) => onRemoveCourse(key, summerTarget(year))}
                  onToggleLock={onToggleLock}
                  onToggleSemesterLock={() => onToggleSemesterLock(summerTarget(year))}
                  onRemoveColumn={
                    summerCourses.length === 0
                      ? () => onToggleSummerYear(year, false)
                      : undefined
                  }
                  draggingId={draggingId}
                  status={summerStatus}
                  completedCourseKeys={completedCourseKeys}
                />
              ) : (
                <button
                  type="button"
                  className="add-summer-term-btn"
                  onClick={() => onToggleSummerYear(year, true)}
                  title="Add a Summer term for this year"
                >
                  + Add Summer term
                </button>
              )}
            </div>
          </div>
        );
      })}

      <button type="button" className="add-year-btn" onClick={onAddYear}>
        + Add Year
      </button>
    </div>
  );
}
