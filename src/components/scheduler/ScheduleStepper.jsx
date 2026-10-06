import { useEffect, useState } from 'react';
import FlagIcon from './FlagIcon';
import { overlapSummary } from '../../utils/scheduleCombos';

// Browses one generated schedule at a time — replaces an earlier "list of
// every combination" UI that either had to truncate the DOM or render
// hundreds/thousands of rows. Only the current index's sectionIds ever
// reach the grid, so the total combination count (however large) never
// costs more DOM than a single schedule's worth of blocks.
//
// `bookmarkedIndices` is where the CURRENT `generated.schedules` batch
// overlaps with the student's bookmark shortlist (see SchedulerPage's
// `bookmarks` state) — just enough to drive stepping and the flag toggle
// here. The bookmarks themselves outlive any one generation and are
// managed/listed in full over in BookmarkedSchedulesPanel.
//
// Two explicit modes rather than a second always-on nav row: "All" steps
// through every generated combination like before; switching to
// "Bookmarked" repoints Prev/Next/First/Last at just the bookmarked ones
// and relabels the counter ("Bookmarked 2 of 5"), so it's never ambiguous
// which universe you're currently stepping through.
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
  bookmarkedIndices,
  onToggleBookmark,
  sectionIds = [],
  sectionsById = {},
  updating = false,
  onEditManually,
}) {
  const [mode, setMode] = useState('all');

  // Falls back to "All" the moment there's nothing left to browse in
  // Bookmarked mode (e.g. the last bookmark in this batch just got
  // unflagged) instead of stranding the stepper on an empty view.
  useEffect(() => {
    if (mode === 'bookmarked' && bookmarkedIndices.length === 0) setMode('all');
  }, [mode, bookmarkedIndices]);

  if (!generated || generated.schedules.length === 0 || previewIndex == null) return null;

  const { schedules, truncated } = generated;
  const overlapCount = overlapSummary(sectionIds, sectionsById).pairs;
  const isBookmarked = bookmarkedIndices.includes(previewIndex);
  const hasBookmarks = bookmarkedIndices.length > 0;

  function switchToBookmarked() {
    if (!hasBookmarks) return;
    setMode('bookmarked');
    if (!bookmarkedIndices.includes(previewIndex)) {
      const next = bookmarkedIndices.find((i) => i >= previewIndex) ?? bookmarkedIndices[0];
      onJump(next);
    }
  }

  let atFirst;
  let atLast;
  let goFirst;
  let goPrev;
  let goNext;
  let goLast;
  let countLabel;

  if (mode === 'bookmarked') {
    const pos = bookmarkedIndices.indexOf(previewIndex);
    atFirst = pos <= 0;
    atLast = pos === -1 || pos === bookmarkedIndices.length - 1;
    goFirst = () => onJump(bookmarkedIndices[0]);
    goPrev = () => onJump(bookmarkedIndices[Math.max(0, pos - 1)]);
    goNext = () => onJump(bookmarkedIndices[Math.min(bookmarkedIndices.length - 1, pos + 1)]);
    goLast = () => onJump(bookmarkedIndices[bookmarkedIndices.length - 1]);
    countLabel = `Bookmarked ${pos === -1 ? '?' : pos + 1} of ${bookmarkedIndices.length}`;
  } else {
    atFirst = previewIndex === 0;
    atLast = previewIndex === schedules.length - 1;
    goFirst = () => onJump(0);
    goPrev = () => onJump(previewIndex - 1);
    goNext = () => onJump(previewIndex + 1);
    goLast = () => onJump(schedules.length - 1);
    countLabel = `Schedule ${previewIndex + 1} of ${schedules.length}`;
  }

  return (
    <div className={`sched-stepper${mode === 'bookmarked' ? ' is-bookmarked-mode' : ''}`}>
      <div className="sched-stepper-top">
        <div className="sched-stepper-count">
          {countLabel}
          {overlapCount > 0 && (
            <>
              {' · '}
              <span className="sched-overlap-count">{overlapCount} overlap{overlapCount === 1 ? '' : 's'}</span>
            </>
          )}
          {mode === 'all' && truncated && (
            <span className="sched-stepper-truncated"> (stopped early — narrow your sections to see more)</span>
          )}
          {updating && <span className="sched-stepper-updating" role="status"> Updating…</span>}
        </div>
        {hasBookmarks && (
          <div className="sched-stepper-mode-toggle" role="tablist" aria-label="Browse all or just bookmarked schedules">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'all'}
              className={mode === 'all' ? 'is-active' : ''}
              onClick={() => setMode('all')}
            >
              All
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'bookmarked'}
              className={mode === 'bookmarked' ? 'is-active' : ''}
              onClick={switchToBookmarked}
            >
              Bookmarked ({bookmarkedIndices.length})
            </button>
          </div>
        )}
      </div>
      <div className="sched-stepper-controls">
        <button type="button" disabled={atFirst} onClick={goFirst} aria-label="Jump to first" title="First">
          «
        </button>
        <button type="button" disabled={atFirst} onClick={goPrev} aria-label="Previous" title="Previous">
          ‹ Prev
        </button>
        <button type="button" disabled={atLast} onClick={goNext} aria-label="Next" title="Next">
          Next ›
        </button>
        <button type="button" disabled={atLast} onClick={goLast} aria-label="Jump to last" title="Last">
          »
        </button>
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
      </div>
    </div>
  );
}

// Manual mode's slim header in place of the stepper: what's placed, plus
// Bookmark / Save / Clear for it.
export function ManualScheduleHeader({ creditsLabel, overlapCount, isBookmarked, canAct, onToggleBookmark, onSave, onClear }) {
  return (
    <div className="sched-stepper sched-manual-header">
      <div className="sched-stepper-top">
        <div className="sched-stepper-count">
          Manual schedule
          {creditsLabel && <> · {creditsLabel}</>}
          {overlapCount > 0 && (
            <>
              {' · '}
              <span className="sched-overlap-count">{overlapCount} overlap{overlapCount === 1 ? '' : 's'}</span>
            </>
          )}
        </div>
      </div>
      <div className="sched-stepper-controls">
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
