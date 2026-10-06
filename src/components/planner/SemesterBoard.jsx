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
  onShowCourseInfo,
  onToggleSemesterLock,
  onToggleSummerYear,
  onAddYear,
  // "+ Add Year" is disabled once the plan has this many years; a plan
  // already past it (from before the cap existed) is shown as-is.
  maxYears = Infinity,
  onAddNote,
  onUpdateNote,
  onRemoveNote,
  draggingId,
  semesterOptions = [],
  currentSemesterTarget = null,
  onSetCurrentSemester,
  // Set<courseKey> — the student's own global "completed" list (shared
  // across every plan, see PlannerPage), not scoped to this board.
  completedCourseKeys,
  // { fulfilled, total } HUB progress + the handler that opens the full HUB
  // view (the same one the sidebar's button uses); the pill only shows when
  // both are given.
  hubSummary = null,
  onOpenHubFullView,
  // "All semesters" overview (desktop only): years as columns, compact cards.
  // onBoardViewChange is undefined on narrow screens, which hides the toggle.
  overview = false,
  boardView = 'detailed',
  onBoardViewChange,
}) {
  const yearCount = Math.max(4, Math.ceil(semesters.length / 2));
  const years = Array.from({ length: yearCount }, (_, i) => i);
  const atYearCap = yearCount >= maxYears;

  // Note handlers bound to one slot target (see handleAddNote & co. in
  // PlannerPage) — notes are matched by their own id, never courseKey.
  function noteProps(target) {
    return {
      onAddNote: () => onAddNote(target),
      onUpdateNote: (noteId, patch) => onUpdateNote(noteId, target, patch),
      onRemoveNote: (noteId) => onRemoveNote(noteId, target),
    };
  }

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
    <div className={`semester-board${overview ? ' is-overview' : ''}`}>
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
        {onBoardViewChange && (
          <div className="board-view-toggle" role="group" aria-label="Board view">
            <button
              type="button"
              className={boardView === 'detailed' ? 'is-on' : ''}
              aria-pressed={boardView === 'detailed'}
              onClick={() => onBoardViewChange('detailed')}
            >
              Detailed
            </button>
            <button
              type="button"
              className={boardView === 'overview' ? 'is-on' : ''}
              aria-pressed={boardView === 'overview'}
              onClick={() => onBoardViewChange('overview')}
            >
              All semesters
            </button>
          </div>
        )}
        {hubSummary && onOpenHubFullView && (
          <button
            type="button"
            className={`hub-tracker-pill${hubSummary.fulfilled < hubSummary.total ? ' is-incomplete' : ''}`}
            onClick={onOpenHubFullView}
            title="Open HUB tracker & course finder"
            aria-label={`Open HUB tracker and course finder: ${hubSummary.fulfilled} of ${hubSummary.total} units complete`}
          >
            <span className="hub-tracker-pill-label">
              HUB <span className="hub-tracker-pill-count">{hubSummary.fulfilled}/{hubSummary.total}</span>
            </span>
            <span className="hub-tracker-pill-find">Find<span className="hub-tracker-pill-find-more"> courses</span></span>
            <span className="hub-tracker-pill-icon" aria-hidden="true">⤢</span>
          </button>
        )}
      </div>

      <div className={overview ? 'overview-grid' : 'board-years'}>
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
          <div key={year} className={overview ? 'overview-year' : 'year-row'}>
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
                onShowCourseInfo={onShowCourseInfo}
                onToggleSemesterLock={() => onToggleSemesterLock(fallIndex)}
                {...noteProps(fallIndex)}
                draggingId={draggingId}
                status={fallStatus}
                completedCourseKeys={completedCourseKeys}
                compact={overview}
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
                onShowCourseInfo={onShowCourseInfo}
                onToggleSemesterLock={() => onToggleSemesterLock(springIndex)}
                {...noteProps(springIndex)}
                draggingId={draggingId}
                status={springStatus}
                completedCourseKeys={completedCourseKeys}
                compact={overview}
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
                  onShowCourseInfo={onShowCourseInfo}
                  onToggleSemesterLock={() => onToggleSemesterLock(summerTarget(year))}
                  {...noteProps(summerTarget(year))}
                  onRemoveColumn={
                    summerCourses.length === 0
                      ? () => onToggleSummerYear(year, false)
                      : undefined
                  }
                  draggingId={draggingId}
                  status={summerStatus}
                  completedCourseKeys={completedCourseKeys}
                  compact={overview}
                />
              ) : (
                <button
                  type="button"
                  className="add-summer-term-btn"
                  onClick={() => onToggleSummerYear(year, true)}
                  title="Add a Summer term for this year"
                >
                  {overview ? '+ Summer' : '+ Add Summer term'}
                </button>
              )}
            </div>
          </div>
        );
      })}
      </div>

      <button
        type="button"
        className="add-year-btn"
        onClick={onAddYear}
        disabled={atYearCap}
        title={atYearCap ? `Plans are capped at ${maxYears} years` : 'Add another year to this plan'}
      >
        + Add Year
      </button>
    </div>
  );
}
