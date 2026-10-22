# Degree Requirements JSON Schema

Authoring reference for files under `src/data/requirements/{school}/{program-slug}.json`,
evaluated by `src/utils/requirementsEngine.js` (`evaluateRequirementTree`). Each file
is a pure, hand-authored data file — no logic, no imports.

## File shape

```jsonc
{
  "programName": "Computer Science",
  "degree": "BA",
  "school": "CAS",
  "bulletinUrl": "https://www.bu.edu/academics/cas/programs/computer-science/ba/",
  "minGrade": "C",
  "totalCoursesRequired": 15,
  "verifiedBy": null,       // string | null — who last checked this against the bulletin
  "verifiedDate": null,     // string | null — ISO date of last verification
  "tree": { /* a single requirement node, see below */ }
}
```

`bulletinUrl` is the lookup key: it must exactly match the `url` field of the
corresponding program entry in `src/data/bu-programs.js`, and the value stored
in a plan's `majorBulletinUrl` field (see root `SCHEMA.md`). The UI matches on
this field, not on filename — filenames are just for human organization.

`totalCoursesRequired` is a fallback. The progress line ("X of N courses
counted") uses a total derived from the evaluated tree along the branch that
counts — `required` per node, a `ONE_OF`'s active child only, a
`SEQUENCE_GROUP`'s matched (or closest) option's course count, 0 for
`UNRESOLVED` and the unmet part of (older) whole-node waives — so it follows the student's track. A substitution never changes it. The
authored number is used only if that derivation fails.

## `sequence` (optional): the standard plan

A program file may carry a `sequence` — its typical term-by-term path — which
turns on the "Fill my plan with the standard 4-year plan" button in the
Requirements tab (shown only for programs that have one). Authored as data,
next to the requirements; the logic lives in `src/utils/sequenceSeed.js`.

```jsonc
"sequence": {
  "fillPriority": ["ee-bs-core-electives", "ee-bs-computer-elective"],   // optional
  "slots": [
    { "courses": ["CASMA123", "ENGEK100"],
      "placeholders": [{ "label": "Natural Science Elective", "fills": "ee-bs-natural-science" }] },
    { "courses": ["CASMA124"] },
    ...
  ]
}
```

- `slots[i]` is the planner's grid slot `i`: Fall Year 1 = 0, Spring Year 1 = 1,
  Fall Year 2 = 2, … (Fall Year 4 = 6, Spring Year 4 = 7). `courses` are plain
  courseKeys; `placeholders` are 4-credit planning placeholders
  (`{ label, fills? }`).
- `fills` is the id of a node in this program's tree (a COUNT / REMAINDER /
  ALL leaf), or `"hub"`. It lets a real course placed in that term take the
  placeholder over (see root `SCHEMA.md`, "fills"). A placeholder without
  `fills` is just a placeholder: added once per term and label, never taken over.
- `fillPriority` (optional): node ids, most specific first, deciding which
  placeholder a course takes when several in one term fit. Nodes not listed
  follow in sequence order, `"hub"` always last.
- Seeding only adds, never moves or deletes: a course is skipped when it is
  already anywhere in the plan or when the engine (plan + external credits +
  completed courses + petitions) already has its requirement slot filled
  (so WR 152 skips WR 151). A skipped course leaves its slot empty. Per
  elective node, only as many placeholders as the engine still has open are
  added (minus ones already planned); Hub placeholders are added up to the
  sequence's own count. Past terms and Marine terms are not seeded.
- Checked by `src/utils/sequenceSeed.test.js` (`validateSequence`): every
  courseKey exists in `public/courses.json`, every `fills` is `"hub"` or a node
  id of the same program, every `fillPriority` entry is a node id.
- Keep it generic: any program can add one. Don't use it for a variant slot
  (e.g. EK 125 vs EK 121 + 122): list the course the planning sheet uses, the
  engine's alternatives take care of the rest.

## Requirement node types

Author nodes in the order the bulletin states them; the UI shows `UNRESOLVED` ("Check with advisor") nodes last among their siblings, in the same relative order. (Display only — evaluation and claim order stay as written.)

Every node has a `type`, a `label`, and an **`id`** — a short, stable,
kebab-case string, unique within the file (e.g. `"cs-ba-group-a"`). `id` is
required on every node, including the root `tree` node and every nested
`ALL.children` entry — it's the key a plan's `requirementOverrides` map (see
root `SCHEMA.md`) uses to attach a waive/substitute to a specific node, so it
must stay stable across edits to that node's `label`/wording. Don't reuse an
id elsewhere in the same file, and don't repurpose an existing id for a
different node once a plan may have referenced it — add a new one instead.

Two optional text fields, for two different readers:

- **`note`** — shown to students. Plain language, written for someone
  planning their degree ("This isn't checked automatically."), no internal
  details. Today the UI renders it on `UNRESOLVED` nodes; on other node
  types it's stored but not shown.
- **`devNote`** — for authors only: sourcing, approximations, catalog
  gaps, TODOs. Never rendered, and ignored by the engine and the UI.

The evaluator adds `status` (`'satisfied' | 'unsatisfied' | 'needs_review'`),
`matched`, `missing`, `satisfiedCount`, and `required` to each node in its
output — don't set those in the source JSON, they're computed. When a
`requirementOverrides` entry targets a node's `id`, the evaluator also adds
`waived: true` (for a whole-node `"waive"` override) plus `overrideNote`. Leaf
nodes (`ALL` course lists, `COUNT`, `REMAINDER`, `SEQUENCE_GROUP`) also get
`substitutions` and `openSlots` — see "Manual overrides" below. (`substituted:
true` only marks an older substitute on an `UNRESOLVED` node.)

For `COUNT`/`REMAINDER`, each `missing` entry also carries `courseKeys`: the
enumerable list of courseKeys that would satisfy that slot (a plain courseKey
or `OR_EQUIVALENT`/`SUBSTITUTE_GROUP`/`COURSE_LIST` entry), or `null` for
`COURSE_RANGE`/`COURSE_RANGE_CAP` entries, which aren't enumerable without a
full course catalog. Those same entries carry `range` instead —
`{ subject, min, max, exclude, include }` taken from the pool entry — so the
UI can list matching courses from the static catalog even though the engine
can't list them up front. The UI uses `courseKeys` to offer stash chips for
enumerable remaining-eligible courses, and `range` for an inline catalog list
for the non-enumerable ones.

Every `missing` entry also carries `fallback`: `true` when the entry came
from `REMAINDER.additionalPool`, `false` otherwise. The UI shows fallback
entries as a one-line "also counts here" note, never as stash chips.

Full `missing` entry shape:
`{ label, entryLabel, courseKeys, range, entryIndex, fallback }`.
Full `matched` entry shape (`COUNT`/`REMAINDER`):
`{ label, entryLabel, courseKeys, entryIndex, fallback, subsetIndex? }`.
`label` is generated from the entry; `entryLabel` is the pool entry's own
optional authored `label` (null if none); `entryIndex` is the entry's
position in its own pool (`pool`, `additionalPool`, or an `atLeast` subset's
pool); `subsetIndex` is present only on entries claimed by an `atLeast`
subset (see `COUNT`).

### `ALL`
Two forms, distinguished by which key is present:

- **Container**: `{ "type": "ALL", "children": [...] }` — every child node
  must be satisfied. (`UNRESOLVED` children are exempt — see below.)
- **Leaf**: `{ "type": "ALL", "courses": ["CASCS111", ...] }` — every listed
  courseKey must be present in the plan.

A node must not mix `children` and `courses`.

### `COUNT`
`{ "type": "COUNT", "min": 2, "pool": [...slotRefs or poolEntries] }`

At least `min` distinct entries in `pool` must be satisfiable. The evaluator
walks `pool` in order and claims courses greedily until `min` is reached,
then stops — later pool entries are left completely unclaimed (even if the
student took a matching course), so they remain available to other
requirement nodes (see Double-counting below). **Pool order is claim
priority**, so put the entries you'd prefer claimed first.

#### Display fields (optional, display only)
- `"subtitle": "..."` on a `COUNT` or `REMAINDER` replaces the generated line under its title
  ("Pick N of M", "Pick N from this list"). Counting is unchanged.
- `"noteStyle": "caption"` renders the node's `note` as normal-weight caption
  text instead of the default italic grey.
- `"continues": true` on a pool entry draws that entry inside the previous
  entry's box with no heading of its own (e.g. an either/or slot plus a list
  that together form one visible area). Claiming order is unchanged.

#### `atLeast` (optional, `COUNT` and `REMAINDER`)
```jsonc
"atLeast": [{ "label": "At least 1 calculus or statistics course", "min": 1, "pool": [...poolEntries] }]
```
"At least N of these must be among the courses." `label` is shown verbatim
as the subset's sub-line (and as the marker on its courses), so write the
whole phrase; without one the UI shows "At least N of these". Each subset is evaluated
**first**, claiming up to its own `min` from its own `pool`; those claims
count toward the node's total (`min` / REMAINDER's computed requirement).
The main pool(s) then fill only `required − Σ subset.min`, so the node can't
be satisfied while a subset is short. A subset pool may overlap the main
pool — a course is still only claimed once. The evaluated node gets
`subsets: [{ label, min, status, satisfiedCount, matched, missing }]` in
`atLeast` order (always present, `[]` when there are none); subset claims
are also in the node's `matched`, tagged with `subsetIndex`.

#### `poolFrom` (optional, `COUNT`)
```jsonc
{ "type": "COUNT", "min": 4, "poolFrom": "marineSemester" }
```
For a requirement whose course list changes every year and lives in code, not
in the JSON. The only value today is `"marineSemester"`: the engine fills the
node's `pool` from `marinePool()` in `src/data/marineSemester.js` (the
bulletin's Marine Semester list; cross-listed twins are one `OR_EQUIVALENT`
slot so a pair counts once; not the Marine Breadth courses). Resolution happens
inside the engine (`resolvePoolFrom` per node; `resolveProgramPools` for tests
and tooling that read the JSON directly), so the evaluated node, the UI and the
sweep test all see the same pool. An authored non-empty `pool` wins; an
unknown `poolFrom` is ignored. Don't author a `pool` next to `poolFrom`.

`evaluateRequirementTree`'s fourth argument `{ marineSlots }` is the number of
Marine Semester course slots the plan still holds: the placeholders and the
research-in-lieu courses (MR 391/392/491/492) in its Marine Semester terms
(a real pool course has replaced its placeholder and counts through the pool).
The node's numerator is `min(required, real pool courses claimed + marineSlots)`:
after the pool claims, the unmet slots are filled through synthetic claimed
keys (`OUTSIDE|…`, never real courseKeys), reported in `matched` as
`{ marineSlots: n, courseKeys: [] }`, which the UI shows as one "n Marine
Semester courses (from your plan)" row. `required`, and so the program total
(17 for Marine Science), never changes. Fills run before substitutions, so with
the slots held a substitution finds no open slot (`no-open-slot`, inert);
without them, an open slot of `min` stays for petitions (⋯ → Substitute a
course once per course). `marineSlots` absent or 0 changes nothing.

### `ONE_OF`
```jsonc
{ "id": "...", "type": "ONE_OF", "label": "Chemistry track", "children": [...nodes] }
```
Exactly one child must be complete (e.g. standard vs. alternative track).
Each child is evaluated against its own copy of the claimed set; the chosen
child is the first satisfied one, else the one with the best
`satisfiedCount / required` ratio (ties: first). Only the chosen child's
claims are committed. Output: `status` (satisfied if any child is),
`activeChildIndex`, `children` (all evaluated, for display — only the active
one's claims are real), `satisfiedCount`/`required` = 1/1 or 0/1. For a
sibling `REMAINDER`'s denominator it counts as the smallest child. Overrides:
waive only (a substitute override on a `ONE_OF` has no effect).

Optional `"presentation": "tracks"` (display only — evaluation is unchanged)
hoists a top-level `ONE_OF` out of the card list: its options become a track
selector (same segmented control, the bulletin's track names) under the
progress header, and the selected option's children render as ordinary
top-level cards, with no "Required Courses 0/1" card and no repeated track
heading. The selected tab starts on the engine's active track. Use it only for
a major whose whole requirement is a choice of tracks (Mathematics BA); other
`ONE_OF`s (Biology's chemistry and physics) render as a card with a toggle.

### `REMAINDER`
```jsonc
{
  "type": "REMAINDER",
  "totalRequired": 15,
  "pool": [...poolEntries],
  "additionalPool": [...poolEntries]   // optional, tried only if pool falls short
}
```

REMAINDER fills in the gap between `totalRequired` and what its siblings are
*structurally* expected to contribute — e.g. for CS BA, `15 - (5 Group A +
2 Group B + 2 Group C) = 6`. That denominator (`required`) is fixed: it's
computed from each sibling's own `min` / `courses.length`, **not** from how
many of those the student has actually finished so far. A student who's only
done 2 of Group A's 5 courses still sees Group D asking for 6 electives, not
9 — otherwise finishing Group A later would silently shrink what Group D
asked for, which reads as the requirement moving on you.

The `matched`/`satisfiedCount` numerator, on the other hand, *is* live: it's
whatever REMAINDER's `pool`/`additionalPool` can actually claim from the
plan right now (trying `pool` first, then `additionalPool` if still short),
correctly skipping anything already claimed elsewhere.

**A `REMAINDER` node always evaluates last among its siblings**, regardless
of where it's positioned in the `children` array — the engine reorders
evaluation (not the output) to guarantee this, since REMAINDER's claiming
depends on what everyone else already claimed (though its `required`
denominator does not — see above). Still, write it last in the JSON for
readability.

A container should have at most one `REMAINDER` child in practice (multiple
would all race for the same `totalRequired` target).

### `SEQUENCE_GROUP`
```jsonc
{
  "type": "SEQUENCE_GROUP",
  "options": [
    { "label": "Sequence I", "courses": ["CASCH109", "CASCH110"] },
    { "label": "Sequence II", "courses": ["CASCH111", "CASCH112"] },
    { "label": "Sequence III", "courses": ["CASCH101", "CASCH102", "CASCH201"] }
  ]
}
```

Exactly ONE bundle from several must be completed in full — the "choose one
sequence, complete every course in it" shape (e.g. BU's General Chemistry
Sequence: CH109+CH110, OR CH111+CH112, OR CH101+CH102+CH201). An option's
courses are fixed — a nested "X or Y" within a single bundle isn't
expressible directly; write out each variant as its own option instead (e.g.
"(CH203 or CH218) + CH214" becomes two options, `CH203+CH214` and
`CH218+CH214`).

Satisfied once every course in one option is present and unclaimed; the
evaluator tries options in array order and claims the first fully-matching
one — same claim-priority convention as `COUNT`/`REMAINDER` pools. A student
who happens to qualify for more than one option only has the first claimed;
the rest are left alone rather than picking "the best" one. Only ever
contributes `satisfiedCount`/`required` of `0/1` or `1/1` — it's one slot,
regardless of how many courses the winning option happened to need.

When unsatisfied, the output also carries `partialMatch`: either `null` (the
student has zero courses toward any option — nothing to prioritize) or
`{ label, haveKeys, needKeys }` for whichever option has the most
already-present-and-unclaimed courses (ties go to the first option in array
order). Purely additional reporting for the UI to show progress toward one
specific sequence instead of a flat list of every option — it doesn't affect
`status`, claiming, or `satisfiedCount`/`required` above.

`SEQUENCE_GROUP` can also appear as a **pool entry** (see below) when the
bundle is one of several alternative ways to fill a slot inside an existing
`COUNT`/`REMAINDER`, rather than a standalone required node of its own —
e.g. "BB 401 + BB 402 together count as one BMB elective" sits inside the
BMB Electives `COUNT`'s pool alongside its `COURSE_LIST` entry, instead of
being modeled as a second, independently-required sibling that would have to
be satisfied *in addition to* an already-satisfied elective pool.

### `UNRESOLVED`
`{ "type": "UNRESOLVED", "label": "...", "note": "...", "devNote": "..." }`

`note` is what the student sees under the "Check with advisor" badge;
`devNote` is author-only (see "Requirement node types").

For petition/department-approval clauses that can't be auto-verified from a
course list (e.g. "up to 2 non-CS courses may count with Undergraduate
Director approval"). Always evaluates to `status: 'needs_review'`, never
claims any courses, and — importantly — **never blocks its siblings or its
parent container from showing `satisfied`**. It exists purely so the UI can
flag "this needs a human to check" without dragging the rest of the program
down to "incomplete." A program can be fully `satisfied` while still having
`needs_review` nodes in its tree.

## Slot refs

A slot ref describes **one** required course, possibly with substitutes. Used
directly in `COUNT.pool` / `ALL.courses` array entries, or as an element of a
pool (see below).

- A plain courseKey string: `"CASCS111"`.
- `{ "type": "OR_EQUIVALENT", "options": ["CASCS132", "CASMA242"] }` — any one
  of `options` satisfies the slot.
- `{ "type": "SUBSTITUTE_GROUP", "primary": "CASCS132", "substitutes": ["CASMA242"] }`
  — `primary` or any listed substitute satisfies the slot. (Functionally the
  same as `OR_EQUIVALENT` with `primary` first in `options`; use whichever
  reads more clearly for the bulletin language you're transcribing —
  `SUBSTITUTE_GROUP` when the bulletin frames it as "X (or Y)", `OR_EQUIVALENT`
  when it frames it as a flat list of equal options.)

### Slot-ref display fields (optional, pool entries only)

On an object pool entry that is a single-slot ref (`OR_EQUIVALENT` /
`SUBSTITUTE_GROUP`), two optional fields change how the slot is drawn. Neither
affects matching, claiming or counts:

- `"optionTags": { "CASEC221": "Substitute", "QSTQM221": "Substitute" }` —
  courseKey → short pill text. A tagged option shows a small muted pill and a
  slightly softer row; options without a tag are the standard/default
  course. Nothing is hidden or reordered — list the standard option first
  yourself. Keys are normalized like any courseKey; unknown keys are ignored.
- `"note"` — one plain-language line shown under the slot's title (student-facing,
  same rules as node `note`; no internal details). Use `devNote` for authoring
  notes (it is ignored on pool entries).

## Pool entries

Used in `COUNT.pool`, `REMAINDER.pool`, `REMAINDER.additionalPool`, and
`atLeast[].pool`. A superset of slot refs — any slot ref is a valid pool
entry — plus the types below. Any object pool entry may also carry an
optional `"label"` (e.g. `"Calculus"`), carried through to the evaluated
`matched`/`missing` entries as `entryLabel` and used by the UI as the
entry's title.

- `{ "type": "COURSE_RANGE", "subject": "CASCS", "min": 300, "max": 599, "exclude": ["CASCS398"] }`
  — matches any planned, unclaimed course whose courseKey parses to that
  `subject` and whose catalog number falls in `[min, max]`. `exclude` is
  optional. Can contribute multiple courses to a single node (as many as are
  needed / available). Optional `"include": ["CASMA242", ...]` — extra
  courseKeys (normalized) that also match, outside the subject/number range;
  `exclude` and already-claimed still apply. `courseKeys` on a missing range
  entry stays `null`; the include list is reported as `range.include`
  instead (the UI lists those courses above the catalog browse list).
  `COURSE_RANGE_CAP` ignores `include`.
- `{ "type": "COURSE_RANGE_CAP", "subject": "CASCS", "min": 200, "max": 299, "cap": 2 }`
  — same matching as `COURSE_RANGE`, but never contributes more than `cap`
  courses to the node, even if the node needs more and more are available.
  Use for "up to N courses from X may count" language.
- `{ "type": "COURSE_LIST", "courses": ["CASCS591", "CASCS599"] }` — a flat,
  explicitly named list (not a subject/number range). Unlike `OR_EQUIVALENT`,
  more than one course from the list can count if the node needs more than
  one — each listed course is its own potential claim, not a single slot with
  alternatives. Optional `"cap": N` — never contributes more than N courses
  to the node (like `COURSE_RANGE_CAP`, for an explicit list).
- `{ "type": "SEQUENCE_GROUP", "options": [{ "label": "...", "courses": [...] }, ...] }`
  — see the `SEQUENCE_GROUP` node type above for the shape and matching
  rules. As a pool entry it still claims every course in its matched option,
  but (unlike `COURSE_LIST`) counts as exactly **one** claim toward the
  node's `min`/`totalRequired`, not one per course — a two-course bundle
  fills one slot, the same way a single `OR_EQUIVALENT` course would.

## courseKey parsing

`courseKey`s have no separator (e.g. `"CASCS330"`, not `"CAS CS 330"`), but
the subject is always the leading letters and the catalog number is always
the trailing digits, so `/^([A-Z]+)(\d+)$/` splits them reliably. This is
exactly the regex `requirementsEngine.js` uses for `COURSE_RANGE` /
`COURSE_RANGE_CAP` matching — don't invent a second normalization scheme.

## Double-counting

The evaluator threads one `claimed` Set through the entire tree evaluation.
Once a course is claimed by a node, no later-evaluated node (in the array
order described above — siblings left-to-right, `REMAINDER` last) can claim
it again. This is how "CS132 counts for Group B unless it's needed in Group
D" language gets expressed: put the possibly-reusable course in an earlier
group's pool, and in a later group's `additionalPool` as a fallback — if the
earlier group didn't need it, it's still unclaimed and available.

## Manual overrides

`evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides, options)`
(`options.marineSlots`: see `poolFrom` above) takes an optional third argument: the plan's `requirementOverrides` map (see
root `SCHEMA.md`), keyed by node `id`. This is entirely plan-scoped — it's
never written back to the program JSON, and it's student-reported, not
verified. Before evaluating a node, the engine checks
`requirementOverrides[node.id]`:

- `{ type: "waive" }` — whole-node waive: the node is reported as satisfied,
  but the courses the student actually holds in it stay claimed and counted
  (the node is evaluated normally first, so nothing is released to later
  nodes). Its `required` becomes the number of courses it holds — a 3/5 node
  reads 3/3, and the program total drops only by the unmet 2. `matched` is a
  flat list of the claimed keys. A `SEQUENCE_GROUP` also claims the courses of
  its closest partially-held option. `UNRESOLVED` nodes claim nothing and stay
  0 / 0. A waived `ALL` container's children never render in the output tree
  (there's nothing to show — the whole node is excused).
  Waiving a node doesn't change what its siblings structurally expect (see
  `structuralCourseCount` — that's computed from the static JSON shape, not
  from live evaluation), so a waived Group C still counts as "2 courses" for
  a sibling `REMAINDER`'s denominator, same as if it'd been satisfied
  normally.
- `{ type: "substitute", substitutions: [{ courseKey?, label?, for? }] }` — a
  petition: each substitution replaces ONE required course with a different
  course. The node is evaluated normally first; then each substitution fills
  one still-unmet slot of that node (the slot `for` names, else the first open
  one). The node's `required`, and so the program total, never changes, and
  the numerator goes up by one. The substitute does not have to be in the
  plan: `courseKey` is a catalog course, `label` is plain free text (trimmed,
  max 80 chars, at least one of the two) for a course from somewhere else
  (transfer, study abroad, ...). A substitute that is a plan course not counted
  elsewhere is claimed by the node (so it can't be counted twice); one that
  isn't in the plan, or has only a `label`, claims nothing and is counted
  through a synthetic claimed key. Per node type:
  - `ALL` leaf — `for` is the required courseKey being replaced.
  - `COUNT` with named slots (every pool entry is one slot — a plain
    courseKey, `OR_EQUIVALENT`, `SUBSTITUTE_GROUP` or `SEQUENCE_GROUP` — and
    `pool.length === min`, like the Economics core) — `for` is any course of
    the slot being replaced. Other `COUNT`s and `REMAINDER` have no named slots
    (range / list pools, or pick-N-of-M): `for` is omitted and a substitution
    fills one open slot.
  - `SEQUENCE_GROUP` — `for` is a course of the option being completed. The
    group is still all-or-nothing, so an unfinished option claims nothing yet
    (the substitution reads `pending`).
  - `ALL` container and `ONE_OF` have no courses of their own: substitutions
    live on the leaf nodes inside (for a `ONE_OF`, the track that counts).
  A substitution is inert — not counted, and a plan course it names is
  released to other nodes — when the real course for its slot is completed
  (`real-course-completed`), when it names a plan course another node already
  counts (`already-counted`), or when the node has no unmet slot left
  (`no-open-slot`); effective substitutions are capped at the node's unmet
  slots. The evaluated node carries `substitutions: [{ courseKey?, label?,
  for?, status, replaces?, entryIndex? }]` and `openSlots` (what is still
  unmet: `[{ for, keys, label? }]` per course or named slot, or one `[{ for:
  null, keys: null, count }]` for range / list pools), which the substitute
  picker uses. The older shape `{ type: "substitute", courseKey }` is read as
  one substitution with no `for`; on an `UNRESOLVED` node it is still
  evaluated as a synthetic `COUNT(min: 1, pool: [courseKey])` (nothing creates
  it any more). `ONE_OF` completing through substitutions can make its track
  the active one, so the total follows that track's size — that is the ONE_OF
  rule, not a denominator change by the substitution.

## Worked example

See `cas/computer-science-ba.json`. It uses every node type:

- Group A (`ALL` leaf) — 5 required foundational courses.
- Group B (`COUNT`, min 2 of 3) — formal tools, each slot a `SUBSTITUTE_GROUP`
  (BU course or its MA-department equivalent).
- Group C (`COUNT`, min 2 of 3) — central topics, plain courseKey pool.
- Group D (`REMAINDER`, totalRequired 15) — any CS 300–599 course not already
  claimed, falling back to unclaimed Group B courses (CS132/235/237) if the
  300–599 range doesn't supply enough on its own.
- A trailing `UNRESOLVED` node for the discretionary non-CS petition clause,
  which never blocks the program from reading `satisfied` once Groups A–D
  hit 15/15.
