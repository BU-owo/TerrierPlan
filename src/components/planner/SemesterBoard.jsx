import SemesterColumn from './SemesterColumn';

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
  onToggleSummerYear,
  onAddYear,
  draggingId,
}) {
  const yearCount = Math.max(4, Math.ceil(semesters.length / 2));
  const years = Array.from({ length: yearCount }, (_, i) => i);

  return (
    <div className="semester-board">
      {years.map((year) => {
        const fallIndex = year * 2;
        const springIndex = year * 2 + 1;
        const hasSummer = Object.prototype.hasOwnProperty.call(gridSummerTerms, year);
        const summerCourses = gridSummerTerms[year] || [];

        return (
          <div key={year} className="year-row">
            <div className="year-label">Year {year + 1}</div>
            <div className="year-semesters">
              <SemesterColumn
                dropId={`col-${fallIndex}`}
                label="Fall"
                courses={semesters[fallIndex] || []}
                courseMap={courseMap}
                creditsMap={creditsMap}
                isActive={activeTarget === fallIndex}
                onColumnClick={() => onSemesterClick(fallIndex)}
                onRemoveCourse={(key) => onRemoveCourse(key, fallIndex)}
                onToggleLock={(key) => onToggleLock(key, fallIndex)}
                draggingId={draggingId}
              />
              <SemesterColumn
                dropId={`col-${springIndex}`}
                label="Spring"
                courses={semesters[springIndex] || []}
                courseMap={courseMap}
                creditsMap={creditsMap}
                isActive={activeTarget === springIndex}
                onColumnClick={() => onSemesterClick(springIndex)}
                onRemoveCourse={(key) => onRemoveCourse(key, springIndex)}
                onToggleLock={(key) => onToggleLock(key, springIndex)}
                draggingId={draggingId}
              />
              {hasSummer ? (
                <SemesterColumn
                  dropId={`col-summer-${year}`}
                  label="Summer"
                  courses={summerCourses}
                  courseMap={courseMap}
                  creditsMap={creditsMap}
                  isActive={activeTarget === summerTarget(year)}
                  onColumnClick={() => onSemesterClick(summerTarget(year))}
                  onRemoveCourse={(key) => onRemoveCourse(key, summerTarget(year))}
                  onToggleLock={(key) => onToggleLock(key, summerTarget(year))}
                  onRemoveColumn={
                    summerCourses.length === 0
                      ? () => onToggleSummerYear(year, false)
                      : undefined
                  }
                  draggingId={draggingId}
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
