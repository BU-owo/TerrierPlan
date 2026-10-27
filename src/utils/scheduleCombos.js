import { sectionsConflict, classMeetings, describeSectionTime, formatClock, formatClockRange } from './sectionTime.js';
import { classifyComponent, groupSectionsByComponent, UNKNOWN_KEY } from './sectionComponents.js';
import { describeSectionName } from './sectionType.js';
import { isVisibleSection } from './sectionVisibility.js';

// Safety valves against a pathological input (e.g. 8 courses × 6 sections
// each = 1.6M raw combinations) freezing the tab — NOT the "artificial cap
// on results shown" the scheduler is explicitly built to avoid. Generation
// still explores/returns far more than the old ~10-result limit; these only
// guard against genuinely runaway input, and the UI says so explicitly
// rather than truncating silently.
export const MAX_EXPLORED = 200_000;
export const MAX_RESULTS = 2_000;

// slots: [{ options: sectionId[] }] — a generic "pick exactly one from each
// slot, with no time conflict against anything else picked" combinatorics
// core. It has no notion of "course" or "component"; see
// buildGenerationSlots below for how draftCourses become slots.
//
// The strict search (strictSearch below) fills slots fewest-options-first,
// and after each pick drops every option in the still-unfilled slots that
// conflicts with it, backtracking as soon as one of them runs out. Each
// schedule is one section id per non-empty slot, in the slots' original
// order, and the batch is sorted by that id tuple, so what's shown never
// depends on the order the search happened to visit things in.
//
// Not truncated, this is exactly the set of schedules a plain slot-by-slot
// backtrack finds. Truncated (MAX_RESULTS or MAX_EXPLORED hit), it's a
// different partial set than that search would stop at: just the first
// ones this search reached, then sorted.
//
// `allowOverlaps`: time conflicts stop being failures — see
// generateRankedByOverlap below. Off, this is unchanged.
export function generateSchedules(slots, sectionsById, { limit = MAX_RESULTS, allowOverlaps = false } = {}) {
  if (allowOverlaps) return generateRankedByOverlap(slots, sectionsById, limit);
  const search = strictSearch(slots, sectionsById, limit);
  let step = search.next();
  while (!step.done) step = search.next();
  return step.value;
}

// Same search and same results (same order, same caps) as generateSchedules'
// strict path, but hands control back to the browser every `yieldEvery`
// nodes — the Scheduler runs it automatically on every draft edit, and a
// big draft must not freeze typing or checkboxes. `isCancelled()` is
// checked at each yield; a cancelled run resolves to null.
export async function generateSchedulesAsync(slots, sectionsById, { limit = MAX_RESULTS, yieldEvery = 2000, isCancelled = () => false } = {}) {
  const search = strictSearch(slots, sectionsById, limit);
  let sinceYield = 0;
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
    if (++sinceYield >= yieldEvery) {
      sinceYield = 0;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (isCancelled()) return null;
    }
  }
}

// The strict search shared by both entry points: a generator that yields
// once per node visited (an option tried in a slot, counted against
// MAX_EXPLORED) and returns { schedules, truncated, explored }.
function* strictSearch(slots, sectionsById, limit) {
  const lists = slots.filter((s) => s.options.length > 0).map((s) => s.options);
  const schedules = [];
  let explored = 0;
  let truncated = false;
  if (lists.length === 0) return { schedules, truncated, explored };

  // order[k]: the original slot filled at depth k. A section with no data
  // can't be in a schedule, so it never enters a domain.
  const initial = lists.map((options) => options.filter((id) => sectionsById[id]));
  const order = lists.map((_, i) => i).sort((a, b) => initial[a].length - initial[b].length || a - b);
  const n = order.length;
  // domains[d][k] (k >= d): what's still open for depth k given the picks at
  // depths < d. Each depth keeps its own copy so backtracking just steps back.
  const domains = [order.map((i) => initial[i])];
  const next = new Array(n).fill(0); // next option to try per depth
  const chosen = new Array(n);
  let d = 0;
  while (d >= 0) {
    if (d === n) {
      const schedule = new Array(n);
      for (let k = 0; k < n; k++) schedule[order[k]] = chosen[k];
      schedules.push(schedule);
      if (schedules.length >= limit) {
        truncated = true;
        break;
      }
      d--;
      continue;
    }
    const options = domains[d][d];
    if (next[d] >= options.length) {
      next[d] = 0;
      d--;
      continue;
    }
    const sectionId = options[next[d]++];
    explored++;
    if (explored > MAX_EXPLORED) {
      truncated = true;
      break;
    }
    yield;
    // Forward check: everything left in domains[d] already fits the earlier
    // picks, so only conflicts with this one need removing.
    const section = sectionsById[sectionId];
    const pruned = domains[d].slice();
    let deadEnd = false;
    for (let k = d + 1; k < n; k++) {
      const kept = domains[d][k].filter((id) => !sectionsConflict(section, sectionsById[id]));
      if (kept.length === 0) {
        deadEnd = true;
        break;
      }
      pruned[k] = kept;
    }
    if (deadEnd) continue;
    chosen[d] = sectionId;
    domains[d + 1] = pruned;
    d++;
  }

  schedules.sort(compareIdTuples);
  return { schedules, truncated, explored };
}

function compareIdTuples(a, b) {
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}

// How the generated batch can be ordered (the stepper's sort dropdown).
// 'default' is the batch's own id-tuple order.
export const SCHEDULE_SORT_OPTIONS = [
  { value: 'default', label: 'Section order' },
  { value: 'latestFirstStart', label: 'Latest start (no early classes)' },
  { value: 'earliestLastEnd', label: 'Earliest end (done early)' },
  { value: 'fewestDays', label: 'Fewest days (more days off)' },
  { value: 'leastGap', label: 'Shortest gaps (no big breaks)' },
];

// { firstStart, lastEnd, avgStart, avgFinish, days, gap } (minutes; days is a
// count) from the class meetings of a set of section ids, or null when none
// of them has a timed class (exam meetings and no-meeting sections don't
// count). A meeting counts on each of its days. firstStart / lastEnd are the
// earliest start and latest end across the whole week. Per weekday: first
// start, last end, and gap = the sum of max(0, nextStart - latestEndSoFar) in
// start order, so overlapping meetings never create a false gap; avgStart /
// avgFinish are the means of the per-day first starts / last ends.
export function scheduleStats(sectionIds, sectionsById) {
  const byDay = {};
  for (const id of sectionIds) {
    for (const m of classMeetings(sectionsById[id])) {
      for (const day of m.days) (byDay[day] ??= []).push(m);
    }
  }
  const days = Object.values(byDay);
  if (days.length === 0) return null;
  let startSum = 0;
  let finishSum = 0;
  let firstStart = Infinity;
  let lastEnd = -Infinity;
  let gap = 0;
  for (const meetings of days) {
    meetings.sort((a, b) => a.startMin - b.startMin);
    let latestEnd = meetings[0].endMin;
    startSum += meetings[0].startMin;
    firstStart = Math.min(firstStart, meetings[0].startMin);
    for (let i = 1; i < meetings.length; i++) {
      gap += Math.max(0, meetings[i].startMin - latestEnd);
      latestEnd = Math.max(latestEnd, meetings[i].endMin);
    }
    finishSum += latestEnd;
    lastEnd = Math.max(lastEnd, latestEnd);
  }
  return { firstStart, lastEnd, avgStart: startSum / days.length, avgFinish: finishSum / days.length, days: days.length, gap };
}

// "4 days · 10:10am–4:15pm" for a bookmark row, from scheduleStats (class
// meetings only), or '' when none of the sections has a timed class.
export function scheduleSummary(sectionIds, sectionsById) {
  const stats = scheduleStats(sectionIds, sectionsById);
  if (!stats) return '';
  return `${stats.days} day${stats.days === 1 ? '' : 's'} · ${formatClock(stats.firstStart)}–${formatClock(stats.lastEnd)}`;
}

// "3 · 5d · 8:00–9:30pm" for a bookmark chip, n being its position in the strip
// (the compact form of scheduleSummary; am/pm is dropped from the start when it
// matches the end), or "3 · No times" when none of the sections has a timed class.
export function scheduleChipLabel(sectionIds, sectionsById, n) {
  const stats = scheduleStats(sectionIds, sectionsById);
  const rest = stats ? `${stats.days}d · ${formatClockRange(stats.firstStart, stats.lastEnd)}` : 'No times';
  return n == null ? rest : `${n} · ${rest}`;
}

// Each mode's sort key: numbers compared in order, smallest first (so a
// descending one is negated). The first is the primary, the rest tie-breaks.
const SORT_KEYS = {
  latestFirstStart: (s) => [-s.firstStart, -s.avgStart],
  earliestLastEnd: (s) => [s.lastEnd, s.avgFinish],
  fewestDays: (s) => [s.days],
  leastGap: (s) => [s.gap],
};

function compareKeys(a, b) {
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== b[k]) return a[k] - b[k];
  }
  return 0;
}

// A new array of `schedules` ordered by `mode` (see SCHEDULE_SORT_OPTIONS).
// Schedules with no timed classes go last in every mode, and ties (and the
// 'default' mode, or an unknown one) fall back to the id-tuple order, so the
// result only depends on the set of schedules, not on their incoming order.
export function sortSchedules(schedules, mode, sectionsById) {
  const keyOf = SORT_KEYS[mode];
  if (!keyOf) return [...schedules].sort(compareIdTuples);
  const decorated = schedules.map((ids) => {
    const stats = scheduleStats(ids, sectionsById);
    return { ids, key: stats ? keyOf(stats) : null };
  });
  decorated.sort((a, b) => {
    if (a.key === null || b.key === null) {
      if (a.key === b.key) return compareIdTuples(a.ids, b.ids);
      return a.key === null ? 1 : -1;
    }
    return compareKeys(a.key, b.key) || compareIdTuples(a.ids, b.ids);
  });
  return decorated.map((d) => d.ids);
}

// Where "Prev bookmark" / "Next bookmark" go from the schedule on screen.
// `keys` are the bookmarks' keys in chip order. n is the on-screen schedule's
// 1-based chip number, or 0 when it isn't bookmarked; then Next goes to the first
// bookmark and Prev to the last. Null means there's nowhere to go (no wrapping).
export function bookmarkStep(keys, currentKey) {
  const i = keys.indexOf(currentKey);
  if (keys.length === 0) return { n: 0, prevKey: null, nextKey: null };
  if (i === -1) return { n: 0, prevKey: keys[keys.length - 1], nextKey: keys[0] };
  return { n: i + 1, prevKey: i > 0 ? keys[i - 1] : null, nextKey: i < keys.length - 1 ? keys[i + 1] : null };
}

// What state each bookmark chip is in, by key: { inBatch, stale, staleReason }.
// inBatch: its content key is in `batchKeys` (a Set of scheduleKey for the current
// results; null means "don't care" and counts as in). stale: a section is gone from
// `sectionsById` or hidden, see isVisibleSection ("section changed"), or its course is no longer in
// the draft ("course removed"). A stale or out-of-results bookmark still previews.
// `bookmarks` is [{ key, sectionIds }].
export function bookmarkChipStates(bookmarks, batchKeys, sectionsById, draftCourseKeys) {
  const states = {};
  for (const { key, sectionIds } of bookmarks) {
    const sections = sectionIds.map((id) => sectionsById[id]);
    let staleReason = null;
    if (sections.some((s) => !s || !isVisibleSection(s))) staleReason = 'section changed';
    else if (sections.some((s) => !draftCourseKeys.has(s.courseKey))) staleReason = 'course removed';
    states[key] = { inBatch: batchKeys ? batchKeys.has(key) : true, stale: staleReason !== null, staleReason };
  }
  return states;
}

// Minutes two sections overlap in a week, summed over every pair of their
// class meetings (overlap per shared day × shared days), 0 if they don't, or
// if they're the same section. Positive exactly when sectionsConflict is true.
export function overlapMinutes(a, b) {
  if (a === b || (a?.id != null && a.id === b?.id)) return 0;
  let total = 0;
  for (const ma of classMeetings(a)) {
    for (const mb of classMeetings(b)) {
      const sharedDays = ma.days.filter((d) => mb.days.includes(d)).length;
      const perDay = Math.min(ma.endMin, mb.endMin) - Math.max(ma.startMin, mb.startMin);
      if (sharedDays > 0 && perDay > 0) total += sharedDays * perDay;
    }
  }
  return total;
}

// { pairs, minutes } for a set of section ids: how many pairs of sections
// overlap, and the total overlap time. Used for the stepper header and the
// bookmarked/saved rows, so it works for any schedule, generated or not.
export function overlapSummary(sectionIds, sectionsById) {
  const sections = sectionIds.map((id) => sectionsById[id]).filter(Boolean);
  let pairs = 0;
  let minutes = 0;
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const m = overlapMinutes(sections[i], sections[j]);
      if (m > 0) {
        pairs++;
        minutes += m;
      }
    }
  }
  return { pairs, minutes };
}

// "Allow overlaps" generation: still one pick per slot, but a time conflict
// only costs a point instead of pruning the branch. Results come back
// fewest overlapping pairs first, then least total overlap time — so every
// conflict-free schedule comes first, then the one-overlap ones, and so on.
//
// Search is depth-first branch-and-bound that keeps only the best `limit`
// combinations seen (a max-heap on [pairs, minutes]):
// - at each step it tries the options that add the fewest overlaps first,
//   so low-overlap schedules are found early;
// - once `limit` are kept, any branch that's already no better than the
//   worst kept one is cut (overlaps only ever grow along a branch);
// - `explored` counts every option tried and stops the search past
//   MAX_EXPLORED, like the strict search.
// Memory never exceeds `limit` schedules. Without the MAX_EXPLORED stop the
// result is exactly the best `limit`; with it, it's the best found so far
// (still sorted), and `truncated` says so either way.
// (Iterative deepening — "all with 0 overlaps, then ≤1, …" — was tried
// first: with many mutually-overlapping courses every schedule has many
// overlaps and it used the whole budget on the empty low levels, returning
// nothing at all.)
function generateRankedByOverlap(slots, sectionsById, limit) {
  const lists = slots.filter((s) => s.options.length > 0).map((s) => s.options);
  let explored = 0;
  let truncated = false;
  if (lists.length === 0) return { schedules: [], truncated, allowOverlaps: true };

  const pairCache = new Map();
  function pairCost(idA, idB) {
    const key = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    let m = pairCache.get(key);
    if (m === undefined) {
      m = overlapMinutes(sectionsById[idA], sectionsById[idB]);
      pairCache.set(key, m);
    }
    return m;
  }

  // Max-heap of kept results; heap[0] is the worst kept one. `seq` keeps
  // ties in discovery order.
  const heap = [];
  const worse = (a, b) => a.pairs !== b.pairs ? a.pairs > b.pairs
    : a.minutes !== b.minutes ? a.minutes > b.minutes : a.seq > b.seq;
  function siftUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!worse(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  }
  function siftDown(i) {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && worse(heap[l], heap[m])) m = l;
      if (r < heap.length && worse(heap[r], heap[m])) m = r;
      if (m === i) break;
      [heap[i], heap[m]] = [heap[m], heap[i]];
      i = m;
    }
  }
  // Can a (pairs, minutes) branch still beat the worst kept result?
  const canImprove = (pairs, minutes) => heap.length < limit
    || pairs < heap[0].pairs || (pairs === heap[0].pairs && minutes < heap[0].minutes);

  let seq = 0;
  function search(i, chosen, pairs, minutes) {
    if (i === lists.length) {
      const entry = { ids: [...chosen], pairs, minutes, seq: seq++ };
      if (heap.length < limit) {
        heap.push(entry);
        siftUp(heap.length - 1);
      } else {
        heap[0] = entry;
        siftDown(0);
        truncated = true; // a kept schedule was bumped: there are more than `limit`
      }
      return;
    }
    const options = [];
    for (const sectionId of lists[i]) {
      if (!sectionsById[sectionId]) continue;
      let addPairs = 0;
      let addMinutes = 0;
      for (const id of chosen) {
        const m = pairCost(id, sectionId);
        if (m > 0) {
          addPairs++;
          addMinutes += m;
        }
      }
      options.push({ sectionId, addPairs, addMinutes });
    }
    options.sort((a, b) => a.addPairs - b.addPairs || a.addMinutes - b.addMinutes);
    for (const { sectionId, addPairs, addMinutes } of options) {
      if (explored >= MAX_EXPLORED) {
        truncated = true;
        return;
      }
      explored++;
      if (!canImprove(pairs + addPairs, minutes + addMinutes)) {
        // Options are sorted, so no later one at this step can do better.
        if (heap.length >= limit) truncated = true;
        return;
      }
      chosen.push(sectionId);
      search(i + 1, chosen, pairs + addPairs, minutes + addMinutes);
      chosen.pop();
    }
  }
  search(0, [], 0, 0);

  heap.sort((a, b) => (worse(a, b) ? 1 : -1));
  return { schedules: heap.map((e) => e.ids), truncated, allowOverlaps: true };
}

// draftCourses: [{ courseKey, considering: { [componentKey]: sectionId[]
// }, locked: sectionId[] }] — componentKey is BU's raw `component` code
// (see sectionComponents.js), so a course with distinct LEC/DIS/LAB
// sections already gets three separate considering pools/slots without
// any extra handling here. Turns that per-course state into flat
// generation slots — one slot per group groupSectionsByComponent reports
// for that course.
//
// `locked` deliberately has no size limit and isn't scoped to "one per
// component" or "one per course": each locked section becomes its OWN
// forced single-option slot, independent of every other lock. Locking one
// section per component (e.g. the lecture AND the lab) is the normal case
// now that distinct components are already separate groups/slots; locking
// more than one within the SAME component only matters for the blank-
// component "Other" fallback group (see sectionComponents.js), where BU's
// data doesn't distinguish pieces at all and the student may need to force
// more than one in by hand. An unlocked component's checked alternatives
// become one ordinary "pick one" slot.
export function buildGenerationSlots(draftCourses, sectionsByCourse, sectionsById) {
  const slots = [];
  for (const course of draftCourses) {
    const sections = sectionsByCourse[course.courseKey] || [];
    const groups = groupSectionsByComponent(sections);
    const lockedByGroup = {};
    for (const id of course.locked) {
      const key = classifyComponent(sectionsById[id]);
      (lockedByGroup[key] ??= []).push(id);
    }
    // Options (and the "Other" group's one-pin slots) go in section id order,
    // not click order, so the same picks always give the same ordered results.
    for (const group of groups) {
      const locked = [...(lockedByGroup[group.key] || [])].sort();
      if (locked.length > 1 && group.key !== UNKNOWN_KEY) {
        // Several pins in one real component (an old draft): pick one of them.
        slots.push({ options: locked });
      } else if (locked.length > 0) {
        locked.forEach((id) => slots.push({ options: [id] }));
      } else {
        const considering = course.considering[group.key] || [];
        if (considering.length > 0) slots.push({ options: [...considering].sort() });
      }
    }
  }
  return slots;
}

// Pins sectionId in one course's groupKey. Outside the "Other" group a
// component holds one pin: the group's existing pins are released back
// into its considering list (checked again) and replaced. The "Other"
// group keeps adding pins, as before. Clears the group's other checked
// alternatives either way.
export function pinInGroup(course, groupKey, sectionId, sectionsById) {
  if (groupKey === UNKNOWN_KEY) {
    return {
      ...course,
      locked: [...course.locked, sectionId],
      considering: { ...course.considering, [groupKey]: [] },
    };
  }
  const replaced = course.locked.filter((id) => sectionsById[id] && classifyComponent(sectionsById[id]) === groupKey);
  return {
    ...course,
    locked: [...course.locked.filter((id) => !replaced.includes(id)), sectionId],
    considering: { ...course.considering, [groupKey]: replaced },
  };
}

// When generateSchedules comes back empty, this points at which course(s)
// are implicated, by re-running generation with each course dropped in
// turn — a course whose absence lets a schedule through is a culprit. Each
// re-run stops at the first schedule found (limit: 1), so this stays cheap
// even though it's O(courses) backtracking passes.
//
// A single course by itself can only fail this way if its OWN components
// don't leave any conflict-free pairing (e.g. every Lecture option overlaps
// every Discussion option), so with one course there's nothing to remove —
// that course itself is reported directly.
//
// An empty result (with 2+ courses) means no single removal fixes it: at
// least two courses are independently unsatisfiable, or the clash only
// emerges from three-or-more courses at once. Neither is nameable as "the"
// culprit, so callers should fall back to a "try removing courses one at a
// time" hint in that case.
export function diagnoseNoSchedule(draftCourses, sectionsByCourse, sectionsById) {
  if (draftCourses.length === 0) return [];
  if (draftCourses.length === 1) return [draftCourses[0].courseKey];

  const culprits = [];
  for (let i = 0; i < draftCourses.length; i++) {
    const without = draftCourses.filter((_, idx) => idx !== i);
    const slots = buildGenerationSlots(without, sectionsByCourse, sectionsById);
    const { schedules } = generateSchedules(slots, sectionsById, { limit: 1 });
    if (schedules.length > 0) culprits.push(draftCourses[i].courseKey);
  }
  return culprits;
}

// Which of a course's required component groups still need a locked or
// considered pick. Returns [] when the course is fully ready, or null when
// there's no section data to judge readiness from at all (still loading,
// or genuinely no sections this term) — callers should treat null as "not
// ready" too, but it's kept distinct from [] so a blocker explanation (see
// SchedulerPage's "why is Generate disabled" list) can say "still loading"
// instead of misreporting zero missing groups.
export function missingGroupsForCourse(course, sections, sectionsById) {
  const groups = groupSectionsByComponent(sections);
  if (groups.length === 0) return null;
  return groups.filter((group) => {
    const lockedInGroup = course.locked.some((id) => classifyComponent(sectionsById[id]) === group.key);
    const consideringCount = course.considering[group.key]?.length ?? 0;
    return !lockedInGroup && consideringCount === 0;
  });
}

// Canonical identity for a generated combination — order-independent, so
// the same combination flags/unflags consistently even if backtracking
// would ever visit its sections in a different order across runs (e.g.
// after a regenerate triggered by an unrelated lock/eliminate elsewhere).
export function scheduleKey(sectionIds) {
  return [...sectionIds].sort().join('|');
}

// Sum of `credits` across a set of sectionIds. BU's export repeats the same
// Credit Hours value on every companion row of a course (a 4-credit
// course's discussion/lab section also shows "4.0"), so summing every
// section naively double-counts once a schedule can include more than one
// section per course — dedupe by courseKey first.
export function totalCredits(sectionIds, sectionsById) {
  const creditsByCourse = {};
  for (const id of sectionIds) {
    const section = sectionsById[id];
    if (!section) continue;
    const credits = section.credits ?? 0;
    if (!(section.courseKey in creditsByCourse) || credits > creditsByCourse[section.courseKey]) {
      creditsByCourse[section.courseKey] = credits;
    }
  }
  return Object.values(creditsByCourse).reduce((sum, c) => sum + c, 0);
}

// Human-readable contents of a combination — used anywhere a bookmarked or
// saved schedule needs to say what's actually in it instead of just a
// section count. `compact` is course numbers only (fits in a row without
// wrapping); `lines` is one "COURSE NUM Section (days time)" entry per
// section, in course order, for a full-detail tooltip. Sections whose
// data hasn't loaded (e.g. a bookmark outliving the course being removed
// from the draft) are silently skipped rather than showing a raw id.
export function describeSectionSet(sectionIds, sectionsById, courseMap) {
  const sections = sectionIds.map((id) => sectionsById[id]).filter(Boolean);
  const seenCourses = new Set();
  const compactParts = [];
  const lines = [];
  for (const section of sections) {
    const courseLabel = courseMap[section.courseKey]?.courseNumber ?? section.courseKey;
    if (!seenCourses.has(section.courseKey)) {
      seenCourses.add(section.courseKey);
      compactParts.push(courseLabel);
    }
    lines.push(`${describeSectionName(section, courseLabel)} (${describeSectionTime(section)})`);
  }
  return { compact: compactParts.join(', '), lines };
}
