// "Fill my plan with the standard plan": a program JSON may carry an optional
// `sequence` (see src/data/requirements/SCHEMA.md) — its typical term-by-term
// path. This file holds the pure logic around it, with no React or Firestore:
//   seedSequence      what the button adds to a plan (never moves or deletes)
//   placeWithTakeover a real course placed in a term takes over one matching
//                     `fills` placeholder there
//   removeCourseGivingBack  removing such a course gives the placeholder back
//   validateSequence  shape + key checks, run by the tests over every program
// Whether a course fits a requirement node is always answered by the engine
// itself (evaluateRequirementTree), never by a second copy of its rules.
import { evaluateRequirementTree, poolEntryCandidateKeys } from './requirementsEngine.js';
import { normalizeCourseKey } from './courseKey.js';
import { requirementsPlanKeys } from './requirementsKeys.js';
import {
  createFillsPlaceholder,
  entryCourseKey,
  entryFills,
  isFillsId,
  isMarineTerm,
  isPlainNoteEntry,
  normalizeCourseEntry,
  placeCourse,
  removeCourse,
} from './courseEntry.js';

export const HUB_FILLS = 'hub';
const HUB_LABEL = 'Hub Elective';
const FALLBACK_LABEL = 'Elective';

export function sequenceSlots(programDef) {
  const slots = programDef?.sequence?.slots;
  return Array.isArray(slots) ? slots : null;
}

function walkNodes(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (Array.isArray(node.children)) node.children.forEach((child) => walkNodes(child, visit));
}

export function findNode(tree, id) {
  let found = null;
  walkNodes(tree, (node) => { if (!found && node.id === id) found = node; });
  return found;
}

function nodeIds(tree) {
  const ids = new Set();
  walkNodes(tree, (node) => { if (typeof node.id === 'string') ids.add(node.id); });
  return ids;
}

// ── Validation ──────────────────────────────────────────────────────────────

const COURSE_KEY_SHAPE = /^[A-Z]+\d+$/;

// Problems with a program's `sequence`, as strings (empty = fine). `catalogIds`
// is the set of courseKeys in public/courses.json.
export function validateSequence(programDef, catalogIds) {
  const problems = [];
  const sequence = programDef?.sequence;
  if (sequence == null) return problems;
  if (!Array.isArray(sequence.slots)) return ['sequence.slots must be an array'];
  const ids = nodeIds(programDef.tree);
  sequence.slots.forEach((slot, i) => {
    const where = `slot ${i}`;
    if (slot == null || typeof slot !== 'object') { problems.push(`${where}: not an object`); return; }
    for (const key of slot.courses ?? []) {
      if (typeof key !== 'string' || !COURSE_KEY_SHAPE.test(key)) problems.push(`${where}: "${key}" is not a courseKey`);
      else if (catalogIds && !catalogIds.has(key)) problems.push(`${where}: ${key} is not in public/courses.json`);
    }
    for (const placeholder of slot.placeholders ?? []) {
      if (typeof placeholder?.label !== 'string' || !placeholder.label.trim()) problems.push(`${where}: placeholder without a label`);
      if (placeholder?.fills === undefined) continue;
      if (!isFillsId(placeholder.fills)) problems.push(`${where}: fills "${placeholder.fills}" is not an id`);
      else if (placeholder.fills !== HUB_FILLS && !ids.has(placeholder.fills)) problems.push(`${where}: fills "${placeholder.fills}" is not a node id of this program`);
    }
  });
  for (const id of sequence.fillPriority ?? []) {
    if (!ids.has(id)) problems.push(`fillPriority: "${id}" is not a node id of this program`);
  }
  return problems;
}

// ── Engine questions ────────────────────────────────────────────────────────

function matchedKeys(node) {
  return (node.matched || []).flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.courseKeys || []));
}

// Every courseKey a pool entry names, including the courses of a sequence
// bundle's options (poolEntryCandidateKeys returns null for those).
function entryKeys(entry) {
  if (typeof entry === 'string') return [normalizeCourseKey(entry)];
  if (entry.type === 'SEQUENCE_GROUP') return entry.options.flatMap((option) => option.courses.map(normalizeCourseKey));
  return poolEntryCandidateKeys(entry) || [];
}

function isSingleSlotEntry(entry) {
  return typeof entry === 'string'
    || entry.type === 'OR_EQUIVALENT' || entry.type === 'SUBSTITUTE_GROUP' || entry.type === 'SEQUENCE_GROUP';
}

// For a course that belongs to one required slot of an evaluated node (a leaf
// ALL list, or a COUNT with one named slot per pool entry): 'satisfied' when
// the engine has that slot filled (by the course, an alternative, a bundle, a
// petition), else 'open'. null when the node has no such slot for it.
function courseSlotState(node, key) {
  if (node.type === 'ALL' && Array.isArray(node.courses)) {
    if (!node.courses.map(normalizeCourseKey).includes(key)) return null;
    if (node.waived) return 'satisfied';
    return (node.missing || []).includes(key) ? 'open' : 'satisfied';
  }
  const pool = node.pool || [];
  if (node.type !== 'COUNT' || pool.length !== node.min || !pool.every(isSingleSlotEntry)) return null;
  const slot = pool.findIndex((entry) => entryKeys(entry).includes(key));
  if (slot === -1) return null;
  if (node.waived) return 'satisfied';
  return (node.matched || []).some((entry) => entry.entryIndex === slot && !entry.fallback) ? 'satisfied' : 'open';
}

// The slot state of `key` anywhere in the evaluated tree (a ONE_OF counts only
// through its active child), or null if no node has a named slot for it.
function slotStateInTree(node, key) {
  const own = courseSlotState(node, key);
  if (own != null) return own;
  if (node.type === 'ONE_OF') return slotStateInTree(node.children[node.activeChildIndex] ?? {}, key);
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const state = slotStateInTree(child, key);
    if (state != null) return state;
  }
  return null;
}

// How many more courses the engine still wants for a node (0 if waived).
function openCount(tree, id) {
  const node = findNode(tree, id);
  if (!node || node.waived) return 0;
  return Math.max(0, (node.required ?? 0) - (node.satisfiedCount ?? 0));
}

// Whether the engine would count `courseKey` toward node `nodeId` when it is
// the only course: the node is evaluated on its own as a one-node program.
export function nodeAcceptsCourse(programDef, nodeId, courseKey) {
  const node = findNode(programDef?.tree, nodeId);
  if (!node) return false;
  try {
    const result = evaluateRequirementTree({ ...programDef, tree: node }, [courseKey]);
    return matchedKeys(result.tree).includes(normalizeCourseKey(courseKey));
  } catch {
    return false;
  }
}

// The label a placeholder for `fills` carries in the program's sequence.
export function placeholderLabelFor(programDef, fills) {
  for (const slot of sequenceSlots(programDef) ?? []) {
    const found = (slot.placeholders ?? []).find((placeholder) => placeholder.fills === fills);
    if (found) return found.label;
  }
  return fills === HUB_FILLS ? HUB_LABEL : FALLBACK_LABEL;
}

// ── Seeding ─────────────────────────────────────────────────────────────────

function fillsPlaceholdersIn(lists) {
  const counts = new Map();
  for (const entries of lists) {
    for (const entry of entries || []) {
      const fills = isPlainNoteEntry(entry) ? entryFills(entry) : null;
      if (fills) counts.set(fills, (counts.get(fills) ?? 0) + 1);
    }
  }
  return counts;
}

// Why a sequence course or placeholder was NOT placed (the skip report):
//   'past'      its term is past / before the student's start, or is a Marine
//               term (`why` says which); for a course, its requirement slot is
//               still unmet, so seeding stashes it instead
//   'in-plan'   the course is already in the plan, or an identical placeholder is
//   'satisfied' the engine already has that requirement slot filled — counting
//               only what the tracker counts (see requirementsKeys.js); `by` is
//               'course' | 'credit' | 'substitution' and `via` the courses that
//               fill it
//   'no-need'   the engine needs no more courses for the placeholder's node
//   'duplicate' the course appears twice in the sequence
export const SKIP_REASONS = ['past', 'in-plan', 'satisfied', 'no-need', 'duplicate'];

// The courseKeys that fill the named slot of `key`, in the evaluated tree.
function slotMatchedKeys(node, key) {
  if (node.type === 'ALL' && Array.isArray(node.courses)) {
    return node.courses.map(normalizeCourseKey).includes(key) ? matchedKeys(node).filter((k) => k === key) : null;
  }
  const pool = node.pool || [];
  if (node.type === 'COUNT' && pool.length === node.min && pool.every(isSingleSlotEntry)) {
    const slot = pool.findIndex((entry) => entryKeys(entry).includes(key));
    if (slot !== -1) {
      return (node.matched || []).filter((entry) => entry.entryIndex === slot && !entry.fallback).flatMap((entry) => entry.courseKeys || []);
    }
  }
  if (node.type === 'ONE_OF') return slotMatchedKeys(node.children[node.activeChildIndex] ?? {}, key);
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const found = slotMatchedKeys(child, key);
    if (found != null) return found;
  }
  return null;
}

// What made the requirement slot of `key` satisfied: the plan's own courses
// first, then external credit, last petitions / waives.
function satisfiedBy(programDef, key, stages, marineSlots) {
  const check = (keys, overrides) => {
    const { tree } = evaluateRequirementTree(programDef, keys, overrides, { marineSlots });
    return slotStateInTree(tree, key) === 'satisfied' ? slotMatchedKeys(tree, key) ?? [] : null;
  };
  let via = check(stages.planOnly, {});
  if (via) return { by: 'course', via };
  via = check(stages.tracker, {});
  if (via) return { by: 'credit', via };
  via = check(stages.tracker, stages.overrides);
  return { by: 'substitution', via: via ?? [] };
}

// What "Fill my plan" adds. Never moves or removes anything:
//   * a sequence course is skipped when it is already anywhere in the plan, or
//     when the engine (the tracker's keys: plan + external credits, plus
//     `overrides`) already has its requirement slot filled — completed courses
//     that are not in the plan do NOT count, as in the tracker —
//     or when its term is not seedable; a skipped course leaves its slot empty
//   * placeholders: per elective node only as many as the engine still has
//     open (minus ones already planned); Hub placeholders only up to the
//     sequence's own count
// `isSlotSeedable(slot)` says whether a grid slot may be filled (past terms
// say no); a Marine term never is. Every course and placeholder not placed is
// in `skipped` with its reason (see SKIP_REASONS). Courses skipped only
// because their term is past/Marine and whose requirement slot is unmet come
// back as `stashAdd` (not already in `stash`) / `stashAlready`: the caller
// puts them in Paw-tential Courses instead of dropping them.
// Returns { semesters, addedCourses, addedPlaceholders, filledSlots, skipped,
// stashAdd, stashAlready, changed }.
export function seedSequence({
  programDef,
  semesters,
  gridSummerTerms = {},
  extraTerms = [],
  externalCredits = [],
  stash = [],
  overrides = {},
  marineSlots = 0,
  isSlotSeedable = () => true,
}) {
  const slots = sequenceSlots(programDef);
  const next = (semesters || []).map((entries) => [...(entries || [])]);
  const none = { semesters: next, addedCourses: [], addedPlaceholders: 0, filledSlots: [], skipped: [], stashAdd: [], stashAlready: [], changed: false };
  if (!slots) return none;
  while (next.length < slots.length) next.push([]);

  const stages = {
    planOnly: requirementsPlanKeys({ semesters: next, gridSummerTerms, extraTerms, externalCredits: [] }).map(normalizeCourseKey),
    tracker: requirementsPlanKeys({ semesters: next, gridSummerTerms, extraTerms, externalCredits }).map(normalizeCourseKey),
    overrides,
  };
  const { tree } = evaluateRequirementTree(programDef, stages.tracker, overrides, { marineSlots });
  // Courses already in the plan itself (grid, summer slots, extra terms).
  const planned = new Set(stages.planOnly);

  // Why a slot can't be seeded: 'marine' (a Marine term) or 'past' (isSlotSeedable).
  const blocked = slots.map((_, i) => {
    if (isMarineTerm(next[i], i)) return 'marine';
    return isSlotSeedable(i) ? null : 'past';
  });
  const existing = fillsPlaceholdersIn([...next, ...Object.values(gridSummerTerms || {})]);

  // Placeholders each fills-id may still add: min(sequence count, engine open)
  // minus the ones already planned; Hub: the sequence's count minus planned.
  const sequenceCounts = new Map();
  for (const slot of slots) {
    for (const placeholder of slot.placeholders ?? []) {
      if (placeholder.fills) sequenceCounts.set(placeholder.fills, (sequenceCounts.get(placeholder.fills) ?? 0) + 1);
    }
  }
  const budget = new Map();
  for (const [id, count] of sequenceCounts) {
    const wanted = id === HUB_FILLS ? count : Math.min(count, openCount(tree, id));
    budget.set(id, Math.max(0, wanted - (existing.get(id) ?? 0)));
  }

  const addedCourses = [];
  const skipped = [];
  const filled = new Set();
  let addedPlaceholders = 0;
  const seenInSequence = new Set();
  const deferred = []; // placeholders in blocked terms: judged once the open terms have taken their share
  slots.forEach((slot, i) => {
    for (const rawKey of slot.courses ?? []) {
      const key = normalizeCourseKey(rawKey);
      const base = { type: 'course', courseKey: key, slot: i };
      if (seenInSequence.has(key)) { skipped.push({ ...base, reason: 'duplicate' }); continue; }
      seenInSequence.add(key);
      if (planned.has(key)) { skipped.push({ ...base, reason: 'in-plan' }); continue; }
      if (slotStateInTree(tree, key) === 'satisfied') {
        skipped.push({ ...base, reason: 'satisfied', ...satisfiedBy(programDef, key, stages, marineSlots) });
        continue;
      }
      if (blocked[i]) { skipped.push({ ...base, reason: 'past', why: blocked[i], unmet: true }); continue; }
      next[i].push(normalizeCourseEntry(key));
      addedCourses.push({ courseKey: key, slot: i });
      filled.add(i);
    }
    for (const placeholder of slot.placeholders ?? []) {
      const base = { type: 'placeholder', label: placeholder.label, fills: placeholder.fills ?? null, slot: i };
      if (blocked[i]) { deferred.push({ ...base, why: blocked[i] }); continue; }
      if (placeholder.fills) {
        if ((budget.get(placeholder.fills) ?? 0) <= 0) { skipped.push({ ...base, reason: 'no-need' }); continue; }
        budget.set(placeholder.fills, budget.get(placeholder.fills) - 1);
        next[i].push(createFillsPlaceholder(placeholder.label, placeholder.fills));
      } else {
        // No `fills`: an ordinary placeholder, added once per term and label.
        if (next[i].some((entry) => isPlainNoteEntry(entry) && !entryFills(entry) && entry.text === placeholder.label)) {
          skipped.push({ ...base, reason: 'in-plan' });
          continue;
        }
        next[i].push(createFillsPlaceholder(placeholder.label, undefined));
      }
      addedPlaceholders += 1;
      filled.add(i);
    }
  });
  for (const item of deferred) {
    if (!item.fills) { skipped.push({ ...item, reason: 'past' }); continue; }
    if ((budget.get(item.fills) ?? 0) > 0) {
      budget.set(item.fills, budget.get(item.fills) - 1);
      skipped.push({ ...item, reason: 'past' });
    } else {
      skipped.push({ ...item, reason: 'no-need' });
    }
  }

  const stashed = new Set((stash || []).map(normalizeCourseKey));
  const unmet = skipped.filter((item) => item.type === 'course' && item.reason === 'past' && item.unmet).map((item) => item.courseKey);
  const stashAdd = unmet.filter((key) => !stashed.has(key));
  const stashAlready = unmet.filter((key) => stashed.has(key));
  return {
    semesters: next,
    addedCourses,
    addedPlaceholders,
    filledSlots: [...filled].sort((a, b) => a - b),
    skipped,
    stashAdd,
    stashAlready,
    changed: addedCourses.length + addedPlaceholders > 0 || stashAdd.length > 0,
  };
}

// "a Natural Science elective", "an EE Core elective", "2 Hub electives".
function describePlaceholders(labels) {
  const counts = new Map();
  for (const label of labels) {
    const text = label.replace(/Elective$/i, 'elective');
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([text, n]) => {
    if (n > 1) return `${n} ${text.replace(/elective$/, 'electives')}`;
    return `${/^[AEIOU]/i.test(text) ? 'an' : 'a'} ${text}`;
  });
}

// The toast after a fill, short and casual (see the skip report above).
// `slotLabel(i)` names a term ("Fall 2026"), `codeOf(key)` a course ("MA 123").
// `whyText(item)` says why a blocked term was skipped ("before your start",
// "already past"); a Marine term says so itself.
export function seedMessage(result, { slotLabel, codeOf, whyText }) {
  const parts = [];
  const filled = result.filledSlots.length;
  if (filled > 0) parts.push(`Filled ${filled} term${filled === 1 ? '' : 's'}.`);
  const blockedBySlot = new Map();
  for (const item of result.skipped) {
    if (item.reason !== 'past') continue;
    if (!blockedBySlot.has(item.slot)) blockedBySlot.set(item.slot, { why: item.why, courses: [], placeholders: [] });
    const group = blockedBySlot.get(item.slot);
    if (item.type === 'course') group.courses.push(codeOf(item.courseKey)); else group.placeholders.push(item.label);
  }
  for (const [slot, group] of [...blockedBySlot].sort((a, b) => a[0] - b[0])) {
    const why = group.why === 'marine' ? 'Marine Semester' : whyText(slot);
    const extra = describePlaceholders(group.placeholders).join(', ');
    const list = group.courses.length > 0
      ? `${group.courses.join(', ')}${extra ? `, plus ${extra}` : ''}`
      : extra;
    parts.push(`Skipped ${slotLabel(slot)} (${why}): ${list}.`);
  }
  if (result.stashAdd.length > 0) parts.push('Added the courses to Paw-tential Courses.');
  else if (result.stashAlready.length > 0) parts.push('Those courses are already in Paw-tential Courses.');
  // Nothing placed, skipped by term or stashed: everything was already there.
  if (parts.length === 0) return 'Your plan already has everything from the standard plan.';
  const covered = new Set(result.skipped.filter((item) => item.type === 'course' && (item.reason === 'satisfied' || item.reason === 'in-plan')).map((item) => item.courseKey)).size;
  if (covered > 0) parts.push(`${covered} already covered.`);
  return parts.join(' ');
}

// ── Takeover ────────────────────────────────────────────────────────────────

// Earlier = taken first: the sequence's own `fillPriority`, then the other
// nodes in sequence order, Hub last.
function fillsRank(programDef, fills) {
  if (fills === HUB_FILLS) return Number.MAX_SAFE_INTEGER;
  const priority = programDef?.sequence?.fillPriority ?? [];
  const listed = priority.indexOf(fills);
  if (listed !== -1) return listed;
  const order = [];
  for (const slot of sequenceSlots(programDef) ?? []) {
    for (const placeholder of slot.placeholders ?? []) {
      if (placeholder.fills && placeholder.fills !== HUB_FILLS && !order.includes(placeholder.fills)) order.push(placeholder.fills);
    }
  }
  return priority.length + Math.max(0, order.indexOf(fills));
}

// Index in `entries` of the `fills` placeholder a course would take over, or
// -1. Eligible: the engine counts the course toward the placeholder's node, or
// (Hub) the course has HUB units. Most specific wins (fillsRank).
export function pickTakeover(entries, courseKey, { programDef, hasHubUnits = false } = {}) {
  let best = -1;
  let bestRank = Infinity;
  (entries || []).forEach((entry, i) => {
    const fills = isPlainNoteEntry(entry) ? entryFills(entry) : null;
    if (!fills) return;
    const eligible = fills === HUB_FILLS ? hasHubUnits : Boolean(programDef) && nodeAcceptsCourse(programDef, fills, courseKey);
    if (!eligible) return;
    const rank = fillsRank(programDef, fills);
    if (rank < bestRank) { best = i; bestRank = rank; }
  });
  return best;
}

// A copy of a course entry without its `fills` (a moved course no longer
// fills the placeholder it took over).
export function withoutFills(entry) {
  if (entry == null || typeof entry !== 'object') return entry;
  const { fills: _fills, ...rest } = entry;
  return rest;
}

// placeCourse plus the takeover: a course that lands in an ordinary term
// replaces one eligible `fills` placeholder in place and carries its `fills`.
// Returns what placeCourse returns, plus `took: { fills, label } | null`.
export function placeWithTakeover(entries, course, slotIndex, context) {
  const list = entries || [];
  const placed = placeCourse(list, course, slotIndex);
  if (!placed.ok || placed.created || placed.intoMarine) return { ...placed, took: null };
  const entry = withoutFills(placed.entries[placed.entries.length - 1]);
  const index = pickTakeover(list, entryCourseKey(entry), context);
  if (index === -1) return { ...placed, entries: [...list, entry], took: null };
  const placeholder = list[index];
  const fills = entryFills(placeholder);
  return {
    ...placed,
    entries: list.map((e, i) => (i === index ? { ...entry, fills } : e)),
    took: { fills, label: placeholder.text },
  };
}

// removeCourse, and when the removed course had taken a placeholder over, the
// placeholder comes back where it was (the way Marine gives a slot back).
export function removeCourseGivingBack(entries, courseKey, slotIndex, programDef) {
  const list = entries || [];
  const index = list.findIndex((entry) => entryCourseKey(entry) === courseKey);
  const fills = index === -1 ? null : entryFills(list[index]);
  const next = removeCourse(list, courseKey, slotIndex);
  if (!fills) return next;
  const placeholder = createFillsPlaceholder(placeholderLabelFor(programDef, fills), fills);
  return [...next.slice(0, index), placeholder, ...next.slice(index)];
}
