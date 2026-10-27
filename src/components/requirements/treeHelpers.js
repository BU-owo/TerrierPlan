// Pure tree-walking / formatting helpers shared by RequirementNodeView,
// SequenceGroupDetail, CoursePool, and CourseChip — no JSX here so both the
// compact sidebar and the full-screen view import the exact same logic.
import { normalizeCourseKey, parseCourseKeyLoose } from '../../utils/courseKey';
import { poolEntryCandidateKeys } from '../../utils/requirementsEngine';
import { completionState, isNodeShown, lockStatusVariant } from '../../utils/completion';

// "CASCS" -> "CS". Subjects are a 3-letter school plus the department.
export function displaySubject(subject) {
  return subject.length > 3 ? subject.slice(3) : subject;
}

// "CASCS132" -> "CS 132". Display only — the loose parse keeps suffixed keys
// ("CASCH203P") readable; matching still goes through parseCourseKey.
export function shortCourseCode(courseKey) {
  const parsed = parseCourseKeyLoose(courseKey);
  if (!parsed) return courseKey;
  return `${displaySubject(parsed.subject)} ${parsed.number}${parsed.suffix}`;
}

// Courses with no catalog data fall back to the short code ("MA 127"),
// never the raw key.
export function formatCourseLabel(courseKey, courseMap = {}, density = 'compact') {
  const data = courseMap[courseKey];
  const code = data?.courseNumber ?? shortCourseCode(courseKey);
  if (density === 'full' && data?.name) return `${code} — ${data.name}`;
  return code;
}

// A claimed/fulfilled course's display status, derived from the plan-wide
// lock-status lookup PlannerPage builds from semesters/gridSummerTerms/
// extraTerms. Display-only — never fed into the requirements engine, which
// only ever sees flat courseKeys. Courses the lookup doesn't know about
// (e.g. AP/transfer external credits) are treated as already-earned credit.
//
// A course in a semester chronologically before the student's chosen
// "current semester" always counts as completed, whether or not it's still
// locked (see semesterStatus in PlannerPage's lockStatusMap) — the current-
// semester marker is the source of truth for "already happened". `locked`
// is only consulted as a fallback (e.g. a manually self-marked AP-style
// course with no current semester set), and no longer gets its own label.
const LOCK_STATUS_LABELS = { completed: 'Completed', current: 'In progress', planned: 'Planned' };
export function describeLockStatus(lockStatus) {
  const variant = lockStatusVariant(lockStatus);
  return { variant, label: LOCK_STATUS_LABELS[variant] };
}

// One requirement node's state for the done-vs-planned UI: 'todo' (not
// satisfied), 'done', or 'planned' (satisfied, but some counted course is
// only planned/current — see completion.js). Petitioned and needs-review
// nodes that are satisfied count as done. No `statusMap` (split off) means
// satisfied = done.
export function nodeProgressState(node, statusMap) {
  if (node?.status !== 'satisfied') return 'todo';
  if (node.waived || node.substituted || node.type === 'UNRESOLVED') return 'done';
  return completionState(true, collectMatchedKeys(node), statusMap);
}

// A node whose children render as their own rows (same test as
// RequirementNodeView's isContainer).
export function isContainerNode(node) {
  return node?.type === 'ALL' && Array.isArray(node.children) && !node.waived;
}

// Whether the full view's All / Still to do / Done filter shows `node`.
export function nodeShown(node, filter, statusMap) {
  if (filter === 'all') return true;
  const anyChildShown = filter === 'done' && isContainerNode(node)
    && node.children.some((child) => nodeShown(child, filter, statusMap));
  return isNodeShown(filter, nodeProgressState(node, statusMap), anyChildShown);
}

function isRangeEntry(entry) {
  return typeof entry !== 'string' && (entry.type === 'COURSE_RANGE' || entry.type === 'COURSE_RANGE_CAP');
}

function isListEntry(entry) {
  return typeof entry !== 'string' && entry.type === 'COURSE_LIST';
}

function isSequenceEntry(entry) {
  return typeof entry !== 'string' && entry.type === 'SEQUENCE_GROUP';
}

function isAlternativesEntry(entry) {
  return typeof entry !== 'string' && (entry.type === 'OR_EQUIVALENT' || entry.type === 'SUBSTITUTE_GROUP');
}

// A "take-all" COUNT: every pool entry is one required slot (a plain course,
// an either/or, or a sequence bundle) and min equals the slot count, so
// nothing is picked from a list — the student takes every slot. Display only.
export function isTakeAllNode(node) {
  const pool = node?.pool || [];
  return node?.type === 'COUNT' && node.min > 1 && pool.length === node.min
    && pool.every((entry) => typeof entry === 'string' || isAlternativesEntry(entry) || isSequenceEntry(entry));
}

// "CS" for a one-subject range; "QST courses" / "Any course" (plus "not QST")
// for a subjectPrefix range. Authored labels replace this in most cards.
function rangeSubjectText(range) {
  if (range.subject) return displaySubject(range.subject);
  const notSubjects = range.excludeSubjectPrefixes?.length ? ` not ${range.excludeSubjectPrefixes.join('/')}` : '';
  return `${range.subjectPrefix ? `${range.subjectPrefix} courses` : 'Any course'}${notSubjects}`;
}

function describeRange(entry) {
  const span = `${rangeSubjectText(entry)} ${entry.min}-${entry.max}`;
  return entry.type === 'COURSE_RANGE_CAP' ? `up to ${entry.cap} from ${span}` : span;
}

function capSuffix(entry) {
  return entry?.cap != null ? ` (max ${entry.cap})` : '';
}

function describePoolEntryShort(entry) {
  if (typeof entry !== 'string' && entry.label) return entry.label;
  if (isRangeEntry(entry)) return describeRange(entry);
  if (isListEntry(entry)) return `listed courses${capSuffix(entry)}`;
  if (isSequenceEntry(entry)) return entry.options.map((option) => option.label).join(' or ');
  return (poolEntryCandidateKeys(entry) || []).map(shortCourseCode).join(' or ');
}

// The generated line under a node's label ("Pick 2 of 3", "All 5 required",
// "6 more: CS 300-599"). Static — built from the node's shape, not from what
// the student has left. null for nodes that don't get one.
//
// `visibility` ({ inactiveKeys, keep }), when given, makes the pick-one count
// match what's on screen: options hidden as long-unoffered (hideInactive)
// aren't counted or mentioned.
export function describeRequirement(node, visibility = null) {
  if (node.waived) return null;
  switch (node.type) {
    case 'ALL':
      if (Array.isArray(node.children)) return null;
      return node.courses.length === 1 ? 'Required' : `All ${node.courses.length} required`;
    case 'COUNT': {
      // An authored subtitle replaces the generated "Pick N of M" line.
      if (typeof node.subtitle === 'string' && node.subtitle) return node.subtitle;
      const pool = node.pool || [];
      // No course list (e.g. filled by a special-term block, or by petitions).
      if (pool.length === 0) return null;
      // Same course count as the card's n/N (a bundle slot counts its courses).
      if (isTakeAllNode(node)) return `Take all ${node.required ?? node.min}`;
      if (pool.some(isRangeEntry)) return `Pick ${node.min}: ${pool.map(describePoolEntryShort).join(', ')}`;
      // Pick-one nodes count every selectable course (a sequence bundle is one).
      if (node.min === 1) {
        const visibleCount = (keys) => (visibility
          ? hideInactive(keys, visibility.inactiveKeys, visibility.keep).keys.length
          : keys.length);
        const total = pool.reduce(
          (sum, entry) => sum + (isSequenceEntry(entry) ? 1 : visibleCount(poolEntryCandidateKeys(entry) || [])),
          0
        );
        return `Pick 1 of ${total}`;
      }
      if (pool.some(isListEntry)) {
        return `Pick ${node.min} from this list${capSuffix(pool.find((e) => isListEntry(e) && e.cap != null))}`;
      }
      // Several slots, each "X or Y" (e.g. CS BA Group B).
      if (pool.length > 1 && pool.every(isAlternativesEntry)) {
        return `Pick ${node.min} of ${pool.length} — each is either/or`;
      }
      // A single "X or Y" entry is really a choice between its options.
      const onlyOptions = pool.length === 1 ? poolEntryCandidateKeys(pool[0]) : null;
      const total = onlyOptions && onlyOptions.length > 1 ? onlyOptions.length : pool.length;
      return `Pick ${node.min} of ${total}`;
    }
    case 'REMAINDER': {
      // An authored subtitle replaces the generated "N more: ..." line.
      if (typeof node.subtitle === 'string' && node.subtitle) return node.subtitle;
      const pool = node.pool || [];
      // Course lists and/or sequence bundles (no ranges): read like a COUNT over a
      // list. A sequence still shows on its own row, so it isn't named here.
      if (pool.length > 0 && pool.every((e) => isListEntry(e) || isSequenceEntry(e))) {
        return `Pick ${node.required} from this list${capSuffix(pool.find((e) => e.cap != null))}`;
      }
      return `${node.required} more: ${pool.map(describePoolEntryShort).join(', ')}`;
    }
    case 'SEQUENCE_GROUP':
      return 'Choose one — take every course in that option';
    case 'ONE_OF':
      return 'Choose one option';
    default:
      return null;
  }
}

// Rendering kind for one pool entry: 'range' (include rows + catalog
// browse list), 'sequence' (option cards), else 'courses' (the enumerated
// course grid — OR_EQUIVALENT, SUBSTITUTE_GROUP, COURSE_LIST, plain keys).
function entryKind(entry) {
  if (isRangeEntry(entry)) return 'range';
  if (isSequenceEntry(entry)) return 'sequence';
  return 'courses';
}

function entryTitle(entry) {
  if (typeof entry === 'string') return null;
  if (entry.label) return entry.label;
  if (isRangeEntry(entry)) return describeRange(entry);
  if (isListEntry(entry)) return `From this list${capSuffix(entry)}`;
  return null;
}

// Groups for a COUNT/REMAINDER node's pool, in pool order (an ALL leaf is
// one group of its courses). A run of consecutive plain courseKey entries
// shares one group, so they render as one grid. Each group: `title`
// (authored label, or generated text for lists/ranges, else null), `kind`
// (see entryKind), `claimed` (courseKeys it claimed — green chips),
// `options` (courseKeys still offerable as rows: not in the plan, and only
// while the entry and node still have room), `range` / `showRange` /
// `includeOptions` for range entries, `sequenceOptions` for SEQUENCE_GROUP
// entries, and `open` (nothing claimed yet on an unsatisfied node — drawn
// dashed). Satisfied nodes only keep groups that claimed something.
// `fallback` holds additionalPool missing entries (note only). null for
// nodes with no pool.
// A petition as the pool view shows it: the substitute is a catalog course
// (`courseKey`) or free text (`label`), standing in for the course `replaces`.
const toSubstituted = (sub) => ({
  ...(sub.courseKey ? { courseKey: sub.courseKey } : {}),
  ...(sub.label ? { label: sub.label } : {}),
  replaces: sub.replaces,
});

// `browse: true` ("Browse options" on a requirement row) skips the hiding
// below — satisfied nodes, filled either/or slots and full entries still
// offer every alternative not already in the plan. Default unchanged.
export function collectPoolGroups(node, planCourseKeySet, { browse = false } = {}) {
  const satisfied = node.status === 'satisfied';
  const hideWhenSatisfied = satisfied && !browse;
  // Petitions the engine applied to this node (see applySlotSubstitutions).
  const appliedSubs = (node.substitutions || []).filter((sub) => sub.status === 'applied');
  const offerable = (keys, claimedSet) =>
    keys.filter((key) => !planCourseKeySet.has(key) && !claimedSet.has(key));
  const finish = (groups) => groups
    .map((group) => ({ ...group, open: !satisfied && group.claimed.length === 0 && !group.substituted?.length }))
    .filter((group) => !hideWhenSatisfied || group.claimed.length > 0 || group.substituted?.length > 0);

  if (node.type === 'ALL' && !Array.isArray(node.children)) {
    const keys = (node.courses || []).map(normalizeCourseKey);
    const claimed = node.matched || [];
    const claimedSet = new Set(claimed);
    // A course replaced by a petition is filled by its substitute (a muted ✎
    // row), never offered as something still to take.
    const substituted = appliedSubs.map(toSubstituted);
    const replacedSet = new Set(appliedSubs.map((sub) => sub.replaces));
    return {
      groups: finish([{
        key: 'all',
        title: null,
        kind: 'courses',
        // Every course here is required, not a choice — never hidden as inactive.
        required: true,
        claimed,
        substituted,
        options: hideWhenSatisfied ? [] : offerable(keys.filter((key) => !replacedSet.has(key)), claimedSet),
        textIfEmpty: keys.map(shortCourseCode).join(', '),
      }]),
      fallback: [],
      substituted: [],
    };
  }

  if (node.type !== 'COUNT' && node.type !== 'REMAINDER') return null;

  const mainMatched = (node.matched || []).filter((m) => m.subsetIndex === undefined && !m.fallback);
  const groups = [];
  // Petitions filling the slot at pool index i (named slots only; ones that
  // just fill an open slot of a range / list pool are returned separately).
  const subsForEntry = (i) => appliedSubs.filter((sub) => sub.entryIndex === i).map(toSubstituted);
  const openSubstituted = appliedSubs
    .filter((sub) => sub.entryIndex === undefined || sub.entryIndex === null)
    .map(toSubstituted);
  const takeAll = isTakeAllNode(node);
  (node.pool || []).forEach((entry, i) => {
    const claimed = mainMatched.find((m) => m.entryIndex === i)?.courseKeys || [];
    const claimedSet = new Set(claimed);

    if (typeof entry === 'string') {
      const key = normalizeCourseKey(entry);
      const substituted = subsForEntry(i);
      const options = !browse && (satisfied || claimed.length > 0 || substituted.length > 0) ? [] : offerable([key], claimedSet);
      // Take-all nodes: the run's rows in authored order (claimed, petition, or
      // still-to-take), drawn as one borderless grid (see CoursePool).
      const items = takeAll ? [
        ...claimed.map((courseKey) => ({ type: 'claimed', key: courseKey })),
        ...substituted.map((sub) => ({ type: 'sub', sub })),
        ...options.map((courseKey) => ({ type: 'offer', key: courseKey })),
      ] : null;
      const prev = groups[groups.length - 1];
      if (prev?.plainKeys) {
        prev.claimed = [...prev.claimed, ...claimed];
        prev.substituted = [...prev.substituted, ...substituted];
        prev.options = [...prev.options, ...options];
        prev.textIfEmpty += `, ${shortCourseCode(key)}`;
        if (items) prev.items = [...prev.items, ...items];
      } else {
        groups.push({
          key: `${i}`,
          title: null,
          kind: 'courses',
          plainKeys: true,
          ...(takeAll ? { layout: 'run', items } : {}),
          claimed,
          substituted,
          options,
          textIfEmpty: shortCourseCode(key),
        });
      }
      return;
    }

    const kind = entryKind(entry);
    // `slotLayout: "rows"` take-all nodes: an either/or slot is plain rows in
    // authored order (the counted one keeps its place), not a "Choose 1" box.
    // Every option stays listed, so browse mode shows nothing more.
    if (takeAll && node.slotLayout === 'rows' && isAlternativesEntry(entry)) {
      const substituted = subsForEntry(i);
      const items = substituted.length > 0
        ? substituted.map((sub) => ({ type: 'sub', sub }))
        : poolEntryCandidateKeys(entry).flatMap((key) => {
          if (claimedSet.has(key)) return [{ type: 'claimed', key }];
          return planCourseKeySet.has(key) ? [] : [{ type: 'offer', key }];
        });
      groups.push({
        key: `${i}`,
        title: null,
        kind: 'courses',
        layout: 'rows',
        items,
        optionTags: entry.optionTags
          ? Object.fromEntries(Object.entries(entry.optionTags).map(([key, tag]) => [normalizeCourseKey(key), tag]))
          : null,
        note: entry.note ?? null,
        claimed,
        substituted,
        options: items.filter((item) => item.type === 'offer').map((item) => item.key),
        textIfEmpty: describePoolEntryShort(entry),
      });
      return;
    }
    // One course fills an "X or Y" / sequence slot; lists and ranges can
    // keep claiming until the node (or the entry's cap) is full.
    const singleSlot = isAlternativesEntry(entry) || kind === 'sequence';
    const capReached = entry.cap != null && claimed.length >= entry.cap;
    const hasRoom = browse || (!satisfied && !capReached && !(singleSlot && (claimed.length > 0 || subsForEntry(i).length > 0)));
    const exclude = isRangeEntry(entry) ? (entry.exclude || []).map(normalizeCourseKey) : [];
    const include = entry.type === 'COURSE_RANGE'
      ? (entry.include || []).map(normalizeCourseKey).filter((key) => !exclude.includes(key))
      : [];
    groups.push({
      key: `${i}`,
      // Take-all nodes: an unlabeled either/or with a primary course is named after it.
      title: takeAll && !entry.label && entry.type === 'SUBSTITUTE_GROUP'
        ? `${shortCourseCode(entry.primary)} or a substitute`
        : entryTitle(entry),
      // Display only: drawn inside the previous entry's box, without its own heading.
      continues: Boolean(entry.continues),
      // Display only: a box heading (e.g. a department) over collapsed, labeled
      // rows, one per entry in the box (see CoursePool).
      heading: entry.heading ?? null,
      // Optional authored per-course pills ("Substitute") and a student note
      // for this slot (OR_EQUIVALENT entries; see requirements SCHEMA.md).
      optionTags: entry.optionTags
        ? Object.fromEntries(Object.entries(entry.optionTags).map(([key, tag]) => [normalizeCourseKey(key), tag]))
        : null,
      note: entry.note ?? null,
      // A named COURSE_LIST (an "area" of a pick-N card): CoursePool draws its
      // label as a section heading with the cap and how many it has claimed.
      ...(isListEntry(entry) && entry.label ? { listHeading: { cap: entry.cap ?? null } } : {}),
      // Take-all nodes: an either/or or sequence slot is one "Choose 1" box.
      ...(takeAll ? { layout: 'choose' } : {}),
      kind,
      // Pick-one nodes render either/or slots as a plain grid (no "or" pill).
      equivalent: isAlternativesEntry(entry) && node.min !== 1,
      claimed,
      substituted: subsForEntry(i),
      options: hasRoom ? offerable(poolEntryCandidateKeys(entry) || [], claimedSet) : [],
      range: isRangeEntry(entry)
        ? {
          subject: entry.subject,
          subjectPrefix: entry.subjectPrefix,
          excludeSubjectPrefixes: entry.excludeSubjectPrefixes,
          min: entry.min,
          max: entry.max,
          exclude,
          include,
        }
        : null,
      showRange: isRangeEntry(entry) && hasRoom,
      includeOptions: hasRoom ? offerable(include, claimedSet) : [],
      sequenceOptions: isSequenceEntry(entry) && hasRoom
        ? entry.options.map((option) => ({ label: option.label, courses: option.courses.map(normalizeCourseKey) }))
        : [],
      textIfEmpty: describePoolEntryShort(entry),
    });
  });
  // A heading covers its whole box: carried onto the entries that continue it,
  // so the box keeps it even when its first entry is hidden (satisfied view).
  let boxHeading = null;
  for (const group of groups) {
    if (!group.continues) boxHeading = group.heading ?? null;
    else if (boxHeading && !group.heading) group.heading = boxHeading;
  }
  const fallback = satisfied ? [] : (node.missing || []).filter((entry) => entry.fallback);
  return { groups: finish(groups), fallback, substituted: openSubstituted };
}

// How many things a pool offers to pick from (courses, range/sequence
// browsers) — used to show "Browse options" only when browse mode reveals more.
export function poolOfferCount(pool) {
  return (pool?.groups || []).reduce((sum, group) => sum
    + (group.options?.length ?? 0)
    + (group.includeOptions?.length ?? 0)
    + (group.sequenceOptions?.length ?? 0)
    + (group.showRange ? 1 : 0), 0);
}

// Drops long-unoffered (inactive) courses from a list of choices, except
// ones `keep(key)` says to keep (in the plan or stash). If that would leave
// nothing, keeps them all and sets `dimmed` so the list shows them greyed
// with "Not offered recently" instead of an empty slot.
export function hideInactive(keys, inactiveKeys, keep) {
  const visible = keys.filter((key) => !inactiveKeys.has(key) || keep(key));
  if (visible.length === 0 && keys.length > 0) return { keys, dimmed: true };
  return { keys: visible, dimmed: false };
}

// courseKey -> atLeast subset label, for marking subset courses in a pool's
// chips and lists. Enumerable entries only (ranges aren't marked).
export function collectSubsetLabels(node) {
  const labels = new Map();
  (node.atLeast || []).forEach((subset) => {
    for (const entry of subset.pool || []) {
      for (const key of poolEntryCandidateKeys(entry) || []) {
        if (!labels.has(key)) labels.set(key, subset.label);
      }
    }
  });
  return labels;
}

function nodeCandidateKeys(node) {
  const keys = new Set();
  if (Array.isArray(node.courses)) node.courses.forEach((key) => keys.add(normalizeCourseKey(key)));
  for (const entry of node.pool || []) {
    (poolEntryCandidateKeys(entry) || []).forEach((key) => keys.add(key));
  }
  return keys;
}

// "Also counts here: CS 132, CS 235, CS 237 if not used in Group B: Formal
// Tools" — the other node(s) whose own pool lists the same courses.
export function describeFallbackNote(node, fallbackEntries, flatNodes) {
  const parts = [];
  const keys = [];
  for (const entry of fallbackEntries) {
    if (entry.entryLabel) {
      parts.push(entry.entryLabel);
      keys.push(...(entry.courseKeys || []));
    } else if (entry.range) {
      parts.push(`${rangeSubjectText(entry.range)} ${entry.range.min}-${entry.range.max}`);
    } else {
      const entryKeys = entry.courseKeys || [];
      keys.push(...entryKeys);
      parts.push(entryKeys.length > 0 ? entryKeys.map(shortCourseCode).join(' or ') : entry.label);
    }
  }
  const owners = [];
  for (const other of flatNodes) {
    if (other.id === node.id || owners.includes(other.label)) continue;
    const otherKeys = nodeCandidateKeys(other);
    if (keys.some((key) => otherKeys.has(key))) owners.push(other.label);
  }
  const text = `Also counts here: ${parts.join(', ')}`;
  return owners.length > 0 ? `${text} if not used in ${owners.join(' or ')}` : text;
}

// Every courseKey a node (and its children) actually claimed. Used for the
// collapsed "✓ Label — CS 132, CS 237" line, and over the whole tree for
// "plan courses not claimed anywhere" in the substitute form. A ONE_OF only
// counts its active child — the others were evaluated on a copy.
export function collectMatchedKeys(node, acc = []) {
  if (!node) return acc;
  // A whole-node waive keeps the courses the student holds in that node
  // claimed (flat key list in `matched`); its raw children aren't evaluated.
  if (node.waived) {
    for (const key of node.matched || []) acc.push(key);
    return acc;
  }
  if (node.type === 'ONE_OF' && Array.isArray(node.children) && node.activeChildIndex !== undefined) {
    return collectMatchedKeys(node.children[node.activeChildIndex], acc);
  }
  // A view child (`claims: "view"`) only re-reads courses counted elsewhere,
  // so a parent skips it; asked directly, it reports its own.
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => { if (child.claims !== 'view') collectMatchedKeys(child, acc); });
    return acc;
  }
  for (const entry of node.matched || []) {
    if (typeof entry === 'string') acc.push(entry);
    else (entry.courseKeys || []).forEach((key) => acc.push(key));
  }
  return acc;
}

// How many courses a subtree counts: the matched courses plus applied
// substitutions that aren't a matched plan course (a transfer / study-abroad
// course fills a slot without being one). Mirrors collectMatchedKeys' walk, so
// a container's "x / y" matches the header numerator.
export function countCounted(node) {
  if (!node) return 0;
  if (node.waived) return (node.matched || []).length;
  if (node.type === 'ONE_OF' && Array.isArray(node.children) && node.activeChildIndex !== undefined) {
    return countCounted(node.children[node.activeChildIndex]);
  }
  if (Array.isArray(node.children)) return node.children.reduce((sum, child) => sum + (child.claims === 'view' ? 0 : countCounted(child)), 0);
  const matched = collectMatchedKeys(node);
  const outside = (node.substitutions || []).filter(
    (sub) => sub.status === 'applied' && !(sub.courseKey && matched.includes(sub.courseKey))
  ).length;
  return matched.length + outside;
}

// Same segmenting as HubFullView's segmentGroups: a run of consecutive
// collapsed cards shares one grid row, an expanded card gets its own
// full-width row. Order is never changed, so bulletin order is kept.
export function segmentCards(nodes, isCollapsed) {
  const segments = [];
  let run = [];
  function flushRun() {
    if (run.length > 0) {
      segments.push({ type: 'run', items: run });
      run = [];
    }
  }
  for (const node of nodes) {
    if (isCollapsed(node)) {
      run.push(node);
    } else {
      flushRun();
      segments.push({ type: 'solo', item: node });
    }
  }
  flushRun();
  return segments;
}

function hasChildNodes(node) {
  return (node.type === 'ALL' || node.type === 'ONE_OF') && Array.isArray(node.children);
}

// Flat list of every overridable node (everything but the root), in tree
// order. Container (ALL-with-children / ONE_OF) nodes are included alongside
// leaves since a whole group can be waived, not just a single requirement.
export function collectAllNodes(node, acc = [], isRoot = true) {
  if (!node) return acc;
  if (!isRoot) acc.push(node);
  if (hasChildNodes(node)) {
    node.children.forEach((child) => collectAllNodes(child, acc, false));
  }
  return acc;
}

// Walks the whole evaluated tree collecting every courseKey it can display
// (claimed, offered, subset, sequence), so the panel can make sure courseMap
// has display data (courseNumber/name) for each one, including required
// courses the student hasn't added yet.
export function collectAllCourseKeys(node, acc = new Set()) {
  if (!node) return acc;
  if (hasChildNodes(node)) {
    node.children.forEach((child) => collectAllCourseKeys(child, acc));
    return acc;
  }
  if (node.type === 'ALL') {
    (node.matched || []).forEach((key) => acc.add(key));
    (node.missing || []).forEach((key) => acc.add(key));
    return acc;
  }
  if (node.type === 'COUNT' || node.type === 'REMAINDER') {
    (node.matched || []).forEach((entry) => (entry.courseKeys || []).forEach((key) => acc.add(key)));
    const entries = [...(node.pool || []), ...(node.atLeast || []).flatMap((subset) => subset.pool || [])];
    for (const entry of entries) {
      (poolEntryCandidateKeys(entry) || []).forEach((key) => acc.add(key));
      if (isRangeEntry(entry)) (entry.include || []).forEach((key) => acc.add(normalizeCourseKey(key)));
      if (isSequenceEntry(entry)) {
        entry.options.forEach((option) => option.courses.forEach((key) => acc.add(normalizeCourseKey(key))));
      }
    }
  }
  if (node.type === 'SEQUENCE_GROUP') {
    (node.options || []).forEach((option) => option.courses.forEach((key) => acc.add(normalizeCourseKey(key))));
  }
  return acc;
}
