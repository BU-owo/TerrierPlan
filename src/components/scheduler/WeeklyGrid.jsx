import { useEffect, useRef, useState } from 'react';
import {
  DAY_ORDER,
  sectionMeeting,
  sectionsConflict,
  describeSectionTime,
  describeSeatStatus,
  formatClock,
} from '../../utils/sectionTime';
import { classifyComponent } from '../../utils/sectionComponents';
import { matchesFilters } from '../../utils/sectionFilters';
import { SCHED_COLOR_COUNT, resolvedCourseColorIndex } from '../../utils/scheduleColors';
import PinIcon from './PinIcon';
import SwapIcon from './SwapIcon';

const PX_PER_MIN = 1.6;
const DEFAULT_START = 8 * 60; // 8:00am — only used as the empty-schedule fallback range
const DEFAULT_END = 18 * 60; // 6:00pm
const RANGE_PAD_MIN = 30; // small buffer above the earliest and below the latest class
const MIN_RANGE_SPAN_MIN = 5 * 60; // never show less than a 5-hour window, so one class doesn't look like a sliver

// A block's minimum height only needs to guarantee the course code + time
// line fit — professor/room are extra detail, shown only once there's
// genuinely room for them (see showProf/showRoom below). This is what
// keeps a short class's block from either forcing everything else taller
// than it needs to be, or cramming 4 lines into a box that only fits 2 and
// having the bottom ones clip.
const BLOCK_PADDING_V = 10;
const ACTIONS_ROW_H = 17;
const LINE_H = 14;
const MIN_BLOCK_HEIGHT = BLOCK_PADDING_V + ACTIONS_ROW_H + LINE_H * 2;
const PROF_LINE_THRESHOLD = MIN_BLOCK_HEIGHT + LINE_H;
const ROOM_LINE_THRESHOLD = PROF_LINE_THRESHOLD + LINE_H;

function formatHourLabel(hour) {
  const h = hour % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? 'AM' : 'PM'}`;
}

// Lays out one day's worth of possibly-overlapping section-swap ghost
// candidates into side-by-side lanes, like a calendar's overlapping-events
// view — two alternatives that happen to meet at the same time shouldn't
// just stack unreadably on top of each other. Standard approach: sort by
// start time, split into clusters of items that transitively overlap (a
// gap with nothing spanning it ends a cluster), then within each cluster
// greedily hand each item the first lane whose previous occupant has
// already ended. Items outside any overlap get laneCount 1 (full width).
function layoutGhostsForDay(items) {
  const sorted = [...items].sort((a, b) => a.meeting.startMin - b.meeting.startMin);
  const results = [];
  let cluster = [];
  let clusterMaxEnd = -Infinity;

  function flushCluster() {
    if (cluster.length === 0) return;
    const laneEnds = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.meeting.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.meeting.endMin);
      } else {
        laneEnds[lane] = item.meeting.endMin;
      }
      results.push({ ...item, lane });
    }
    const laneCount = laneEnds.length;
    for (let i = results.length - cluster.length; i < results.length; i++) results[i].laneCount = laneCount;
    cluster = [];
    clusterMaxEnd = -Infinity;
  }

  for (const item of sorted) {
    if (cluster.length > 0 && item.meeting.startMin >= clusterMaxEnd) flushCluster();
    cluster.push(item);
    clusterMaxEnd = Math.max(clusterMaxEnd, item.meeting.endMin);
  }
  flushCluster();
  return results;
}

// One swatch-pick popover, anchored under whichever legend chip opened it —
// lives in the legend row (normal document flow) rather than inside a grid
// block, so it never gets clipped by sched-grid-body's own scroll area.
function ColorPickerPopover({ current, onPick, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="sched-color-popover" ref={ref} role="menu">
      {Array.from({ length: SCHED_COLOR_COUNT }, (_, i) => (
        <button
          key={i}
          type="button"
          role="menuitemradio"
          aria-checked={current === i}
          className={`sched-color-swatch sched-color-${i}${current === i ? ' is-selected' : ''}`}
          onClick={() => onPick(i)}
          aria-label={`Color ${i + 1}`}
        />
      ))}
      <button type="button" className="sched-color-popover-auto" onClick={() => onPick(null)}>
        Reset to auto
      </button>
    </div>
  );
}

// Renders one schedule (a set of committed sectionIds) as a Mon–Fri (+
// Sat/Sun if actually used) time grid. `lockedSectionIds`/`onToggleLock`/
// `onEliminate` make each block itself interactive — locking or
// eliminating a section right from the grid is meant to feel identical to
// doing it from the draft picker; the caller (SchedulerPage) re-generates
// immediately afterward so the schedule shown here never drifts out of
// sync with what's actually locked/considered.
//
// `swapSlot` ({ courseKey, component, currentSectionId } | null) drives
// the section-swap "browse every other section for this one slot" feature
// — while set, every OTHER section sharing that (courseKey, component)
// renders as a translucent, dashed "ghost" block layered on top of the
// grid (the current occupant keeps rendering normally via the loop
// below — no separate ghost for it). This is a client-side view state
// owned by SchedulerPage, not persisted anywhere.
export default function WeeklyGrid({
  sectionIds,
  sectionsById,
  courseMap,
  lockedSectionIds = new Set(),
  onToggleLock = () => {},
  onEliminate = () => {},
  colorOverrides = {},
  onSetColor = () => {},
  swapSlot = null,
  swapCandidates = [],
  swapIgnoreFilters = false,
  globalTimeFilter,
  onOpenSwap = () => {},
  onSelectSwapSection = () => {},
  onCloseSwap = () => {},
  onToggleSwapIgnoreFilters = () => {},
  onClearSwapSlot = () => {},
}) {
  const [openColorFor, setOpenColorFor] = useState(null); // courseKey, or null

  const sections = sectionIds.map((id) => sectionsById[id]).filter(Boolean);
  const withMeeting = sections
    .map((section) => ({ section, meeting: sectionMeeting(section) }))
    .filter((m) => m.meeting);
  const withoutMeeting = sections.filter((s) => !sectionMeeting(s));

  if (sections.length === 0) {
    return (
      <div className="sched-grid-empty">
        Generate schedules or load a saved one to preview it here.
      </div>
    );
  }

  // Every OTHER section currently on the schedule (not the slot being
  // swapped) — what a ghost gets checked against for a time conflict.
  const othersCommitted = swapSlot
    ? sections.filter((s) => !(s.courseKey === swapSlot.courseKey && classifyComponent(s) === swapSlot.component))
    : [];
  // Every alternative for the slot except whatever's currently occupying
  // it (that one already renders solid via the normal block loop) — and,
  // by default, only the ones that pass the active global time filter;
  // the "Show all sections" toggle bypasses that.
  const ghostCandidates = swapSlot
    ? swapCandidates
        .filter((s) => s.id !== swapSlot.currentSectionId)
        .filter((s) => swapIgnoreFilters || matchesFilters(s, globalTimeFilter))
        .map((section) => ({
          section,
          meeting: sectionMeeting(section),
          conflict: othersCommitted.some((o) => sectionsConflict(o, section)),
        }))
        .filter((g) => g.meeting)
    : [];
  const swapCourseCode = swapSlot ? (courseMap[swapSlot.courseKey]?.courseNumber ?? swapSlot.courseKey) : '';
  const swapComponentLabel = swapSlot
    ? (swapCandidates[0]?.componentLabel || swapSlot.component)
    : '';

  // One legend entry per distinct course actually shown — order follows
  // first appearance in sectionIds so it's stable while a preview stays on
  // the same combo, not alphabetical/hash order.
  const seenCourseKeys = new Set();
  const legendCourses = [];
  for (const section of sections) {
    if (seenCourseKeys.has(section.courseKey)) continue;
    seenCourseKeys.add(section.courseKey);
    legendCourses.push({
      courseKey: section.courseKey,
      label: courseMap[section.courseKey]?.courseNumber ?? section.courseKey,
    });
  }

  // While swapping, the grid's day range and time range both need to
  // stretch to cover the alternatives too, not just whatever's currently
  // committed — an 8am ghost shouldn't render clipped off the top just
  // because every already-placed class happens to be in the afternoon.
  const allTimed = swapSlot ? [...withMeeting, ...ghostCandidates] : withMeeting;
  const usedDays = new Set(allTimed.flatMap((m) => m.meeting.days));
  const days = DAY_ORDER.filter((d) => !['Sat', 'Sun'].includes(d) || usedDays.has(d));

  const rawMin = allTimed.length > 0 ? Math.min(...allTimed.map((m) => m.meeting.startMin)) : DEFAULT_START;
  const rawMax = allTimed.length > 0 ? Math.max(...allTimed.map((m) => m.meeting.endMin)) : DEFAULT_END;
  // Fit the grid to the actual classes (plus a small buffer) instead of
  // always forcing a full 8am–6pm span — a schedule that only runs
  // 10am–2pm shouldn't render 10 hours tall just because that's a "normal
  // day." A floor keeps a single class from looking like a razor-thin
  // sliver, and everything's clamped to a real day (0–24h).
  let gridStart = Math.floor((rawMin - RANGE_PAD_MIN) / 60) * 60;
  let gridEnd = Math.ceil((rawMax + RANGE_PAD_MIN) / 60) * 60;
  if (gridEnd - gridStart < MIN_RANGE_SPAN_MIN) {
    const mid = (gridStart + gridEnd) / 2;
    gridStart = Math.floor((mid - MIN_RANGE_SPAN_MIN / 2) / 60) * 60;
    gridEnd = gridStart + MIN_RANGE_SPAN_MIN;
  }
  gridStart = Math.max(gridStart, 0);
  gridEnd = Math.min(gridEnd, 24 * 60);

  const hours = [];
  for (let t = gridStart; t <= gridEnd; t += 60) hours.push(t / 60);

  const gridHeight = (gridEnd - gridStart) * PX_PER_MIN;
  const hourPx = 60 * PX_PER_MIN;

  return (
    <div className="sched-grid-wrap">
      {/* Desktop-only banner + ghost overlay — hidden under the mobile
          breakpoint (see scheduler.css), where SchedulerPage's
          SectionSwapSheet takes over instead (a cramped, narrow grid is no
          place to render several overlapping translucent blocks). */}
      {swapSlot && (
        <div className="sched-swap-banner">
          <span className="sched-swap-banner-title">
            Browsing {swapComponentLabel} sections for <strong>{swapCourseCode}</strong> — click one to swap it in
          </span>
          <label className="sched-swap-banner-toggle">
            <input type="checkbox" checked={swapIgnoreFilters} onChange={onToggleSwapIgnoreFilters} />
            Show all sections (ignore filters)
          </label>
          <button type="button" className="sched-swap-banner-btn" onClick={onClearSwapSlot}>
            Clear this slot
          </button>
          <button type="button" className="sched-swap-banner-btn sched-swap-banner-cancel" onClick={onCloseSwap}>
            Cancel
          </button>
        </div>
      )}
      <div className="sched-color-legend">
        {legendCourses.map(({ courseKey, label }) => (
          <div className="sched-color-legend-item" key={courseKey}>
            <button
              type="button"
              className={`sched-color-legend-swatch sched-color-${resolvedCourseColorIndex(courseKey, colorOverrides)}`}
              onClick={() => setOpenColorFor((cur) => (cur === courseKey ? null : courseKey))}
              aria-haspopup="true"
              aria-expanded={openColorFor === courseKey}
              aria-label={`Change color for ${label}`}
              title={`Change color for ${label}`}
            />
            <span className="sched-color-legend-label">{label}</span>
            {openColorFor === courseKey && (
              <ColorPickerPopover
                current={resolvedCourseColorIndex(courseKey, colorOverrides)}
                onPick={(idx) => {
                  onSetColor(courseKey, idx);
                  setOpenColorFor(null);
                }}
                onClose={() => setOpenColorFor(null)}
              />
            )}
          </div>
        ))}
      </div>
      <div className="sched-grid-header">
        <div className="sched-grid-time-gutter" />
        {days.map((d) => (
          <div key={d} className="sched-grid-day-label">{d}</div>
        ))}
      </div>
      <div className="sched-grid-body" style={{ height: gridHeight }}>
        <div className="sched-grid-time-gutter">
          {hours.map((h) => (
            <div key={h} className="sched-grid-hour-label" style={{ top: (h * 60 - gridStart) * PX_PER_MIN }}>
              {formatHourLabel(h)}
            </div>
          ))}
        </div>
        <div
          className="sched-grid-days"
          style={{ backgroundSize: `100% ${hourPx}px`, backgroundPosition: '0 0' }}
        >
          {days.map((day) => (
            <div key={day} className="sched-grid-day-col">
              {withMeeting
                .filter((m) => m.meeting.days.includes(day))
                .map(({ section, meeting }) => {
                  const courseCode = courseMap[section.courseKey]?.courseNumber ?? section.courseKey;
                  const isLocked = lockedSectionIds.has(section.id);
                  const profLastName = section.instructors?.[0]?.last || null;
                  const roomAndNbr = [section.facilId, section.classNbr ? `#${section.classNbr}` : null]
                    .filter(Boolean)
                    .join(' · ');
                  // Course code + time always show; professor/room only
                  // once the block is actually tall enough for them, so a
                  // short class shows fewer, complete lines instead of a
                  // 4th line clipped halfway through — see the threshold
                  // constants above.
                  const blockHeight = Math.max(MIN_BLOCK_HEIGHT, (meeting.endMin - meeting.startMin) * PX_PER_MIN);
                  const showProf = Boolean(profLastName) && blockHeight >= PROF_LINE_THRESHOLD;
                  const showRoom = Boolean(roomAndNbr) && blockHeight >= ROOM_LINE_THRESHOLD;

                  return (
                    <div
                      key={`${section.id}-${day}`}
                      className={`sched-grid-block sched-color-${resolvedCourseColorIndex(section.courseKey, colorOverrides)}${isLocked ? ' is-locked' : ''}`}
                      style={{
                        top: (meeting.startMin - gridStart) * PX_PER_MIN,
                        height: blockHeight,
                      }}
                      title={`${courseCode} — Section ${section.classSection} — ${describeSectionTime(section)}${section.facilId ? ` — ${section.facilId}` : ''}`}
                    >
                      <div className="sched-grid-block-actions">
                        <button
                          type="button"
                          className={`sched-grid-block-action-btn${isLocked ? ' is-locked' : ''}`}
                          onClick={(e) => { e.stopPropagation(); onToggleLock(section.id); }}
                          aria-label={isLocked ? `Unlock ${courseCode} section ${section.classSection}` : `Lock ${courseCode} section ${section.classSection} into every generated schedule`}
                          title={isLocked ? 'Locked into every generated schedule — click to unlock' : 'Lock this section into every generated schedule'}
                        >
                          <PinIcon filled={isLocked} />
                        </button>
                        <button
                          type="button"
                          className="sched-grid-block-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSwap(section.courseKey, classifyComponent(section), section.id);
                          }}
                          aria-label={`Browse other sections for ${courseCode}'s ${section.componentLabel || 'section'}`}
                          title="Browse every other available section for this slot"
                        >
                          <SwapIcon />
                        </button>
                        <button
                          type="button"
                          className="sched-grid-block-action-btn sched-grid-block-eliminate-btn"
                          onClick={(e) => { e.stopPropagation(); onEliminate(section.id); }}
                          aria-label={`Remove ${courseCode} section ${section.classSection} from consideration`}
                          title="Remove from consideration — won't appear in any future generated schedule"
                        >
                          ×
                        </button>
                      </div>
                      <span className="sched-grid-block-code">{courseCode} {section.classSection}</span>
                      <span className="sched-grid-block-time">{formatClock(meeting.startMin)}–{formatClock(meeting.endMin)}</span>
                      {showProf && <span className="sched-grid-block-prof">{profLastName}</span>}
                      {showRoom && <span className="sched-grid-block-room">{roomAndNbr}</span>}
                    </div>
                  );
                })}
              {swapSlot && layoutGhostsForDay(ghostCandidates.filter((g) => g.meeting.days.includes(day))).map((ghost) => {
                const { section, meeting, conflict, lane, laneCount } = ghost;
                const courseCode = courseMap[section.courseKey]?.courseNumber ?? section.courseKey;
                const blockHeight = Math.max(MIN_BLOCK_HEIGHT, (meeting.endMin - meeting.startMin) * PX_PER_MIN);
                const instructorLabel = section.instructors?.length
                  ? section.instructors.map((i) => `${i.first ? i.first[0] + '. ' : ''}${i.last}`.trim()).join(', ')
                  : 'Staff';
                const tooltip = [
                  `${courseCode} — Section ${section.classSection}${conflict ? ' — CONFLICTS with your current schedule' : ''}`,
                  describeSectionTime(section),
                  instructorLabel,
                  describeSeatStatus(section),
                ].join('\n');

                return (
                  <div
                    key={`ghost-${section.id}-${day}`}
                    role="button"
                    tabIndex={0}
                    className={`sched-grid-ghost-block sched-color-${resolvedCourseColorIndex(section.courseKey, colorOverrides)}${conflict ? ' has-conflict' : ''}`}
                    style={{
                      top: (meeting.startMin - gridStart) * PX_PER_MIN,
                      height: blockHeight,
                      left: `${(lane / laneCount) * 100}%`,
                      width: `${100 / laneCount}%`,
                    }}
                    title={tooltip}
                    onClick={() => onSelectSwapSection(section.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectSwapSection(section.id);
                      }
                    }}
                  >
                    <span className="sched-grid-ghost-block-code">{section.classSection}</span>
                    <span className="sched-grid-ghost-block-time">{formatClock(meeting.startMin)}–{formatClock(meeting.endMin)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {withoutMeeting.length > 0 && (
        <div className="sched-grid-no-meeting">
          No scheduled meeting time: {withoutMeeting
            .map((s) => `${courseMap[s.courseKey]?.courseNumber ?? s.courseKey} (${s.classSection})`)
            .join(', ')}
        </div>
      )}
    </div>
  );
}
