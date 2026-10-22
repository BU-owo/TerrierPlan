import SemesterColumn from './SemesterColumn';
import StartTermSelect from './StartTermSelect';
import {
  getSlotStatus, isBeforeStartTerm, isSummerTarget, showsCurrentSemesterSelect, summerYearFromTarget,
} from '../../utils/courseEntry';
import { semesterLabel } from '../../utils/hubConstants';
import { termFromSlot, termLabel } from '../../utils/term';
import { hubProgressText } from '../../utils/completion';

// Target encoding shared with PlannerPage: a plain number is a grid slot
// index (Fall/Spring), the string `summer:{year}` is that year's optional
// Summer slot. Kept as a string rather than an object so it can sit directly
// in <select>/dnd-kit ids without extra (de)serialization.
function summerTarget(year) {
  return `summer:${year}`;
}

export default function SemesterBoard({
  // True for a plan with no courses: shows the one-line "search, then drag" cue.
  isEmpty = false,
  // Optional one-time hint shown right under the "I am currently in" / HUB row.
  controlsHint = null,
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
  // Shown on the last year only, and only past Year 4.
  onRemoveYear,
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
  // Valid Fall/Spring start-term code or null. When set, it (with `today`)
  // decides every column's status and replaces the "I am currently in"
  // select; see getSlotStatus.
  startTerm = null,
  today,
  onSetStartTerm,
  onClearStartTerm,
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

  // Card/header lock controls for one slot: the per-card and per-semester
  // locks without a start term (legacy, unchanged); none with one.
  function lockProps(target) {
    if (startTerm) return {};
    return { onToggleLock, onToggleSemesterLock: () => onToggleSemesterLock(target) };
  }
  const slotStatus =(target) => getSlotStatus(target, { startTerm, currentSemesterTarget, today });
  // "Fall 2024" once a start term is set, else the plain season.
  function slotLabel(target, season) {
    const code = startTerm ? termFromSlot(startTerm, target) : null;
    return code ? termLabel(code) : season;
  }

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
        {startTerm ? (
          <>
            <label htmlFor="start-term-select">Started:</label>
            <StartTermSelect
              id="start-term-select"
              value={startTerm}
              today={today}
              onChange={onSetStartTerm}
            />
            <button type="button" className="start-term-link" onClick={onClearStartTerm}>Clear</button>
          </>
        ) : !showsCurrentSemesterSelect(startTerm, currentSemesterTarget) ? (
          <>
            <label htmlFor="start-term-select">When did you start at BU?</label>
            <StartTermSelect
              id="start-term-select"
              today={today}
              placeholder="Select term"
              onChange={onSetStartTerm}
            />
          </>
        ) : (
          <>
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
            {/* Nudges old-select users to a start term. Switching changes
                how statuses work, so it asks first; Cancel leaves the select
                on its placeholder and nothing else changes. */}
            <label htmlFor="legacy-start-term-select">Start term</label>
            <StartTermSelect
              id="legacy-start-term-select"
              today={today}
              placeholder="Set start term"
              onChange={(code) => {
                if (window.confirm('Switch to your start term? Completed vs planned will follow the calendar, and the lock buttons go away.')) {
                  onSetStartTerm(code);
                }
              }}
            />
            <span className="start-term-helper">Set this and past semesters mark themselves complete. No more locking.</span>
          </>
        )}
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
            aria-label={`Open HUB tracker and course finder: ${hubProgressText(hubSummary, { hubWord: false })}`}
          >
            <span className="hub-tracker-pill-label">
              HUB <span className="hub-tracker-pill-count">{hubSummary.fulfilled}/{hubSummary.total}</span>
            </span>
            <span className="hub-tracker-pill-find">Find<span className="hub-tracker-pill-find-more"> courses</span></span>
            <span className="hub-tracker-pill-icon" aria-hidden="true">⤢</span>
          </button>
        )}
      </div>

      {controlsHint}

      {isEmpty && (
        <div className="search-empty board-empty-hint">
          <span className="board-empty-wide">
            <span className="board-empty-arrow" aria-hidden="true">←</span>
            Search a course, then drag it into a semester.
          </span>
          <span className="board-empty-narrow">
            <span className="board-empty-arrow" aria-hidden="true">↓</span>
            Search a course, then add it to a semester.
          </span>
        </div>
      )}

      <div className={overview ? 'overview-grid' : 'board-years'}>
      {years.map((year) => {
        const fallIndex = year * 2;
        const springIndex = year * 2 + 1;
        const hasSummer = Object.prototype.hasOwnProperty.call(gridSummerTerms, year);
        const summerCourses = gridSummerTerms[year] || [];
        const fallStatus = slotStatus(fallIndex);
        const springStatus = slotStatus(springIndex);
        const summerStatus = hasSummer
          ? slotStatus(summerTarget(year))
          : null;

        return (
          <div key={year} className={overview ? 'overview-year' : 'year-row'}>
            <div className="year-label">
              Year {year + 1}
              {onRemoveYear && year >= 4 && year === yearCount - 1 && (
                <button
                  type="button"
                  className="year-remove-btn"
                  onClick={onRemoveYear}
                  title={`Remove Year ${year + 1}`}
                  aria-label={`Remove Year ${year + 1}`}
                >
                  ×
                </button>
              )}
            </div>
            <div className="year-semesters">
              <SemesterColumn
                dropId={`col-${fallIndex}`}
                target={fallIndex}
                label={slotLabel(fallIndex, 'Fall')}
                beforeStart={isBeforeStartTerm(fallIndex, startTerm)}
                season="fall"
                courses={semesters[fallIndex] || []}
                courseMap={courseMap}
                creditsMap={creditsMap}
                isActive={activeTarget === fallIndex}
                onColumnClick={() => onSemesterClick(fallIndex)}
                onRemoveCourse={(key) => onRemoveCourse(key, fallIndex)}
                onShowCourseInfo={onShowCourseInfo}
                {...lockProps(fallIndex)}
                {...noteProps(fallIndex)}
                draggingId={draggingId}
                status={fallStatus}
                completedCourseKeys={completedCourseKeys}
                compact={overview}
              />
              <SemesterColumn
                dropId={`col-${springIndex}`}
                target={springIndex}
                label={slotLabel(springIndex, 'Spring')}
                season="spring"
                courses={semesters[springIndex] || []}
                courseMap={courseMap}
                creditsMap={creditsMap}
                isActive={activeTarget === springIndex}
                onColumnClick={() => onSemesterClick(springIndex)}
                onRemoveCourse={(key) => onRemoveCourse(key, springIndex)}
                onShowCourseInfo={onShowCourseInfo}
                {...lockProps(springIndex)}
                {...noteProps(springIndex)}
                draggingId={draggingId}
                status={springStatus}
                completedCourseKeys={completedCourseKeys}
                compact={overview}
              />
              {hasSummer ? (
                <SemesterColumn
                  dropId={`col-summer-${year}`}
                  target={summerTarget(year)}
                  label={slotLabel(summerTarget(year), 'Summer')}
                  season="summer"
                  courses={summerCourses}
                  courseMap={courseMap}
                  creditsMap={creditsMap}
                  isActive={activeTarget === summerTarget(year)}
                  onColumnClick={() => onSemesterClick(summerTarget(year))}
                  onRemoveCourse={(key) => onRemoveCourse(key, summerTarget(year))}
                  onShowCourseInfo={onShowCourseInfo}
                  {...lockProps(summerTarget(year))}
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
                  aria-label="Add summer term"
                >
                  <span className="add-summer-term-label">+ Summer</span>
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
