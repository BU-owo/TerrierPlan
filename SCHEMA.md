# Firestore Schema — BU Degree Planner / Scheduler / HUB Tracker

## Join key

`bu_courses_all.csv` course numbers ("CAS AA114") and `Fall2026Courses.csv`
Subject Area + Catalog Nbr ("CASAA" + "114") both normalize to the same
string when spaces are stripped and uppercased: **"CASAA114"**.

This normalized string (`courseKey`) is the join key between the `courses`
collection and the `sections` collection. It is NOT necessarily the Firestore
document ID for `courses` in all cases — see below.

---

## Collections

### `courses/{courseKey}`
One doc per catalog course. Source: full bulletin scrape (periodic).

| Field | Type | Notes |
|---|---|---|
| courseNumber | string | Original, e.g. "CAS AA114" |
| name | string | |
| prerequisites | string | Raw text, unparsed |
| description | string | |
| hubUnits | string[] | e.g. `["SI1", "CRI"]` — derived from one-hot columns |
| lastScraped | timestamp | |
| offeringPattern | string \| null | Historical offering frequency, e.g. `"Fall"`, `"Fall and Spring"`, `"Alternating Fall"`, `"Alternating Spring"`, `"Not offered in 5 years"`, `"Random"`, `"Insufficient data"`. Merged separately from the fields above — see `offeringHistory` and Import order below. Absent (not just null) on courses the offering-data import never matched. |
| offeredSeasons | string[] | e.g. `["Fall", "Summer"]` |
| fallRatio, springRatio, summerRatio | number \| null | Fraction of offered terms in each season, over the dataset window |
| firstOfferedYear, lastOfferedYear | number \| null | |
| datasetYearsAvailable | number \| null | How many years of history the ratios above are computed over |
| offeringDataUpdatedAt | timestamp | Set by `import-offering-data.cjs`, separate from `lastScraped` |

Note: this CSV has no credit-hours column. Credits come from `sections` —
if a course has no current sections (e.g. not offered this term), credits
will be unknown until you either backfill from a prior term's data or add
a manual override field later.

### `sections/{term}_{classNbr}`
One doc per section per term. Source: manually imported official schedule
file, once per term. Multiple raw CSV rows (duplicate rows per instructor)
collapse into one doc with an `instructors` array.

| Field | Type | Notes |
|---|---|---|
| courseKey | string | Join key back to `courses` |
| term, session | string | |
| subjectArea, catalogNbr, classSection, classNbr | string | |
| instructors | {first, last}[] | Deduplicated |
| credits | number | |
| campus, daysOfWeek, startTime, endTime, facilId | string | |
| meetingStartDate, meetingEndDate | string | |
| capEnrl, waitCap, minEnrl, totEnrl, waitTot | number | |
| enrlStat | string | "Open" / "Closed" |
| classStat, classType, mode | string | |
| component | string | Raw PeopleSoft component code, e.g. `"LEC"`, `"DIS"`, `"LAB"`, `"PLB"` (pre-lab). Only present when imported from `schedule_with_types.csv` (the base schedule export doesn't have this column) — absent/empty on sections imported before that file existed. Unlike `classType` (just "Enrollment" vs "Non-Enroll"), this can distinguish a discussion from a lab from a pre-lab, so it's the more reliable field for that. |
| componentLabel | string | Human-readable form of `component`, e.g. `"Discussion Section"`, `"Laboratory"`, `"Pre-lab Section"` — falls back to the raw code when PeopleSoft has no friendlier label for it. Same import-source caveat as `component`. |
| notes | string | Free text — linked lecture/discussion info lives here, unstructured. `component`/`componentLabel` now cover "what kind of section is this" structurally; notes still carries anything finer, e.g. which specific lecture a given discussion/lab pairs with. |
| finalExam | string | |
| meetings | object[] | Optional. Every recurring weekly meeting of the section, primary class meeting first. Entry: `{ daysOfWeek, startTime, endTime, facilId, meetingStartDate, meetingEndDate, kind }` — the first six are formatted exactly like the top-level fields, `kind` is `"class"` or `"exam"` (an evening exam block, e.g. "NO ROOM" Tue 6:30 PM; ignore `"exam"` entries when checking class overlaps). `meetings[0]` is the same meeting as the top-level meeting fields. Dated one-offs (date span 7 days or less) are left out. **Written only for undergrad sections with 2+ distinct recurring patterns** (OTPMS, MED and LAW excluded), by `import-sections.cjs` / `backfill-meetings.cjs` via `scripts/lib/meetings.cjs`. **Legacy fallback:** a missing `meetings` means "one meeting, read the top-level fields", so readers must handle docs without it. |
| importedAt | timestamp | |

### `offeringHistory/{courseKey}`
Full per-term offering history, written alongside the summary fields on
`courses/{courseKey}` above by the same `import-offering-data.cjs` run.
Split into its own collection instead of embedding on the course doc
because it can run to dozens of entries per course.

| Field | Type | Notes |
|---|---|---|
| history | object[] | `{ term, year, season, sectionCount }[]` |
| updatedAt | timestamp | |

**Access:** `firestore.rules` has a `match /offeringHistory/{courseKey}`
block — public read (`allow read: if true`), no client writes
(`allow write: if false`), same as `courses`/`sections`. Only the import
scripts (Admin SDK, which bypasses rules) write it.

### `bulletinPages/{majorSlug}`
Stored bulletin text per major, for the planner's side panel (manual
requirement-checking, no rules engine yet).

| Field | Type | Notes |
|---|---|---|
| majorName | string | |
| bulletinUrl | string | Source link, for "view original" |
| content | string | Cleaned text/HTML of the requirements page |
| lastFetched | timestamp | |

### `users/{uid}`
| Field | Type | Notes |
|---|---|---|
| displayName | string | |
| email | string | |
| createdAt | timestamp | |
| currentSemesterTarget | number \| string \| null | Student-reported "I am currently in this semester" marker. A number is a `semesters` index (see the plan doc below); a `summer:{year}` string is a Summer slot in `gridSummerTerms`. A fact about the *student*, not any one plan — shared by every plan of theirs (see `completedCourseKeys`), loaded once at sign-in and left untouched by switching or creating plans. `null` means none set. See `getSemesterStatus` in `courseEntry.js`. |
| completedCourseKeys | courseKey[] | Courses the student has locked/marked complete — also shared across every plan (locking a course in one plan locks it everywhere that courseKey appears). Setting `currentSemesterTarget` auto-adds every course in the active plan's now-past slots here, once; the student can freely remove any of them again (per-course or per-semester, see SemesterColumn's lock toggle). Drives the Requirements/HUB/Credits "Completed" chip as a fallback for courses that aren't chronologically past — see `describeLockStatus` in `treeHelpers.js`. |
| externalCredits | object[] | AP / IB / transfer credit (see `externalCredits[]` entry below) — also student-level, shared across every plan: adding, editing, or removing a credit in any plan applies everywhere. Backfilled once, the first time an account loads this field, by unioning `externalCredits` off all of that account's plan docs — first deduped by `id`, then deduped again by content (AP/IB: type+courseKey+testSubject, or type+testSubject+score+sourceTitle when there's no courseKey; transfer: sourceTitle+institution+courseKey), since independent plans can hold the same real-world credit under different generated ids. On a conflict, a copy with a student-entered manual override (manualHubUnits/manualCourseKey/manualCourses/advisorNote) wins regardless of recency; otherwise the most recently updated plan's copy wins — see `migratePlanExternalCredits` in `PlannerPage.jsx`. |

### `users/{uid}/plans/{planId}`
| Field | Type | Notes |
|---|---|---|
| name | string | e.g. "Plan A — CS major" |
| major | string | Free text for now, no schema validation |
| majorBulletinUrl | string \| null | Lookup key into `src/data/requirements/`. Matches the `url` field of a program entry in `bu-programs.js` and the `bulletinUrl` field of a requirements JSON file — set when the user picks a major in the bulletin panel. `major` stays free text for display; this is the only field the requirements engine can key off of. |
| semesters | entry[][] | One array per Fall/Spring slot (Fall/Spring × years; at least 8, i.e. 4 years; "+ Add Year" adds pairs up to 8 years/16 slots; older plans with more are left as-is). Stored as an object keyed by slot index (Firestore forbids nested arrays — see `semestersToFirestore`). Each entry is one of the kinds below, normalized on read by `normalizeCourseEntry` in `courseEntry.js`: **course** — `{ courseKey, locked, source }` (legacy docs may store a plain `courseKey` string; no `kind` field — `isCourseEntry`); **placeholder** (shown to students as "Placeholder"; stored as `kind: 'note'`, internal name kept so saved plans keep working) — `{ kind: 'note', id, text, credits }`, a free-text planning placeholder (e.g. "Economics Elective"), `credits` defaulting to 4. Placeholders have no courseKey (`entryCourseKey` returns `null`), count toward column/plan credit totals only — never HUB, requirements, offering warnings, or `completedCourseKeys` — and aren't lockable or draggable; **Marine Semester** (a term made of ordinary entries; see `src/data/specialTerms.js` and `src/data/marineSemester.js`) — a zero-credit **marker** `{ kind: 'note', id, text: 'Marine Semester', credits: 0, blockType: 'marine' }` plus four plain placeholders ("Marine Semester course", 4 credits each). The marker is a note with a `blockType` on purpose: app versions that predate it read it as an ordinary 0-credit placeholder and drop `blockType` on their next save (still harmless). A **Fall** slot is a Marine Semester term when its entries hold a marker, or any course tagged ONLY in `marineSemester.js` (hand-curated lists, unlisted courses = no rule; a degraded marker — a plain note reading exactly "Marine Semester" with 0 credits — counts as a marker). A marker outside a Fall slot is ignored for term purposes and flagged. A marker with nothing else beside it (the student deleted every placeholder and course) is not a Marine term and is dropped on read and after the deletion, so it disappears on the next save; any number of Marine Semester terms is allowed in a plan, and the requirements tracker caps at the 4 courses the major needs. Cross-listed Marine courses with unknown credits show their twin's credits, else 4 (`withMarineCreditFallback`, display only, never stored). A real course replaces one placeholder (`placeCourse`); when one leaves and the term would drop below 4 slots a placeholder is restored (`removeCourse`). Rules in `placeCourse`: an ONLY course goes only into an empty Fall (no courses; its plain placeholders are replaced) or a Marine term with room, otherwise it is refused (not a Fall / Fall already has courses / term full); a course with no tag can't go into a Marine term; ALSO courses have no rule; research courses (MR 391/392/491/492) fill one of the four slots. Imports (transcript, plan PDF) don't enforce these rules. The marker's stored credits are ignored on read and forced to 0, so the term's credits are its placeholders' (via `entriesNoteCredits`), counted once; in a past term those placeholders count as completed in the Credits panel (other placeholders are always planned). The never-deployed `{ kind: 'block', blockType: 'marine' }` and the 16-credit WIP note `{ kind: 'note', blockType: 'marine', credits: 16 }` are converted on read, per slot (`normalizeTermEntries`, via `normalizeSemesters` / `normalizeGridSummerTerms`), into a marker plus placeholders. The requirements engine gets the plan's remaining Marine slots (`options.marineSlots`, see `src/data/requirements/SCHEMA.md`). Plan PDF import keeps a marker only in a Fall slot at 0 credits (a second one in the same slot is dropped), converts the legacy shapes, and does not enforce term rules. Unknown `blockType`s on a note are kept as stored and shown as a generic read-only "Special term" (their credits count like a placeholder's). **`fills` (optional, on a placeholder or a course)** — a requirement-node id of the plan's program (kebab-case as authored in the program JSON) or `"hub"`. A placeholder with `fills` is added by "Fill my plan with the standard 4-year plan" from the program's `sequence` (see `src/data/requirements/SCHEMA.md`, `src/utils/sequenceSeed.js`): `{ kind: 'note', id, text, credits: 4, fills }`. A real course placed in the same term takes over ONE eligible `fills` placeholder (the engine's own pool membership for that node; `"hub"`: the course has HUB units and no more specific placeholder fits) and then carries the same `fills`, so removing it (or moving it to another term) gives the placeholder back where it was. A placeholder without `fills` is never taken over. `fills` is kept on read (`normalizeCourseEntry`, only when it matches the id shape `isFillsId`), in the Firestore and guest-localStorage blobs, in the plan PDF payload and by the plan import sanitizer (junk values are dropped); an older app version drops the field on its next save, leaving an ordinary placeholder / course. Transcript import never takes placeholders over. **Any other `kind`** (from a newer app version) is kept as-is and shown as "Special term", never read as a course. A plain object with no `kind` is always a course. The same entry kinds apply to `gridSummerTerms` (not `extraTerms` or `stash`, which stay courseKey-only). |
| isTransfer | boolean | HUB tracker uses transfer vs first-year requirement table |
| extraTerms | object[] | Summer / Winter / overflow post-degree Fall–Spring terms (see below). These courses **do** count toward HUB and credit totals. |
| ~~externalCredits~~ | object[] | **Removed** — moved to the parent `users/{uid}` doc (see above); it's student-level, not plan-level. Not read or written here anymore. A pre-existing plan doc may still have this field from before the move; it's left in place, untouched, as a read-only backup (see `migratePlanExternalCredits`) and never re-synced back down to plan docs. |
| cumulativeGpa | number? | Scraped from transcript footer on import (GPA UI not built yet) |
| earnedCredits | number? | Scraped from transcript footer on import |
| gradePoints | number? | Scraped from transcript footer on import |
| requirementOverrides | map | Student-reported waive/substitute exceptions to the major requirements tree (see below). **Never** treated as verified — informational only, no approval workflow. |
| stash | courseKey[] | Saved-for-later courses (the planner's "Paw-tential Courses" tab), kept separate from `semesters`/`extraTerms`. Not counted toward HUB, credits, or requirements — purely a bookmark list. |
| createdAt, updatedAt | timestamp | |

Note: `currentSemesterTarget`, `completedCourseKeys` (locking), and `externalCredits` live on the parent `users/{uid}` doc, not here — see above. They're facts about the student, not about any individual plan.

#### `extraTerms[]` entry
| Field | Type | Notes |
|---|---|---|
| term | string | e.g. "Summer 2021" |
| season | string | `'summer'` \| `'winter'` \| `'fall'` \| `'spring'` |
| courseKeys | string[] | BU `courseKey`s |
| isPostDegree | boolean? | True for terms after a listed graduation date / overflow Fall–Spring |

#### `externalCredits[]` entry
Shape of each entry in the `users/{uid}.externalCredits` array (see above) — listed here alongside `extraTerms[]` since both were originally plan-doc entry shapes; `id` is what the migration/merge logic dedupes on.
| Field | Type | Notes |
|---|---|---|
| id | string | Persistent per-entry identifier used for stable UI keying and updates |
| type | string | `'ap'` \| `'transfer'` |
| sourceTitle | string | Title as printed on the transcript |
| courseKey | string \| null | BU equivalent; null until user maps a transfer row |
| credits | number | |
| institution | string? | Transfer only |
| testSubject | string? | AP / test credit only |
| score | number? | AP / test score, when printed on transcript |
| status | string? | `'needs_mapping'` for a transfer row awaiting a BU equivalent; `'mapped'` once supplied |
| manualHubUnits | string[]? | Admin/BU-confirmed HUB override for an AP/test entry when automatic lookup is unresolved; `[]` confirms no HUB |

#### `requirementOverrides` map
Keyed by a requirement node's `id` (see `src/data/requirements/SCHEMA.md`),
not an array — one entry per overridden node, last-write-wins on re-save.

| Field | Type | Notes |
|---|---|---|
| type | string | `'substitute'` — a petition: replace one required course with a different course (see `substitutions`). `'waive'` — whole-node waive; nothing in the UI creates it any more except "Mark as done" on an `UNRESOLVED` node, but saved ones keep evaluating. |
| substitutions | object[]? | `'substitute'` only — `[{ courseKey?, label?, for? }]`; at least one of `courseKey` / `label`. `courseKey` is a catalog course (in the plan or not). `label` is free text (plain text, trimmed, max 80 chars) for a course from somewhere else — transfer, study abroad, ... — e.g. `"ECON 1115 — Northeastern"`. The substitute does not have to be in the plan. `for` says what it replaces: the required courseKey on an `ALL` list, any course of a named `COUNT` slot, or a course in a `SEQUENCE_GROUP` option; omitted on `COUNT` / `REMAINDER` nodes with range or list pools (it just fills one open slot). Never `undefined` — omit the field. Outside-course substitutions don't touch credit totals or external credits. |
| courseKey | string? | Older `'substitute'` shape (one course, no `substitutions`). Still read: it counts as one substitution with no `for`. New writes use `substitutions`. |
| note | string? | Free-text self-reported justification (e.g. "Approved by advisor 3/2026"). Shown in the UI, never validated. |
| createdAt | string | ISO timestamp, set client-side when the override is created |

A substitution fills one still-unmet slot of its node, so it never lowers the
program total: the denominator stays the same and the numerator goes up by
one, whether or not the substitute course is in the plan. Fields that don't apply are omitted — never `undefined`, which Firestore
rejects.

Read/written by `requirementsEngine.js`'s `evaluateRequirementTree` (third
argument) — see that file's `SCHEMA.md` for exactly how waive/substitute
affect evaluation. This is deliberately student-facing and unauthoritative:
no approval state, no admin review — the planner is informational, not a
degree audit.

### `users/{uid}/schedules/{scheduleId}`
| Field | Type | Notes |
|---|---|---|
| name | string | |
| term | string | |
| selectedSectionIds | string[] | References `sections` doc IDs |
| favorited | boolean | |
| createdAt, updatedAt | timestamp | |

### `siteStats/global`
Singleton doc backing the "X students have used TerrierPlan" line in the
global footer (`useSiteStats.js`). A rough, approximate counter, not a
strict unique-visitor count — incremented client-side, once per browser,
the first time that browser is ever seen (guest or signed-in), gated by a
`terrierplan_visitor_id` value in `localStorage`.

| Field | Type | Notes |
|---|---|---|
| totalUsersEver | number | Only ever created at `1` or incremented by exactly `+1` — enforced in `firestore.rules`, not just app code, since the increment is a client-side transaction. |

### `presence/{sessionId}`
One doc per active browser tab, backing the "Y online now" line in the
footer. `sessionId` is the signed-in `uid` when there is one, otherwise
the same guest `terrierplan_visitor_id` used by `siteStats/global` above.
Written every ~30s while a tab is open (`useSiteStats.js`); "online now" =
count of docs with `lastSeen` inside the last ~2 minutes, read via a
`getCountFromServer` aggregation query, refreshed every ~45s.

| Field | Type | Notes |
|---|---|---|
| lastSeen | timestamp | `serverTimestamp()`, refreshed every heartbeat. Query cutoff for "online now" is client-computed (`now - 2min`), not stored. |
| expiresAt | timestamp | `now + 10min` at write time, refreshed every heartbeat. Written for a Firestore TTL policy to eventually consume — **no such policy is configured yet.** |

**Known follow-up:** nothing currently deletes stale `presence` docs after
a tab closes (an unmount-based cleanup wouldn't reliably fire on tab
close anyway, and this hook is mounted once for the app's lifetime, not
per-route). `expiresAt` is written specifically so a Firestore TTL policy
can be turned on for this collection later (Firebase console → Firestore
→ TTL, field `expiresAt`) to auto-delete them; until that's configured,
stale docs just accumulate. Harmless for the online-now count itself
(the `lastSeen` cutoff already excludes them from the query), just
unbounded storage growth over time.

---

## Import order

1. Run `import-courses.js` against `bu_courses_all.csv` — populates `courses`.
2. Run `import-sections.js` against the term's official schedule CSV — populates `sections`.
3. Sections reference `courseKey`, so step 1 should generally run first, but the
   scripts don't hard-fail on a missing course doc — a section can exist
   before its course doc if the catalog scrape lags the schedule import.
4. Run `import-offering-data.cjs` against a historical-offerings JSON
   (courseKey → offering pattern/history) any time after step 1 — it only
   merges onto courseKeys that already have a `courses` doc, skipping the
   rest (e.g. non-catalog entries) rather than creating stray docs.
   Idempotent (`set` with `merge: true`), safe to re-run.
5. Run `export-catalog.cjs` last, after every import above (and after moving
   `CURRENT_TERM` in `src/utils/term.js`) — read-only, rewrites
   `public/courses.json`. That file's `upcomingSeasons` (e.g. `["Spring 2027"]`,
   the terms at or after `CURRENT_TERM` with a non-cancelled section, only
   emitted when one falls outside the course's usual `offeringPattern`) is a
   snapshot of `sections`, not a Firestore field: it goes stale until the
   export is re-run.
