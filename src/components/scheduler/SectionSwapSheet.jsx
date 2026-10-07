import { sectionTypeLabel } from '../../utils/sectionType';
import { sectionsConflict, describeSectionTime, describeExamTime, describeSeatStatus } from '../../utils/sectionTime';
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
  displaceInfo = null,
  onContinueDisplace = () => {},
  // Manual: overlaps are allowed (so a clash says "Overlaps", not "replaces"), a
  // ghost with no clash is marked "fits", and there's no pin or draft filter.
  manual = false,
}) {
  const courseCode = courseMap[slot.courseKey]?.courseNumber ?? slot.courseKey;
  const componentLabel = candidates[0]?.componentLabel || slot.component;
  const colorIndex = resolvedCourseColorIndex(slot.courseKey, courseColors);

  const committedOthers = committedSectionIds
    .map((id) => sectionsById[id])
    .filter((s) => s && !(s.courseKey === slot.courseKey && classifyComponent(s) === slot.component));

  // Every candidate is listed — checked or not, eliminated or not, inside
  // the time filter or not. Those only get a small label (swapGhostReasons).
  // Mid displace flow the slot's section was just displaced: it isn't the
  // current pick and isn't offered back.
  const visible = displaceInfo ? candidates.filter((s) => s.id !== slot.currentSectionId) : candidates;
  const nameOf = (o) => `${courseMap[o.courseKey]?.courseNumber ?? o.courseKey} ${o.componentLabel || classifyComponent(o)}`;

  return (
    <div className="sched-swap-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="swap-sheet-title">
      <div className="sched-swap-sheet">
        <div className="sched-swap-sheet-header">
          <div>
            <h3 id="swap-sheet-title" className={`sched-swap-sheet-title sched-color-${colorIndex}`}>
              {courseCode} — {componentLabel}
            </h3>
            <p className={`sched-swap-sheet-subtitle${displaceInfo ? ' is-flow' : ''}`}>
              {displaceInfo ? (
                <>
                  <span className="sched-swap-sheet-line">{displaceInfo.sheetLines[0]}</span>
                  <span className="sched-swap-sheet-line is-todo">{displaceInfo.sheetLines[1]}</span>
                </>
              ) : (
                <>{visible.length} section{visible.length === 1 ? '' : 's'} available — tap one to place it, or tap your current one to keep it</>
              )}
            </p>
          </div>
          <button type="button" className="sched-swap-sheet-close" onClick={onClose} aria-label={displaceInfo ? 'Undo swap' : 'Cancel — keep current selection'}>
            ×
          </button>
        </div>

        <div className="sched-swap-sheet-list">
          {visible.map((section) => {
            const isCurrent = !displaceInfo && section.id === slot.currentSectionId;
            const isLocked = lockedSectionIds.has(section.id);
            const conflicts = committedOthers.filter((o) => sectionsConflict(o, section));
            const reasons = isCurrent || manual ? [] : swapGhostReasons(section, poolSectionIds, globalTimeFilter);
            // A clashing row can be placed (it displaces what it clashes
            // with) unless one of those is pinned; the current row is always
            // tappable — that's "keep".
            const pinnedClashes = conflicts.filter((o) => lockedSectionIds.has(o.id));
            const blocked = !isCurrent && pinnedClashes.length > 0;
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
                  <span className="sched-type-pill" title={sectionTypeLabel(section).full}>{sectionTypeLabel(section).abbr}</span>
                  <span className="sched-swap-sheet-row-section">Section {section.classSection}</span>
                  {isCurrent && <span className="sched-swap-sheet-row-current-badge">Current</span>}
                  {reasons.map((r) => (
                    <span key={r.key} className="sched-swap-sheet-row-tag" title={r.text}>{r.label}</span>
                  ))}
                  {!isCurrent && manual && conflicts.length === 0 && (
                    <span className="sched-swap-sheet-row-tag is-fits" title="No overlap with your other sections">fits</span>
                  )}
                  {isCurrent && !manual && (
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
                  {describeExamTime(section) && <span>Exam: {describeExamTime(section)}</span>}
                  <span>{instructorLabel}</span>
                  <span>{describeSeatStatus(section)}</span>
                </div>
                {conflicts.length > 0 && (
                  <div className="sched-swap-sheet-row-conflict">
                    {blocked
                      ? `Can't place — conflicts with pinned ${[...new Set(pinnedClashes.map(nameOf))].join(', ')}`
                      : manual
                        ? `Overlaps ${[...new Set(conflicts.map(nameOf))].join(', ')} (allowed)`
                        : `Swap in — replaces ${[...new Set(conflicts.map(nameOf))].join(', ')}`}
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
          {displaceInfo ? (
            displaceInfo.noOptions && (
              <button type="button" className="sched-swap-sheet-clear-btn" onClick={onContinueDisplace}>
                Continue
              </button>
            )
          ) : (
            <button type="button" className="sched-swap-sheet-clear-btn" onClick={onClearSlot}>
              Clear this slot
            </button>
          )}
          <button type="button" className="sched-swap-sheet-cancel-btn" onClick={onClose}>
            {displaceInfo ? 'Undo swap' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
