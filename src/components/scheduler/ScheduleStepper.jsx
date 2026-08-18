// Browses one generated schedule at a time — replaces an earlier "list of
// every combination" UI that either had to truncate the DOM or render
// hundreds/thousands of rows. Only the current index's sectionIds ever
// reach the grid, so the total combination count (however large) never
// costs more DOM than a single schedule's worth of blocks.
//
// `flaggedIndices` is a lightweight, unsaved shortlist — a way to mark
// "maybe this one" while flipping through combinations, before committing
// to actually saving any of them. It's just indices into the current
// `generated.schedules`, not persisted schedules of their own.
export default function ScheduleStepper({ generated, previewIndex, onJump, flaggedIndices, onToggleFlag }) {
  if (!generated || generated.schedules.length === 0 || previewIndex == null) return null;

  const { schedules, truncated } = generated;
  const atFirst = previewIndex === 0;
  const atLast = previewIndex === schedules.length - 1;
  const isFlagged = flaggedIndices.includes(previewIndex);
  const hasFlags = flaggedIndices.length > 0;

  function jumpFlagged(direction) {
    if (!hasFlags) return;
    if (direction > 0) {
      const next = flaggedIndices.find((i) => i > previewIndex);
      onJump(next !== undefined ? next : flaggedIndices[0]);
    } else {
      const prev = [...flaggedIndices].reverse().find((i) => i < previewIndex);
      onJump(prev !== undefined ? prev : flaggedIndices[flaggedIndices.length - 1]);
    }
  }

  return (
    <div className="sched-stepper">
      <div className="sched-stepper-count">
        Schedule {previewIndex + 1} of {schedules.length}
        {truncated && <span className="sched-stepper-truncated"> (stopped early — narrow your sections to see more)</span>}
      </div>
      <div className="sched-stepper-controls">
        <button
          type="button"
          disabled={atFirst}
          onClick={() => onJump(0)}
          aria-label="Jump to first schedule"
          title="First"
        >
          «
        </button>
        <button
          type="button"
          disabled={atFirst}
          onClick={() => onJump(previewIndex - 1)}
          aria-label="Previous schedule"
          title="Previous"
        >
          ‹ Prev
        </button>
        <button
          type="button"
          disabled={atLast}
          onClick={() => onJump(previewIndex + 1)}
          aria-label="Next schedule"
          title="Next"
        >
          Next ›
        </button>
        <button
          type="button"
          disabled={atLast}
          onClick={() => onJump(schedules.length - 1)}
          aria-label="Jump to last schedule"
          title="Last"
        >
          »
        </button>
        <button
          type="button"
          className={`sched-flag-btn${isFlagged ? ' is-flagged' : ''}`}
          onClick={() => onToggleFlag(previewIndex)}
          aria-label={isFlagged ? 'Unflag this schedule' : 'Flag this schedule'}
          title={isFlagged ? 'Unflag this schedule' : 'Flag this schedule'}
        >
          {isFlagged ? '★' : '☆'}
        </button>
      </div>
      {hasFlags && (
        <div className="sched-stepper-flagged-nav">
          <button type="button" onClick={() => jumpFlagged(-1)} title="Previous flagged schedule">
            ‹ Flagged
          </button>
          <span className="sched-stepper-flagged-count">
            {flaggedIndices.length} flagged
          </span>
          <button type="button" onClick={() => jumpFlagged(1)} title="Next flagged schedule">
            Flagged ›
          </button>
        </div>
      )}
    </div>
  );
}
