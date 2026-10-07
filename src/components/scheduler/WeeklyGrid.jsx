import { useEffect, useRef, useState } from 'react';
import {
  DAY_ORDER,
  classMeetings,
  examMeetings,
  sectionsConflict,
  describeSectionTime,
  describeExamTime,
  describeSeatStatus,
  describeMeetingShort,
  formatClock,
  formatClockRange,
} from '../../utils/sectionTime';
import { sectionTypeLabel, shortCourseCode, describeInstructors, describeSectionName } from '../../utils/sectionType';
import { classifyComponent } from '../../utils/sectionComponents';
import { swapGhostReasons } from '../../utils/swapReasons';
import { SCHED_COLOR_COUNT, resolvedCourseColorIndex } from '../../utils/scheduleColors';
import PinIcon from './PinIcon';
import SwapIcon from './SwapIcon';
import OverlapPopover from './OverlapPopover';

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
// A block's text is chosen by its height AND width in scheduler.css (container
// queries on the block itself), so a short block drops whole lines instead of
// clipping them; the floor is just enough for one line. Room and instructor are
// instructor is drawn from 64px up (scheduler.css drops it whole when the lines
// above leave no room), the room only in tall blocks (95px+).
const MIN_BLOCK_HEIGHT = 22;
const PROF_LINE_THRESHOLD = 64; // drawn from here; scheduler.css drops it when it doesn't fit
const ROOM_LINE_THRESHOLD = 95;

// One entry per CLASS meeting of a section, so a section that meets twice is
// drawn (and lane-packed) as two blocks. `mi` keeps React keys unique.
function toEntries(section, extra) {
  return classMeetings(section).map((meeting, mi) => ({ section, meeting, mi, ...extra }));
}

// Two entries clash only if they belong to different sections and share the
// given day at overlapping times — a section's own meetings never count.
function entriesOverlapOnDay(a, b, day) {
  return a.section.id !== b.section.id
    && a.meeting.days.includes(day) && b.meeting.days.includes(day)
    && a.meeting.startMin < b.meeting.endMin && b.meeting.startMin < a.meeting.endMin;
}

// An exam overlay shorter than this shows its label only in the tooltip.
const EXAM_LABEL_MIN_HEIGHT = 45;

// What a section is, as text for its blocks: the course number (a short form
// without the school in narrow lanes), then a fixed 3-letter type pill with the
// section code ("DIS · B3"; in a wide lane the pill gives way to the full name,
// "Discussion Section · B3"). Which of these is drawn depends on the lane's width
// (container queries on .sched-lane-text in scheduler.css), in this order as
// space runs out: course number, type and section, time, room and instructor.
// The full text is always in the tooltip.
function CourseCode({ courseCode }) {
  return (
    <>
      <span className="sched-lane-long">{courseCode}</span>
      <span className="sched-lane-short">{shortCourseCode(courseCode)}</span>
    </>
  );
}
// `start` ("10:10am") is shown on this line only in the short tier, where the time
// no longer gets a line of its own (see scheduler.css).
function TypeLine({ section, start }) {
  const { abbr, full } = sectionTypeLabel(section);
  return (
    <span className="sched-type-line">
      <span className="sched-type-pill" title={full}>{abbr}</span>
      <span className="sched-type-fullname">{full}</span>
      <span className="sched-type-sep"> · </span>
      <span className="sched-type-sec">{section.classSection}</span>
      {start && <span className="sched-type-start">· {start}</span>}
    </span>
  );
}

// "CAS CH 110 · Discussion Section B3": a section named in full for tooltips.
const longName = (courseCode, section) => `${courseCode} · ${sectionTypeLabel(section).full} ${section.classSection}`;

// Ghost text: the course number (and chips) on the first line, the type and
// section under it, then the time.
function GhostHead({ courseCode, children }) {
  return (
    <span className="sched-grid-ghost-block-head">
      <span className="sched-grid-ghost-block-code"><CourseCode courseCode={courseCode} /></span>
      {children}
    </span>
  );
}
function GhostTime({ children }) {
  return <span className="sched-grid-ghost-block-time">{children}</span>;
}

// Which corner of an exam overlay its label pill goes in: the upper-left, unless
// a class block sits under that spot — then the nearest corner with nothing
// under it (upper-right, lower-left, lower-right). `laidOut` is the day's class
// blocks with their lanes. The pill is taken to be ~60% of the column wide and
// two lines (28px) tall, the larger of its layouts.
function pickExamCorner(meeting, laidOut) {
  const pillMin = 28 / PX_PER_MIN;
  const span = 0.6;
  const bands = { top: [meeting.startMin, meeting.startMin + pillMin], bottom: [meeting.endMin - pillMin, meeting.endMin] };
  const sides = { left: [0, span], right: [1 - span, 1] };
  const hits = (band, side) => laidOut.some((e) => e.meeting.startMin < band[1] && band[0] < e.meeting.endMin
    && e.lane / e.laneCount < side[1] && side[0] < (e.lane + 1) / e.laneCount);
  for (const [v, h] of [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']]) {
    if (!hits(bands[v], sides[h])) return `${v}-${h}`;
  }
  return 'top-left';
}

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
// Also lays out the committed blocks themselves, so a schedule with
// overlapping classes draws them side by side.
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
// `usedBy` maps a palette slot to the labels of the OTHER courses already
// using it; those swatches get a dot but stay selectable (a manual pick may
// duplicate on purpose).
function ColorPickerPopover({ current, usedBy = {}, onPick, onClose }) {
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
      {Array.from({ length: SCHED_COLOR_COUNT }, (_, i) => {
        const others = usedBy[i] || [];
        const note = others.length > 0 ? ` — also used by ${others.join(', ')}` : '';
        return (
          <button
            key={i}
            type="button"
            role="menuitemradio"
            aria-checked={current === i}
            className={`sched-color-swatch sched-color-${i}${current === i ? ' is-selected' : ''}`}
            onClick={() => onPick(i)}
            aria-label={`Color ${i + 1}${note}`}
            title={note ? `Color ${i + 1}${note}` : undefined}
          >
            {others.length > 0 && <span className="sched-color-swatch-used" aria-hidden="true" />}
          </button>
        );
      })}
      <button type="button" className="sched-color-popover-auto" onClick={() => onPick(null)}>
        Reset to auto
      </button>
    </div>
  );
}

// { [slot]: [course label, ...] } for every draft course other than
// `courseKey`, so the picker can mark slots someone else already has.
function slotsUsedByOthers(courseKey, courseColors, courseMap) {
  const used = {};
  for (const [key, slot] of Object.entries(courseColors)) {
    if (key === courseKey) continue;
    (used[slot] ??= []).push(courseMap[key]?.courseNumber ?? key);
  }
  return used;
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
  courseColors = {},
  onSetColor = () => {},
  swapSlot = null,
  frozenTermLabel = null,
  swapCandidates = [],
  swapPoolIds = new Set(),
  globalTimeFilter,
  onOpenSwap = () => {},
  onSelectSwapSection = () => {},
  onCloseSwap = () => {},
  onClearSwapSlot = () => {},
  displaceInfo = null,
  onContinueDisplace = () => {},
  incompleteLabels = [],
  // 'auto' | 'manual'. Manual: the blocks are what the student placed by
  // hand, so each only offers × (onRemovePlaced) — no pin, no swap.
  mode = 'auto',
  onRemovePlaced = () => {},
  // Auto: sections checked for courses that aren't complete yet, drawn faint
  // and dashed ("not finished") — display only, never part of the schedule.
  pendingSectionIds = [],
  // "Show all" ghosts (a component group's every section, see
  // DraftCourseCard). Clickable only when onPlaceGhost is given (Manual).
  showAllGhosts = [],
  onPlaceGhost = null,
  // Auto: clicking a show-all ghost toggles that section's checkbox in the
  // draft; `selectedGhostIds` are the ghosts whose section is already checked.
  onToggleGhost = null,
  selectedGhostIds = new Set(),
  // courseKey -> ["Laboratory", "Discussion"] for each course that still lacks
  // a component (Auto): drives the placeholders' "needs ..." label and the
  // amber ring on the legend dot.
  missingByCourse = {},
  onClearGhosts = () => {},
  // Manual: "Resolving: A overlaps B" bar above the grid while a swap was started
  // from an overlap ({ text }); a { a, b, n } pair to scroll to and pulse (the
  // "N overlaps" stepper); and "Find another time" from the overlap popover.
  resolving = null,
  pulse = null,
  onFindAnotherTime = () => {},
}) {
  const [openColorFor, setOpenColorFor] = useState(null); // courseKey, or null
  const manual = mode === 'manual';
  // Manual overlap tools: the section whose overlaps are highlighted (hover or
  // keyboard focus), the open overlap popover, and the blocks currently pulsing.
  const [hoverId, setHoverId] = useState(null);
  const [popover, setPopover] = useState(null); // { sectionId, anchorEl }
  const [pulseKeys, setPulseKeys] = useState(() => new Set());
  const rootRef = useRef(null);
  const entriesRef = useRef([]);
  useEffect(() => {
    if (!pulse) return undefined;
    const a = entriesRef.current.filter((e) => e.section.id === pulse.a);
    const b = entriesRef.current.filter((e) => e.section.id === pulse.b);
    let day = null;
    for (const ea of a) for (const eb of b) for (const d of ea.meeting.days) if (!day && entriesOverlapOnDay(ea, eb, d)) day = d;
    if (!day) return undefined;
    setPulseKeys(new Set([`${pulse.a}|${day}`, `${pulse.b}|${day}`]));
    rootRef.current?.querySelector(`[data-section-id="${pulse.a}"][data-day="${day}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setPulseKeys(new Set()), 1800);
    return () => clearTimeout(timer);
  }, [pulse]);

  const sections = sectionIds.map((id) => sectionsById[id]).filter(Boolean);
  const withMeeting = sections.flatMap((section) => toEntries(section));
  entriesRef.current = withMeeting;
  const withoutMeeting = sections.filter((s) => classMeetings(s).length === 0);
  const pending = pendingSectionIds
    .map((id) => sectionsById[id])
    .filter(Boolean)
    .flatMap((section) => toEntries(section, { isPending: true }));
  // Show-all ghosts aren't drawn while a swap slot is open (that has its own
  // ghost layer); ones with no meeting time are listed under the grid.
  const showAllActive = swapSlot ? [] : showAllGhosts;
  const showAllTimed = showAllActive.flatMap((section) => toEntries(section));
  const showAllUntimed = showAllActive.filter((s) => classMeetings(s).length === 0);

  if (sections.length === 0 && pending.length === 0 && showAllActive.length === 0) {
    return (
      <div className="sched-grid-empty">
        {manual
          ? 'Click sections on the left to place them here.'
          : 'Check sections for your courses, or load a saved schedule, to preview it here.'}
      </div>
    );
  }

  // Every OTHER section currently on the schedule (not the slot being
  // swapped) — what a ghost gets checked against for a time conflict.
  const othersCommitted = swapSlot
    ? sections.filter((s) => !(s.courseKey === swapSlot.courseKey && classifyComponent(s) === swapSlot.component))
    : [];
  // Every alternative for the slot except whatever's currently occupying
  // it (that one already renders solid via the normal block loop). Nothing
  // is filtered out by the picks or the time filter — those only add a
  // `reasons` label/style. (Sections with no meeting time can't be drawn on
  // a grid at all, so they're dropped here; the mobile sheet lists them.)
  const alternativeGhosts = swapSlot
    ? swapCandidates
        .filter((s) => s.id !== swapSlot.currentSectionId)
        .flatMap((section) => {
          // Every placed section this one would clash with. Clicking it
          // displaces them (the page walks through each), unless one is
          // pinned — then it stays blocked.
          const clashSections = othersCommitted.filter((o) => sectionsConflict(o, section));
          const nameOf = (o) => `${courseMap[o.courseKey]?.courseNumber ?? o.courseKey} ${o.componentLabel || classifyComponent(o)}`;
          const clashes = [...new Set(clashSections.map(nameOf))];
          const pinned = [...new Set(clashSections.filter((o) => lockedSectionIds.has(o.id)).map(nameOf))];
          return toEntries(section, {
            conflict: clashes.length > 0,
            clashes,
            pinned,
            reasons: manual ? [] : swapGhostReasons(section, swapPoolIds, globalTimeFilter),
          });
        })
    : [];
  // The slot's current occupant is drawn as a dashed "Current" ghost too, in
  // the same lane layout as the alternatives (instead of a solid block that
  // an overlapping ghost could sit on top of). Clicking it keeps it.
  const currentSection = swapSlot ? sections.find((s) => s.id === swapSlot.currentSectionId) : null;
  const currentEntries = currentSection
    ? toEntries(currentSection, { conflict: false, clashes: [], pinned: [], reasons: [], isCurrent: true })
    : [];
  const ghostCandidates = [...alternativeGhosts, ...currentEntries];
  const swapCourseCode = swapSlot ? (courseMap[swapSlot.courseKey]?.courseNumber ?? swapSlot.courseKey) : '';
  const swapComponentLabel = swapSlot
    ? (swapCandidates[0]?.componentLabel || swapSlot.component)
    : '';

  // One legend entry per distinct course actually shown — order follows
  // first appearance in sectionIds so it's stable while a preview stays on
  // the same combo, not alphabetical/hash order.
  const seenCourseKeys = new Set();
  const legendCourses = [];
  for (const section of [...sections, ...pending.map((p) => p.section), ...showAllActive]) {
    if (seenCourseKeys.has(section.courseKey)) continue;
    seenCourseKeys.add(section.courseKey);
    legendCourses.push({
      courseKey: section.courseKey,
      label: courseMap[section.courseKey]?.courseNumber ?? section.courseKey,
      missing: missingByCourse[section.courseKey] || null,
    });
  }

  // While swapping, the grid's day range and time range both need to
  // stretch to cover the alternatives too, not just whatever's currently
  // committed — an 8am ghost shouldn't render clipped off the top just
  // because every already-placed class happens to be in the afternoon.
  // Removed spots (mid displace flow): the sections just taken off the schedule,
  // outlined where they were until each gets a replacement or is left out.
  const removedSpots = (swapSlot && displaceInfo ? displaceInfo.removedSections : [])
    .flatMap((section) => toEntries(section));
  // While swapping, whatever currently fills the slot is drawn as the dashed
  // "Current" ghost instead (clicking it keeps it), not as a normal block.
  const isSwapKeep = (section) => Boolean(swapSlot)
    && section.courseKey === swapSlot.courseKey
    && classifyComponent(section) === swapSlot.component;
  // Exam meetings of the committed sections: a thin, non-interactive layer
  // under the class blocks. They count toward the grid's day/time range but
  // never toward lanes or overlaps. Ghosts only mention an exam in their tooltip.
  const examEntries = sections
    .filter((s) => !isSwapKeep(s))
    .flatMap((section) => examMeetings(section).map((meeting, mi) => ({ section, meeting, mi })));
  const allTimed = [
    ...withMeeting,
    ...pending,
    ...showAllTimed,
    ...examEntries,
    ...(swapSlot ? [...ghostCandidates, ...removedSpots] : []),
  ];
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

  const blockName = (s) => `${courseMap[s.courseKey]?.courseNumber ?? s.courseKey} ${s.componentLabel || classifyComponent(s)} ${s.classSection}`;
  const shortName = (s) => describeSectionName(s, courseMap[s.courseKey]?.courseNumber ?? s.courseKey);

  // Manual: section id -> ids of the placed sections it overlaps (on any day).
  const overlapMap = new Map();
  if (manual) {
    const solid = withMeeting.filter((e) => !isSwapKeep(e.section));
    for (const a of solid) {
      for (const b of solid) {
        if (a.section.id === b.section.id) continue;
        if (a.meeting.days.some((d) => entriesOverlapOnDay(a, b, d))) {
          if (!overlapMap.has(a.section.id)) overlapMap.set(a.section.id, new Set());
          overlapMap.get(a.section.id).add(b.section.id);
        }
      }
    }
  }
  const activePopover = popover && overlapMap.has(popover.sectionId) ? popover : null;
  // Whose overlaps are lit: the open popover's section, else the hovered/focused one.
  const hlId = activePopover?.sectionId ?? hoverId;
  const hlPartners = hlId && overlapMap.has(hlId) ? overlapMap.get(hlId) : null;
  const popoverRows = (() => {
    if (!activePopover) return null;
    const ids = [activePopover.sectionId, ...overlapMap.get(activePopover.sectionId)];
    const involved = withMeeting.filter((e) => ids.includes(e.section.id));
    return ids.map((id) => {
      const theirs = involved.filter((e) => e.section.id !== id);
      const times = involved.filter((e) => e.section.id === id).flatMap((e) => {
        const shared = e.meeting.days.filter((d) => theirs.some((o) => entriesOverlapOnDay(e, o, d)));
        return shared.length ? [`${shared.join(' ')} ${formatClockRange(e.meeting.startMin, e.meeting.endMin)}`] : [];
      });
      return { id, label: shortName(sectionsById[id]), time: [...new Set(times)].join(' · ') };
    });
  })();
  function handleFindAnotherTime(id) {
    const others = [activePopover.sectionId, ...overlapMap.get(activePopover.sectionId)].filter((x) => x !== id);
    setPopover(null);
    onFindAnotherTime(sectionsById[id], `${shortName(sectionsById[id])} overlaps ${others.map((x) => shortName(sectionsById[x])).join(' and ')}`);
  }
  function handleRemoveFromPopover(id) {
    setPopover(null);
    onRemovePlaced(id);
  }

  return (
    <div ref={rootRef} className={`sched-grid-wrap${swapSlot && displaceInfo ? ' is-displacing' : ''}`}>
      {manual && resolving && swapSlot && (
        <div className="sched-resolve-bar" role="status">
          <span>Resolving: {resolving.text}</span>
          <button type="button" className="sched-swap-banner-btn sched-swap-banner-cancel" onClick={onCloseSwap}>
            Cancel
          </button>
        </div>
      )}
      {/* Desktop-only banner + ghost overlay — hidden under the mobile
          breakpoint (see scheduler.css), where SchedulerPage's
          SectionSwapSheet takes over instead (a cramped, narrow grid is no
          place to render several overlapping translucent blocks). */}
      {swapSlot && displaceInfo && (
        <div className="sched-swap-banner is-flow" role="status">
          <div className="sched-swap-flow-step">{displaceInfo.lines[0]}</div>
          <div className="sched-swap-flow-todo">{displaceInfo.lines[1]}</div>
          <div className="sched-swap-flow-actions">
            {displaceInfo.noOptions && (
              <button type="button" className="sched-swap-flow-btn is-primary" onClick={onContinueDisplace}>
                Continue
              </button>
            )}
            <button type="button" className="sched-swap-flow-btn sched-swap-banner-cancel" onClick={onCloseSwap}>
              Undo swap
            </button>
          </div>
        </div>
      )}
      {swapSlot && !displaceInfo && (
        <div className="sched-swap-banner">
          <span className="sched-swap-banner-title">
            Showing all other {swapComponentLabel} sections for <strong>{swapCourseCode}</strong> as ghosts. Click one to place it, or click your current one to keep it
          </span>
          <button type="button" className="sched-swap-banner-btn" onClick={onClearSwapSlot}>
            Clear this slot
          </button>
          <button type="button" className="sched-swap-banner-btn sched-swap-banner-cancel" onClick={onCloseSwap}>
            Cancel
          </button>
        </div>
      )}
      {frozenTermLabel && (
        <div className="sched-frozen-note" role="note">
          This schedule is from {frozenTermLabel}.
        </div>
      )}
      <div className="sched-color-legend">
        {legendCourses.map(({ courseKey, label, missing }) => (
          <div className="sched-color-legend-item" key={courseKey}>
            <button
              type="button"
              className={`sched-color-legend-swatch sched-color-${resolvedCourseColorIndex(courseKey, courseColors)}${missing ? ' is-incomplete' : ''}`}
              onClick={() => setOpenColorFor((cur) => (cur === courseKey ? null : courseKey))}
              aria-haspopup="true"
              aria-expanded={openColorFor === courseKey}
              aria-label={`Change color for ${label}${missing ? ` (not complete: needs ${missing.join(', ')})` : ''}`}
              title={missing ? `${label} isn't complete yet: needs ${missing.join(', ')}. Click to change its color` : `Change color for ${label}`}
            />
            <span className="sched-color-legend-label">{label}</span>
            {openColorFor === courseKey && (
              <ColorPickerPopover
                current={resolvedCourseColorIndex(courseKey, courseColors)}
                usedBy={slotsUsedByOthers(courseKey, courseColors, courseMap)}
                onPick={(idx) => {
                  onSetColor(courseKey, idx);
                  setOpenColorFor(null);
                }}
                onClose={() => setOpenColorFor(null)}
              />
            )}
          </div>
        ))}
        {showAllActive.length > 0 && (
          <button type="button" className="sched-clear-ghosts-btn" onClick={onClearGhosts}>
            Clear ghosts
          </button>
        )}
      </div>
      {/* Always-visible key for the block action buttons below — the title
          tooltips are hover-only, so they never reach touch users. Reuses
          the same glyphs so the key can't drift from the buttons. */}
      {legendCourses.length > 0 && manual && (
        <ul className="sched-block-key">
          <li className="sched-block-key-item">
            <span className="sched-block-key-icon" aria-hidden="true"><SwapIcon /></span>
            Overlay other sections on your schedule
          </li>
          <li className="sched-block-key-item">
            <span className="sched-block-key-icon sched-block-key-icon-x" aria-hidden="true">×</span>
            Remove from this schedule
          </li>
        </ul>
      )}
      {legendCourses.length > 0 && !manual && (
        <ul className="sched-block-key">
          <li className="sched-block-key-item">
            <span className="sched-block-key-icon" aria-hidden="true"><PinIcon /></span>
            Lock this section into every schedule
          </li>
          <li className="sched-block-key-item">
            <span className="sched-block-key-icon" aria-hidden="true"><SwapIcon /></span>
            {/* Mobile gets SectionSwapSheet's list instead of ghosts (see
                scheduler.css's 860px breakpoint), so the wording follows. */}
            <span className="sched-block-key-desktop">Overlay other sections on your schedule</span>
            <span className="sched-block-key-mobile">See other sections for this class</span>
          </li>
          <li className="sched-block-key-item">
            <span className="sched-block-key-icon sched-block-key-icon-x" aria-hidden="true">×</span>
            Remove from consideration
          </li>
        </ul>
      )}
      <div className="sched-grid-header">
        <div className="sched-grid-time-gutter" />
        {days.map((d) => (
          <div key={d} className="sched-grid-day-label">{d}</div>
        ))}
      </div>
      <div className="sched-grid-body" style={{ height: gridHeight }}>
        <div className="sched-grid-time-gutter" style={{ minHeight: gridHeight }}>
          {hours.map((h) => (
            <div key={h} className="sched-grid-hour-label" style={{ top: (h * 60 - gridStart) * PX_PER_MIN }}>
              {formatHourLabel(h)}
            </div>
          ))}
        </div>
        <div
          className="sched-grid-days"
          style={{ backgroundSize: `100% ${hourPx}px`, backgroundPosition: '0 0', minHeight: gridHeight }}
        >
          {days.map((day) => (
            <div key={day} className="sched-grid-day-col">
              {/* Before the real blocks, so a placed class is never overdrawn by its label. */}
              {removedSpots.filter((r) => r.meeting.days.includes(day)).map(({ section, meeting, mi }) => (
                <div
                  key={`removed-${section.id}-${day}-${mi}`}
                  className={`sched-grid-removed sched-color-${resolvedCourseColorIndex(section.courseKey, courseColors)}`}
                  style={{
                    top: (meeting.startMin - gridStart) * PX_PER_MIN,
                    height: Math.max(MIN_BLOCK_HEIGHT, (meeting.endMin - meeting.startMin) * PX_PER_MIN),
                  }}
                  title={`Removed — ${courseMap[section.courseKey]?.courseNumber ?? section.courseKey} ${section.componentLabel || classifyComponent(section)} ${section.classSection}`}
                >
                  <span className="sched-grid-removed-label">
                    Removed: <s>{courseMap[section.courseKey]?.courseNumber ?? section.courseKey} {section.classSection}</s>
                  </span>
                  <span className="sched-grid-removed-time"><s>{formatClock(meeting.startMin)}–{formatClock(meeting.endMin)}</s></span>
                </div>
              ))}
              {(() => {
                // Classes that overlap on this day share the column in
                // side-by-side lanes (same packing as the swap ghosts), so
                // each stays readable instead of being drawn on top of another.
                // Faint "not finished" blocks share the lanes too, so they
                // never print over a real class (they don't count as overlaps).
                const dayBlocks = withMeeting.filter((m) => m.meeting.days.includes(day) && !isSwapKeep(m.section));
                const dayPending = pending.filter((p) => p.meeting.days.includes(day));
                return layoutGhostsForDay([...dayBlocks, ...dayPending]).map(({ section, meeting, mi, lane, laneCount, isPending }) => {
                  const courseCode = courseMap[section.courseKey]?.courseNumber ?? section.courseKey;
                  const laneStyle = laneCount > 1
                    ? { left: `calc(${(lane / laneCount) * 100}% + 2px)`, width: `calc(${100 / laneCount}% - 4px)`, right: 'auto' }
                    : null;
                  if (isPending) {
                    return (
                      <div
                        key={`pending-${section.id}-${day}-${mi}`}
                        className={`sched-grid-pending sched-color-${resolvedCourseColorIndex(section.courseKey, courseColors)}`}
                        style={{
                          top: (meeting.startMin - gridStart) * PX_PER_MIN,
                          height: Math.max(MIN_BLOCK_HEIGHT, (meeting.endMin - meeting.startMin) * PX_PER_MIN),
                          ...laneStyle,
                        }}
                        title={`${courseCode} · ${sectionTypeLabel(section).abbr} ${section.classSection}${missingByCourse[section.courseKey] ? ` · needs ${missingByCourse[section.courseKey].join(', ')}` : ' · not finished'}\n${longName(courseCode, section)} · ${describeMeetingShort(meeting)}${meeting.facilId ? ` · ${meeting.facilId}` : ''}${describeInstructors(section) ? ` · ${describeInstructors(section)}` : ''}`}
                      >
                        <span className="sched-grid-pending-chip">
                          {missingByCourse[section.courseKey] ? `needs ${missingByCourse[section.courseKey].join(', ')}` : 'not finished'}
                        </span>
                        <div className="sched-lane-text">
                          <span className="sched-grid-block-code"><CourseCode courseCode={courseCode} /></span>
                          <TypeLine section={section} start={formatClock(meeting.startMin)} />
                          <span className="sched-grid-block-time">{formatClock(meeting.startMin)}–{formatClock(meeting.endMin)}</span>
                        </div>
                      </div>
                    );
                  }
                  const isLocked = lockedSectionIds.has(section.id);
                  const profLastName = section.instructors?.[0]?.last || null;
                  const room = meeting.facilId || null;
                  // Course code + time always show; professor/room only
                  // once the block is actually tall enough for them, so a
                  // short class shows fewer, complete lines instead of a
                  // 4th line clipped halfway through — see the threshold
                  // constants above.
                  const blockHeight = Math.max(MIN_BLOCK_HEIGHT, (meeting.endMin - meeting.startMin) * PX_PER_MIN);
                  const showProf = Boolean(profLastName) && blockHeight >= PROF_LINE_THRESHOLD;
                  const showRoom = Boolean(room) && blockHeight >= ROOM_LINE_THRESHOLD;
                  // Other classes on this day whose times actually intersect
                  // this one's (lanes alone can't say: a cluster is transitive).
                  const overlapsHere = dayBlocks.filter((o) => entriesOverlapOnDay(o, { section, meeting }, day));
                  const hasOverlap = overlapsHere.length > 0;
                  const blockTitle = `${longName(courseCode, section)} · ${describeMeetingShort(meeting)}${meeting.facilId ? ` · ${meeting.facilId}` : ''}${describeInstructors(section) ? ` · ${describeInstructors(section)}` : ''}${hasOverlap ? `\nOverlaps ${[...new Set(overlapsHere.map((o) => blockName(o.section)))].join(', ')}` : ''}`;

                  return (
                    <div
                      key={`${section.id}-${day}-${mi}`}
                      data-section-id={section.id}
                      data-day={day}
                      className={`sched-grid-block sched-color-${resolvedCourseColorIndex(section.courseKey, courseColors)}${isLocked ? ' is-locked' : ''}${hasOverlap ? ' has-overlap' : ''}${swapSlot && displaceInfo && displaceInfo.swappedInId === section.id ? ' is-swapped-in' : ''}${hlPartners && hlPartners.has(section.id) ? ' is-overlap-hl' : ''}${hlPartners && section.id !== hlId && !hlPartners.has(section.id) ? ' is-dimmed' : ''}${pulseKeys.has(`${section.id}|${day}`) ? ' is-pulse' : ''}`}
                      style={{
                        top: (meeting.startMin - gridStart) * PX_PER_MIN,
                        height: blockHeight,
                        ...laneStyle,
                      }}
                      title={blockTitle}
                      tabIndex={manual && overlapMap.has(section.id) ? 0 : undefined}
                      onMouseEnter={manual && overlapMap.has(section.id) ? () => setHoverId(section.id) : undefined}
                      onMouseLeave={manual ? () => setHoverId(null) : undefined}
                      onFocus={manual && overlapMap.has(section.id) ? () => setHoverId(section.id) : undefined}
                      onBlur={manual ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHoverId(null); } : undefined}
                    >
                      <div className="sched-grid-block-actions">
                        {swapSlot && displaceInfo && displaceInfo.swappedInId === section.id && (
                          <span className="sched-grid-block-chip">Swapped in</span>
                        )}
                        {hasOverlap && !manual && (
                          <span className="sched-grid-block-chip is-overlap">overlap</span>
                        )}
                        {hasOverlap && manual && (
                          <button
                            type="button"
                            className="sched-grid-block-chip is-overlap"
                            aria-haspopup="dialog"
                            aria-expanded={activePopover?.sectionId === section.id}
                            title="See what overlaps and fix it"
                            onClick={(e) => {
                              e.stopPropagation();
                              const chip = e.currentTarget;
                              setPopover((cur) => (cur && cur.sectionId === section.id ? null : { sectionId: section.id, anchorEl: chip }));
                            }}
                          >
                            overlap
                          </button>
                        )}
                        {manual && (
                          <button
                            type="button"
                            className="sched-grid-block-action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenSwap(section.courseKey, classifyComponent(section), section.id);
                            }}
                            aria-label={`Overlay other sections for ${courseCode}'s ${section.componentLabel || 'section'} as ghosts on your schedule`}
                            title="Overlay other sections as ghosts. Click one to swap it in (overlaps are allowed)"
                          >
                            <SwapIcon />
                          </button>
                        )}
                        {manual && (
                          <button
                            type="button"
                            className="sched-grid-block-action-btn sched-grid-block-eliminate-btn"
                            onClick={(e) => { e.stopPropagation(); onRemovePlaced(section.id); }}
                            aria-label={`Remove ${courseCode} section ${section.classSection} from this schedule`}
                            title="Remove from this schedule"
                          >
                            ×
                          </button>
                        )}
                        {!manual && (<>
                        <button
                          type="button"
                          className={`sched-grid-block-action-btn${isLocked ? ' is-locked' : ''}`}
                          disabled={Boolean(frozenTermLabel)}
                          onClick={(e) => { e.stopPropagation(); onToggleLock(section.id); }}
                          aria-label={isLocked ? `Unlock ${courseCode} section ${section.classSection}` : `Lock ${courseCode} section ${section.classSection} into every generated schedule`}
                          title={isLocked ? 'Locked into every generated schedule — click to unlock' : 'Lock this section into every generated schedule'}
                        >
                          <PinIcon filled={isLocked} />
                        </button>
                        <button
                          type="button"
                          className="sched-grid-block-action-btn"
                          disabled={Boolean(frozenTermLabel)}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSwap(section.courseKey, classifyComponent(section), section.id);
                          }}
                          aria-label={`Overlay other sections for ${courseCode}'s ${section.componentLabel || 'section'} as ghosts on your schedule`}
                          title={frozenTermLabel ? `This schedule is from ${frozenTermLabel}` : 'Overlay other sections as ghosts on your schedule. Click one to swap it in'}
                        >
                          <SwapIcon />
                        </button>
                        <button
                          type="button"
                          className="sched-grid-block-action-btn sched-grid-block-eliminate-btn"
                          disabled={Boolean(frozenTermLabel)}
                          onClick={(e) => { e.stopPropagation(); onEliminate(section.id); }}
                          aria-label={`Remove ${courseCode} section ${section.classSection} from consideration`}
                          title="Remove from consideration — won't appear in any future generated schedule"
                        >
                          ×
                        </button>
                        </>)}
                      </div>
                      <div className="sched-lane-text">
                        <span className="sched-grid-block-code"><CourseCode courseCode={courseCode} /></span>
                        <TypeLine section={section} start={formatClock(meeting.startMin)} />
                        <span className="sched-grid-block-time">{formatClock(meeting.startMin)}–{formatClock(meeting.endMin)}</span>
                        {showProf && <span className="sched-grid-block-prof">{profLastName}</span>}
                        {showRoom && <span className="sched-grid-block-room">{room}</span>}
                      </div>
                    </div>
                  );
                });
              })()}
              {/* Exam meetings: a full-width dashed overlay above the class blocks
                  with pointer-events: none, so a class beneath stays visible and
                  clickable. Never in the lanes, never an overlap. Only its small
                  label pill takes the pointer (for the tooltip). */}
              {examEntries.filter((x) => x.meeting.days.includes(day)).map(({ section, meeting, mi }) => {
                const examCode = courseMap[section.courseKey]?.courseNumber ?? section.courseKey;
                const examHeight = Math.max(18, (meeting.endMin - meeting.startMin) * PX_PER_MIN);
                const range = formatClockRange(meeting.startMin, meeting.endMin);
                const shortCode = shortCourseCode(examCode);
                const examTip = [
                  `Exam — ${examCode} ${section.classSection}`,
                  `${day} ${formatClock(meeting.startMin)}–${formatClock(meeting.endMin)}`,
                  meeting.facilId,
                ].filter(Boolean).join('\n');
                const showPill = examHeight >= EXAM_LABEL_MIN_HEIGHT;
                const corner = showPill
                  ? pickExamCorner(meeting, layoutGhostsForDay([
                    ...withMeeting.filter((m) => m.meeting.days.includes(day) && !isSwapKeep(m.section)),
                    ...pending.filter((p) => p.meeting.days.includes(day)),
                  ]))
                  : null;
                return (
                  <div
                    key={`exam-${section.id}-${day}-${mi}`}
                    className={`sched-grid-exam sched-color-${resolvedCourseColorIndex(section.courseKey, courseColors)}`}
                    style={{ top: (meeting.startMin - gridStart) * PX_PER_MIN, height: examHeight }}
                    title={showPill ? undefined : examTip}
                  >
                    {showPill && (
                      <span className={`sched-grid-exam-label is-${corner}`} title={examTip}>
                        <span className="sched-grid-exam-full">{examCode} · Exam {range}</span>
                        <span className="sched-grid-exam-two"><span>{examCode}</span><span>Exam {range}</span></span>
                        <span className="sched-grid-exam-short">{shortCode} exam</span>
                      </span>
                    )}
                  </div>
                );
              })}
              {swapSlot && layoutGhostsForDay(ghostCandidates.filter((g) => g.meeting.days.includes(day))).map((ghost) => {
                const { section, meeting, mi, conflict, lane, laneCount, isCurrent } = ghost;
                const blocked = ghost.pinned.length > 0;
                const courseCode = courseMap[section.courseKey]?.courseNumber ?? section.courseKey;
                const blockHeight = Math.max(MIN_BLOCK_HEIGHT, (meeting.endMin - meeting.startMin) * PX_PER_MIN);
                const instructorLabel = describeInstructors(section) || 'Staff';
                const fits = manual && !isCurrent && !conflict;
                const tooltip = [
                  `${isCurrent ? (manual ? 'Keep this section (click to leave swap mode) — ' : 'Keep this section — ') : ''}${longName(courseCode, section)}`,
                  ...(blocked
                    ? [`Can't place — conflicts with pinned ${ghost.pinned.join(', ')}`]
                    : conflict
                      ? [manual ? `Overlaps ${ghost.clashes.join(', ')} (allowed)` : `Swap in — replaces ${ghost.clashes.join(', ')}`]
                      : fits ? ['Fits — no overlap with your other sections'] : []),
                  ...(ghost.reasons.length > 0 ? [ghost.reasons.map((r) => r.text).join(' · ')] : []),
                  describeSectionTime(section),
                  ...(describeExamTime(section) ? [`Exam: ${describeExamTime(section)}`] : []),
                  instructorLabel,
                  describeSeatStatus(section),
                ].join('\n');

                return (
                  <div
                    key={`ghost-${section.id}-${day}-${mi}`}
                    role="button"
                    tabIndex={0}
                    aria-disabled={blocked || undefined}
                    className={`sched-grid-ghost-block sched-color-${resolvedCourseColorIndex(section.courseKey, courseColors)}${isCurrent ? ' is-current' : ''}${conflict ? ' has-conflict' : ''}${fits ? ' is-fits' : ''}${blocked ? ' is-blocked' : ''}${ghost.reasons.some((r) => r.key === 'unpicked') ? ' is-unpicked' : ''}${ghost.reasons.some((r) => r.key === 'filtered') ? ' is-filtered' : ''}`}
                    style={{
                      top: (meeting.startMin - gridStart) * PX_PER_MIN,
                      height: blockHeight,
                      left: `${(lane / laneCount) * 100}%`,
                      width: `${100 / laneCount}%`,
                    }}
                    title={tooltip}
                    onClick={isCurrent ? onCloseSwap : blocked ? undefined : () => onSelectSwapSection(section.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (isCurrent) onCloseSwap();
                        else if (!blocked) onSelectSwapSection(section.id);
                      }
                    }}
                  >
                    <span className="sched-grid-ghost-icon" aria-hidden="true"><SwapIcon /></span>
                    <div className="sched-lane-text">
                      <GhostHead courseCode={courseCode}>
                        {isCurrent && <span className="sched-grid-ghost-chip is-current">Current</span>}
                        {conflict && <span className="sched-grid-ghost-chip is-conflict">{manual ? 'overlap' : 'conflict'}</span>}
                        {fits && <span className="sched-grid-ghost-chip is-fits">fits</span>}
                      </GhostHead>
                      <TypeLine section={section} start={formatClock(meeting.startMin)} />
                      <GhostTime>{formatClock(meeting.startMin)}–{formatClock(meeting.endMin)}</GhostTime>
                    </div>
                  </div>
                );
              })}
              {layoutGhostsForDay(showAllTimed.filter((g) => g.meeting.days.includes(day))).map(({ section, meeting, mi, lane, laneCount }) => {
                // What it would overlap among what's drawn on this day.
                const clashes = [...withMeeting, ...pending].filter((o) => entriesOverlapOnDay(o, { section, meeting }, day));
                const overlap = clashes.length > 0;
                const toggles = !onPlaceGhost && Boolean(onToggleGhost);
                const clickable = Boolean(onPlaceGhost) || toggles;
                const selected = toggles && selectedGhostIds.has(section.id);
                const ghostCourseCode = courseMap[section.courseKey]?.courseNumber ?? section.courseKey;
                const onGhostClick = () => (onPlaceGhost ? onPlaceGhost(section.id) : onToggleGhost(section.id));
                const tooltip = [
                  `${longName(ghostCourseCode, section)} · ${describeMeetingShort(meeting)}${meeting.facilId ? ` · ${meeting.facilId}` : ''}${describeInstructors(section) ? ` · ${describeInstructors(section)}` : ''}${onPlaceGhost ? ' — click to place' : toggles ? (selected ? ' — selected, click to unselect' : ' — click to select') : ''}`,
                  ...(overlap ? [`Overlaps ${[...new Set(clashes.map((o) => blockName(o.section)))].join(', ')}`] : []),
                  describeSectionTime(section),
                  ...(describeExamTime(section) ? [`Exam: ${describeExamTime(section)}`] : []),
                  describeSeatStatus(section),
                ].join('\n');
                return (
                  <div
                    key={`showall-${section.id}-${day}-${mi}`}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    aria-pressed={toggles ? selected : undefined}
                    className={`sched-grid-ghost-block sched-color-${resolvedCourseColorIndex(section.courseKey, courseColors)}${overlap ? ' has-conflict' : ''}${clickable ? '' : ' is-display-only'}${selected ? ' is-selected' : ''}`}
                    style={{
                      top: (meeting.startMin - gridStart) * PX_PER_MIN,
                      height: Math.max(MIN_BLOCK_HEIGHT, (meeting.endMin - meeting.startMin) * PX_PER_MIN),
                      left: `${(lane / laneCount) * 100}%`,
                      width: `${100 / laneCount}%`,
                    }}
                    title={tooltip}
                    onClick={clickable ? onGhostClick : undefined}
                    onKeyDown={clickable ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onGhostClick();
                      }
                    } : undefined}
                  >
                    {selected
                      ? <span className="sched-grid-ghost-icon is-check" aria-hidden="true">✓</span>
                      : <span className="sched-grid-ghost-icon" aria-hidden="true"><SwapIcon /></span>}
                    <div className="sched-lane-text">
                      <GhostHead courseCode={ghostCourseCode}>
                        {overlap && <span className="sched-grid-ghost-chip is-conflict">overlap</span>}
                      </GhostHead>
                      <TypeLine section={section} start={formatClock(meeting.startMin)} />
                      <GhostTime>{formatClock(meeting.startMin)}–{formatClock(meeting.endMin)}</GhostTime>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {showAllUntimed.length > 0 && (
        <div className="sched-grid-no-meeting">
          Not drawn (no meeting time): {showAllUntimed
            .map((s) => `${courseMap[s.courseKey]?.courseNumber ?? s.courseKey} (${s.classSection})`)
            .join(', ')}
        </div>
      )}
      {activePopover && popoverRows && (
        <OverlapPopover
          anchorEl={activePopover.anchorEl}
          rows={popoverRows}
          onFindAnotherTime={handleFindAnotherTime}
          onRemove={handleRemoveFromPopover}
          onClose={() => setPopover(null)}
        />
      )}
      {incompleteLabels.length > 0 && (
        <div className="sched-grid-incomplete" role="note">
          Incomplete — left out: {incompleteLabels.join(', ')}
        </div>
      )}
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
