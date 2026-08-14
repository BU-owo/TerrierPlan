// Browses one generated schedule at a time — replaces an earlier "list of
// every combination" UI that either had to truncate the DOM or render
// hundreds/thousands of rows. Only the current index's sectionIds ever
// reach the grid, so the total combination count (however large) never
// costs more DOM than a single schedule's worth of blocks.
export default function ScheduleStepper({ generated, previewIndex, onJump }) {
  if (!generated || generated.schedules.length === 0 || previewIndex == null) return null;

  const { schedules, truncated } = generated;
  const atFirst = previewIndex === 0;
  const atLast = previewIndex === schedules.length - 1;

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
      </div>
    </div>
  );
}
