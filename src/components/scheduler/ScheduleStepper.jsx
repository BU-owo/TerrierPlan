import { useId } from 'react';
import FlagIcon from './FlagIcon';
import PawLoader from '../PawLoader';
import useDelayedBusy from '../../hooks/useDelayedBusy';
import { overlapSummary, scheduleStats, SCHEDULE_SORT_OPTIONS } from '../../utils/scheduleCombos';

// The sort control only shows once there are at least this many schedules to
// order (the chosen sort still applies to the batch while it's hidden).
const MIN_SCHEDULES_TO_SORT = 6;

// "Fewest days" shows a note when even the best schedule spans this many weekdays.
const MIN_DAYS_FOR_NOTE = 5;

// Browses one generated schedule at a time — replaces an earlier "list of
// every combination" UI that either had to truncate the DOM or render
// hundreds/thousands of rows. Only the current index's sectionIds ever
// reach the grid, so the total combination count (however large) never
// costs more DOM than a single schedule's worth of blocks.
//
// Prev/Next/First/Last step through the generated results only. Bookmarks are
// browsed from the chip strip (see BookmarkedSchedulesPanel); `isBookmarked` here
// just drives the flag toggle for the schedule on screen.
//
// `sectionIds` (what the grid shows) drives the "N overlaps" note — counted
// from the schedule itself, so it's right even after a swap.
//
// `updating`: an automatic regenerate is running (see SchedulerPage) — a
// quiet note, the current schedule stays up meanwhile. `onEditManually`
// copies the schedule on screen into Manual mode.
export default function ScheduleStepper({
  generated,
  previewIndex,
  onJump,
  isBookmarked = false,
  onToggleBookmark,
  sectionIds = [],
  sectionsById = {},
  updating = false,
  onEditManually,
  sortValue = 'default',
  onSortChange,
  // A held schedule that isn't one of the results (a bookmark outside them): the same
  // row, with the stepping controls and Sort disabled, `heldLabel` for the status and
  // "Back to all results" (`onBack`) in a fixed spot, so the toolbar doesn't move.
  held = false,
  heldLabel = '',
  onBack,
}) {
  // Only after a noticeable wait, so a quick regenerate doesn't flash it.
  const updatingVisible = useDelayedBusy(updating);
  const sortId = useId();

  if (!generated || generated.schedules.length === 0 || (previewIndex == null && !held)) return null;

  const { schedules, truncated } = generated;
  const canSort = Boolean(onSortChange) && schedules.length >= MIN_SCHEDULES_TO_SORT;
  // Under "Fewest days" the batch is sorted, so schedules[0] has the fewest.
  const bestDays = canSort && sortValue === 'fewestDays' ? scheduleStats(schedules[0], sectionsById)?.days : null;
  const overlapCount = overlapSummary(sectionIds, sectionsById).pairs;

  const heldNote = "Steps through your results, not this bookmark";
  const firstDisabled = held || previewIndex === 0;
  const lastDisabled = held || previewIndex === schedules.length - 1;
  const prevDisabled = firstDisabled;
  const nextDisabled = lastDisabled;
  const goFirst = () => onJump(0);
  const goPrev = () => onJump(previewIndex - 1);
  const goNext = () => onJump(previewIndex + 1);
  const goLast = () => onJump(schedules.length - 1);
  const countLabel = `Schedule ${previewIndex + 1} of ${schedules.length}`;

  return (
    <div className="sched-stepper">
      <div className="sched-stepper-top">
        <div className="sched-stepper-count">
          {held ? (
            // Stacked with an invisible copy of the normal text, so the row is as tall as ever.
            <span className="sched-stepper-count-stack">
              <span>
                {heldLabel}
                {overlapCount > 0 && (
                  <>
                    {' · '}
                    <span className="sched-overlap-count">{overlapCount} overlap{overlapCount === 1 ? '' : 's'}</span>
                  </>
                )}
              </span>
              <span className="sched-stepper-count-ghost" aria-hidden="true">
                Schedule 1 of {schedules.length}
                {overlapCount > 0 && ` · ${overlapCount} overlap${overlapCount === 1 ? '' : 's'}`}
                {truncated && ' (stopped early — narrow your sections to see more)'}
              </span>
            </span>
          ) : (
            <>
              {countLabel}
              {overlapCount > 0 && (
                <>
                  {' · '}
                  <span className="sched-overlap-count">{overlapCount} overlap{overlapCount === 1 ? '' : 's'}</span>
                </>
              )}
              {truncated && (
                <span className="sched-stepper-truncated"> (stopped early — narrow your sections to see more)</span>
              )}
              {updatingVisible && (
                <span className="sched-stepper-updating" role="status">
                  {' '}<PawLoader size="small" label="Updating…" />
                </span>
              )}
            </>
          )}
        </div>
        {canSort && (
          <div className="sched-stepper-sort">
            <label htmlFor={sortId}>Sort:</label>
            <span className="sched-stepper-sort-select">
              <select
                id={sortId}
                value={sortValue}
                onChange={(e) => onSortChange(e.target.value)}
                disabled={held}
                title={held ? 'Sorts your results, not this bookmark' : undefined}
              >
                {SCHEDULE_SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </span>
          </div>
        )}
      </div>
      {bestDays >= MIN_DAYS_FOR_NOTE && (
        <div className="sched-stepper-note">Best case is {bestDays} days with these sections.</div>
      )}
      <div className="sched-stepper-controls">
        <div className="sched-stepper-controls-group is-nav">
          <button type="button" disabled={firstDisabled} onClick={goFirst} aria-label="Jump to first" title={held ? heldNote : "First"}>
            «
          </button>
          <button type="button" disabled={prevDisabled} onClick={goPrev} aria-label="Previous" title={held ? heldNote : "Previous"}>
            ‹ Prev
          </button>
          <button type="button" disabled={nextDisabled} onClick={goNext} aria-label="Next" title={held ? heldNote : "Next"}>
            Next ›
          </button>
          <button type="button" disabled={lastDisabled} onClick={goLast} aria-label="Jump to last" title={held ? heldNote : "Last"}>
            »
          </button>
        </div>
        <div className="sched-stepper-controls-group">
        <button
          type="button"
          className={`sched-flag-btn${isBookmarked ? ' is-flagged' : ''}`}
          onClick={() => onToggleBookmark(previewIndex)}
          aria-pressed={isBookmarked}
          aria-label={isBookmarked ? 'Remove this schedule from your shortlist' : 'Add this schedule to your shortlist. A shortlist is not a saved schedule; use Save to keep one'}
          title={isBookmarked ? 'On your shortlist — click to remove' : 'Add to your shortlist — a quick list kept in this browser, not a saved schedule. Use Save to keep a schedule.'}
        >
          <FlagIcon filled={isBookmarked} />
          {isBookmarked ? 'Bookmarked' : 'Bookmark'}
        </button>
        {onEditManually && (
          <button
            type="button"
            className="sched-edit-manually-btn"
            onClick={onEditManually}
            title="Copy this schedule into Manual mode to place sections yourself"
          >
            Edit manually
          </button>
        )}
        {onBack && (
          // Always laid out (hidden unless a hold is active) so the row wraps the same either way.
          <button
            type="button"
            className="sched-stepper-back-btn"
            onClick={onBack}
            style={held ? undefined : { visibility: 'hidden' }}
            aria-hidden={held ? undefined : 'true'}
            tabIndex={held ? undefined : -1}
            disabled={!held}
            title="Back to the schedules from your draft. This one is dropped unless it's saved or bookmarked."
          >
            Back to all results
          </button>
        )}
        </div>
      </div>
    </div>
  );
}

// Manual mode's slim header in place of the stepper: what's placed, plus
// Bookmark / Save / Clear for it.
export function ManualScheduleHeader({ creditsLabel, overlapCount, onStepOverlap, isBookmarked, canAct, onToggleBookmark, onSave, onClear, onBackToAuto }) {
  return (
    <div className="sched-stepper sched-manual-header">
      <div className="sched-stepper-top">
        <div className="sched-stepper-count">
          Manual schedule
          {creditsLabel && <> · {creditsLabel}</>}
          {overlapCount > 0 && (
            <>
              {' · '}
              <button
                type="button"
                className="sched-overlap-count sched-overlap-step-btn"
                onClick={onStepOverlap}
                title="Show the next overlap on the grid"
              >
                {overlapCount} overlap{overlapCount === 1 ? '' : 's'}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="sched-stepper-controls">
        {onBackToAuto && (
          <button type="button" className="sched-manual-btn" onClick={onBackToAuto}>
            Back to auto schedules
          </button>
        )}
        <button
          type="button"
          className={`sched-flag-btn${isBookmarked ? ' is-flagged' : ''}`}
          onClick={onToggleBookmark}
          disabled={!canAct}
          aria-pressed={isBookmarked}
          title={isBookmarked ? 'On your shortlist — click to remove' : 'Add to your shortlist — a quick list kept in this browser, not a saved schedule. Use Save to keep a schedule.'}
        >
          <FlagIcon filled={isBookmarked} />
          {isBookmarked ? 'Bookmarked' : 'Bookmark'}
        </button>
        <button type="button" className="sched-manual-btn" onClick={onSave} disabled={!canAct}>
          Save
        </button>
        <button type="button" className="sched-manual-btn" onClick={onClear} disabled={!canAct}>
          Clear
        </button>
      </div>
    </div>
  );
}

// Shown in place of the stepper once a swap is finished: the tweaked schedule
// isn't in the generated batch, so say so and offer to keep it.
export function SwapDoneBar({ isBookmarked, isSaved, onToggleBookmark, onSave, onBack, leftOut = [] }) {
  const note = isSaved ? 'Saved.' : isBookmarked ? 'Bookmarked.' : "This tweaked schedule isn't saved. Bookmark or save it to keep it.";
  return (
    <div className="sched-stepper sched-swap-done" role="status">
      <div className="sched-stepper-top">
        <div className="sched-stepper-count">
          Swap done. <span className="sched-swap-done-note">{note}</span>
        </div>
        {leftOut.length > 0 && (
          <div className="sched-swap-done-left-out">Left out: {leftOut.join(', ')}.</div>
        )}
      </div>
      <div className="sched-stepper-controls">
        <button
          type="button"
          className={`sched-flag-btn${isBookmarked ? ' is-flagged' : ''}`}
          onClick={onToggleBookmark}
          aria-pressed={isBookmarked}
        >
          <FlagIcon filled={isBookmarked} />
          {isBookmarked ? 'Bookmarked' : 'Bookmark'}
        </button>
        <button type="button" className="sched-manual-btn" onClick={onSave} disabled={isSaved}>
          {isSaved ? 'Saved' : 'Save'}
        </button>
        <button type="button" className="sched-manual-btn" onClick={onBack}>
          Back to all schedules
        </button>
      </div>
    </div>
  );
}
