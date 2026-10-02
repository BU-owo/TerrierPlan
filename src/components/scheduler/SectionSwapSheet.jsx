import { sectionsConflict, describeSectionTime, describeSeatStatus } from '../../utils/sectionTime';
import { classifyComponent } from '../../utils/sectionComponents';
import { swapGhostReasons } from '../../utils/swapReasons';
import { resolvedCourseColorIndex } from '../../utils/scheduleColors';
import PinIcon from './PinIcon';

// Mobile counterpart to WeeklyGrid's ghost overlay — a narrow, swipeable
// single-column layout has no room to render several overlapping
// translucent time blocks legibly, so instead this is a plain tap-to-
// select list: same candidate pool, same filter/conflict rules, same
// clear-slot/lock actions, just a row per section instead of a spatial
// block. CSS shows this only under the 860px breakpoint (see
// scheduler.css) — WeeklyGrid's desktop banner/ghosts are the mirror
// image, hidden below it. Both are always mounted together when a slot is
// open; only one is ever visible at a time.
export default function SectionSwapSheet({
  slot,
  candidates,
  sectionsById,
  courseMap,
  committedSectionIds,
  lockedSectionIds = new Set(),
  courseColors = {},
  poolSectionIds = new Set(),
  globalTimeFilter,
  onSelect,
  onToggleLock,
  onClearSlot,
  onClose,
}) {
  const courseCode = courseMap[slot.courseKey]?.courseNumber ?? slot.courseKey;
  const componentLabel = candidates[0]?.componentLabel || slot.component;
  const colorIndex = resolvedCourseColorIndex(slot.courseKey, courseColors);

  const committedOthers = committedSectionIds
    .map((id) => sectionsById[id])
    .filter((s) => s && !(s.courseKey === slot.courseKey && classifyComponent(s) === slot.component));

  // Every candidate is listed — checked or not, eliminated or not, inside
  // the time filter or not. Those only get a small label (swapGhostReasons).
  const visible = candidates;

  return (
    <div className="sched-swap-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="swap-sheet-title">
      <div className="sched-swap-sheet">
        <div className="sched-swap-sheet-header">
          <div>
            <h3 id="swap-sheet-title" className={`sched-swap-sheet-title sched-color-${colorIndex}`}>
              {courseCode} — {componentLabel}
            </h3>
            <p className="sched-swap-sheet-subtitle">
              {visible.length} section{visible.length === 1 ? '' : 's'} available — tap one to place it, or tap your current one to keep it
            </p>
          </div>
          <button type="button" className="sched-swap-sheet-close" onClick={onClose} aria-label="Cancel — keep current selection">
            ×
          </button>
        </div>

        <div className="sched-swap-sheet-list">
          {visible.map((section) => {
            const isCurrent = section.id === slot.currentSectionId;
            const isLocked = lockedSectionIds.has(section.id);
            const conflicts = committedOthers.filter((o) => sectionsConflict(o, section));
            const reasons = isCurrent ? [] : swapGhostReasons(section, poolSectionIds, globalTimeFilter);
            // A conflicting row can't be placed (the current row is always
            // tappable — that's "keep").
            const blocked = !isCurrent && conflicts.length > 0;
            const instructorLabel = section.instructors?.length
              ? section.instructors.map((i) => `${i.first ? i.first[0] + '. ' : ''}${i.last}`.trim()).join(', ')
              : 'Staff';

            // A row is either "tap to select" (plain content, wrapped in
            // its own click/keyboard handling) OR "the current pick" (has
            // a real nested <button> for the pin toggle) — never both, so
            // the pin button is never nested inside another interactive
            // element (invalid HTML, and a disabled parent <button> would
            // likely have blocked the pin from ever firing). Tapping the
            // current row just closes the sheet (keep it, change nothing);
            // the pin button stops propagation so it doesn't also close,
            // and Cancel is the keyboard path.
            return (
              <div
                key={section.id}
                className={`sched-swap-sheet-row${isCurrent ? ' is-current' : ''}${conflicts.length > 0 ? ' has-conflict' : ''}${reasons.length > 0 ? ' is-offpool' : ''}${blocked ? ' is-blocked' : ''}`}
                aria-current={isCurrent ? 'true' : undefined}
                role={isCurrent ? undefined : 'button'}
                tabIndex={isCurrent ? undefined : 0}
                aria-disabled={blocked || undefined}
                onClick={isCurrent ? onClose : blocked ? undefined : () => onSelect(section.id)}
                onKeyDown={isCurrent ? undefined : (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!blocked) onSelect(section.id);
                  }
                }}
              >
                <div className="sched-swap-sheet-row-top">
                  <span className="sched-swap-sheet-row-section">Section {section.classSection}</span>
                  {isCurrent && <span className="sched-swap-sheet-row-current-badge">Current</span>}
                  {reasons.map((r) => (
                    <span key={r.key} className="sched-swap-sheet-row-tag" title={r.text}>{r.label}</span>
                  ))}
                  {isCurrent && (
                    <button
                      type="button"
                      className={`sched-swap-sheet-pin-btn${isLocked ? ' is-locked' : ''}`}
                      onClick={(e) => { e.stopPropagation(); onToggleLock(section.id); }}
                      aria-label={isLocked ? 'Unlock this section' : 'Lock this section into every generated schedule'}
                      title={isLocked ? 'Locked — click to unlock' : 'Lock this section into every generated schedule'}
                    >
                      <PinIcon filled={isLocked} />
                    </button>
                  )}
                </div>
                <div className="sched-swap-sheet-row-details">
                  <span>{describeSectionTime(section)}</span>
                  <span>{instructorLabel}</span>
                  <span>{describeSeatStatus(section)}</span>
                </div>
                {conflicts.length > 0 && (
                  <div className="sched-swap-sheet-row-conflict">
                    {blocked ? "Can't place — conflicts with " : 'Conflicts with '}
                    {[...new Set(conflicts.map((c) => courseMap[c.courseKey]?.courseNumber ?? c.courseKey))].join(', ')}
                  </div>
                )}
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="sched-swap-sheet-empty">
              No other sections available.
            </div>
          )}
        </div>

        <div className="sched-swap-sheet-footer">
          <button type="button" className="sched-swap-sheet-clear-btn" onClick={onClearSlot}>
            Clear this slot
          </button>
          <button type="button" className="sched-swap-sheet-cancel-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
