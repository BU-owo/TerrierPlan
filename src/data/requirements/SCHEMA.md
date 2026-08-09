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

## Requirement node types

Every node has a `type`, a `label`, and an **`id`** — a short, stable,
kebab-case string, unique within the file (e.g. `"cs-ba-group-a"`). `id` is
required on every node, including the root `tree` node and every nested
`ALL.children` entry — it's the key a plan's `requirementOverrides` map (see
root `SCHEMA.md`) uses to attach a waive/substitute to a specific node, so it
must stay stable across edits to that node's `label`/wording. Don't reuse an
id elsewhere in the same file, and don't repurpose an existing id for a
different node once a plan may have referenced it — add a new one instead.

The evaluator adds `status` (`'satisfied' | 'unsatisfied' | 'needs_review'`),
`matched`, `missing`, `satisfiedCount`, and `required` to each node in its
output — don't set those in the source JSON, they're computed. When a
`requirementOverrides` entry targets a node's `id`, the evaluator also adds
`waived: true` (for a `"waive"` override) or `substituted: true` (for a
`"substitute"` override) plus `overrideNote` — see "Manual overrides" below.

For `COUNT`/`REMAINDER`, each `missing` entry also carries `courseKeys`: the
enumerable list of courseKeys that would satisfy that slot (a plain courseKey
or `OR_EQUIVALENT`/`SUBSTITUTE_GROUP`/`COURSE_LIST` entry), or `null` for
`COURSE_RANGE`/`COURSE_RANGE_CAP` entries, which aren't enumerable without a
full course catalog. Those same entries carry `range` instead —
`{ subject, min, max, exclude }` taken straight from the pool entry — so the
UI can offer a "browse this range" action even though it can't list the
courses up front. The UI uses `courseKeys` to offer "add this course" chips
for enumerable remaining-eligible courses, and `range` to offer a browse
action for the non-enumerable ones.

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

### `UNRESOLVED`
`{ "type": "UNRESOLVED", "label": "...", "note": "..." }`

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

## Pool entries

Used in `COUNT.pool`, `REMAINDER.pool`, and `REMAINDER.additionalPool`. A
superset of slot refs — any slot ref is a valid pool entry — plus:

- `{ "type": "COURSE_RANGE", "subject": "CASCS", "min": 300, "max": 599, "exclude": ["CASCS398"] }`
  — matches any planned, unclaimed course whose courseKey parses to that
  `subject` and whose catalog number falls in `[min, max]`. `exclude` is
  optional. Can contribute multiple courses to a single node (as many as are
  needed / available).
- `{ "type": "COURSE_RANGE_CAP", "subject": "CASCS", "min": 200, "max": 299, "cap": 2 }`
  — same matching as `COURSE_RANGE`, but never contributes more than `cap`
  courses to the node, even if the node needs more and more are available.
  Use for "up to N courses from X may count" language.
- `{ "type": "COURSE_LIST", "courses": ["CASCS591", "CASCS599"] }` — a flat,
  explicitly named list (not a subject/number range). Unlike `OR_EQUIVALENT`,
  more than one course from the list can count if the node needs more than
  one — each listed course is its own potential claim, not a single slot with
  alternatives.

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

`evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides)`
takes an optional third argument: the plan's `requirementOverrides` map (see
root `SCHEMA.md`), keyed by node `id`. This is entirely plan-scoped — it's
never written back to the program JSON, and it's student-reported, not
verified. Before evaluating a node, the engine checks
`requirementOverrides[node.id]`:

- `{ type: "waive" }` — the node is treated as fully satisfied and its
  normal evaluation is skipped entirely: no children are evaluated, no
  courses are claimed. A waived `ALL` container's children never render in
  the output tree (there's nothing to show — the whole node is excused).
  Waiving a node doesn't change what its siblings structurally expect (see
  `structuralCourseCount` — that's computed from the static JSON shape, not
  from live evaluation), so a waived Group C still counts as "2 courses" for
  a sibling `REMAINDER`'s denominator, same as if it'd been satisfied
  normally.
- `{ type: "substitute", courseKey }` — the given courseKey is added to the
  node's pool for this evaluation only, then the node evaluates normally so
  the course participates in claim priority exactly like any other pool
  entry (including losing out to an earlier-evaluated sibling that also
  wants it — see Double-counting above). Meaningful for `UNRESOLVED` nodes
  (evaluated as a synthetic `COUNT(min: 1, pool: [courseKey])` so they can
  actually claim something) and for `COUNT`/`REMAINDER` nodes (courseKey is
  prepended to `pool`). Has no effect on `ALL` nodes — there's no pool to
  add to, and no well-defined "which required course does this substitute
  for."

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
