import { sectionsConflict, describeSectionTime, describeSeatStatus } from '../../utils/sectionTime';
import { classifyComponent } from '../../utils/sectionComponents';
import { matchesFilters } from '../../utils/sectionFilters';
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
  colorOverrides = {},
  ignoreFilters,
  globalTimeFilter,
  onToggleIgnoreFilters,
  onSelect,
  onToggleLock,
  onClearSlot,
  onClose,
}) {
  const courseCode = courseMap[slot.courseKey]?.courseNumber ?? slot.courseKey;
  const componentLabel = candidates[0]?.componentLabel || slot.component;
  const colorIndex = resolvedCourseColorIndex(slot.courseKey, colorOverrides);

  const committedOthers = committedSectionIds
    .map((id) => sectionsById[id])
    .filter((s) => s && !(s.courseKey === slot.courseKey && classifyComponent(s) === slot.component));

  const visible = candidates.filter((s) => s.id === slot.currentSectionId || ignoreFilters || matchesFilters(s, globalTimeFilter));
  const hiddenByFilterCount = candidates.length - visible.length;

  return (
    <div className="sched-swap-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="swap-sheet-title">
      <div className="sched-swap-sheet">
        <div className="sched-swap-sheet-header">
          <div>
            <h3 id="swap-sheet-title" className={`sched-swap-sheet-title sched-color-${colorIndex}`}>
              {courseCode} — {componentLabel}
            </h3>
            <p className="sched-swap-sheet-subtitle">
              {visible.length} section{visible.length === 1 ? '' : 's'} available — tap one to swap it in
            </p>
          </div>
          <button type="button" className="sched-swap-sheet-close" onClick={onClose} aria-label="Cancel — keep current selection">
            ×
          </button>
        </div>

        <label className="sched-swap-sheet-filter-toggle">
          <input type="checkbox" checked={ignoreFilters} onChange={onToggleIgnoreFilters} />
          Show all sections (ignore filters)
          {!ignoreFilters && hiddenByFilterCount > 0 && (
            <span className="sched-swap-sheet-filter-hint"> — {hiddenByFilterCount} hidden by your time filter</span>
          )}
        </label>

        <div className="sched-swap-sheet-list">
          {visible.map((section) => {
            const isCurrent = section.id === slot.currentSectionId;
            const isLocked = lockedSectionIds.has(section.id);
            const conflicts = committedOthers.filter((o) => sectionsConflict(o, section));
            const instructorLabel = section.instructors?.length
              ? section.instructors.map((i) => `${i.first ? i.first[0] + '. ' : ''}${i.last}`.trim()).join(', ')
              : 'Staff';

            // A row is either "tap to select" (plain content, wrapped in
            // its own click/keyboard handling) OR "the current pick" (has
            // a real nested <button> for the pin toggle) — never both, so
            // the pin button is never nested inside another interactive
            // element (invalid HTML, and a disabled parent <button> would
            // likely have blocked the pin from ever firing).
            return (
              <div
                key={section.id}
                className={`sched-swap-sheet-row${isCurrent ? ' is-current' : ''}${conflicts.length > 0 ? ' has-conflict' : ''}`}
                role={isCurrent ? undefined : 'button'}
                tabIndex={isCurrent ? undefined : 0}
                onClick={isCurrent ? undefined : () => onSelect(section.id)}
                onKeyDown={isCurrent ? undefined : (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(section.id); }
                }}
              >
                <div className="sched-swap-sheet-row-top">
                  <span className="sched-swap-sheet-row-section">Section {section.classSection}</span>
                  {isCurrent && <span className="sched-swap-sheet-row-current-badge">Current</span>}
                  {isCurrent && (
                    <button
                      type="button"
                      className={`sched-swap-sheet-pin-btn${isLocked ? ' is-locked' : ''}`}
                      onClick={() => onToggleLock(section.id)}
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
                    Conflicts with {conflicts.map((c) => courseMap[c.courseKey]?.courseNumber ?? c.courseKey).join(', ')}
                  </div>
                )}
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="sched-swap-sheet-empty">
              No sections match your time filter. Try "Show all sections" above.
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
