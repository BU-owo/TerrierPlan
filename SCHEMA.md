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

**Known gap:** `firestore.rules` has no `match` block for this collection,
so — unlike `courses`/`sections`/`bulletinPages` — it is currently
unreadable from the client (Firestore default-denies unmatched paths).
Nothing in the app reads it yet, so this hasn't broken anything in
practice, but add a public-read rule here (matching `courses`) before
building anything that needs it.

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
| Field | Type |
|---|---|
| displayName | string |
| email | string |
| createdAt | timestamp |

### `users/{uid}/plans/{planId}`
| Field | Type | Notes |
|---|---|---|
| name | string | e.g. "Plan A — CS major" |
| major | string | Free text for now, no schema validation |
| majorBulletinUrl | string \| null | Lookup key into `src/data/requirements/`. Matches the `url` field of a program entry in `bu-programs.js` and the `bulletinUrl` field of a requirements JSON file — set when the user picks a major in the bulletin panel. `major` stays free text for display; this is the only field the requirements engine can key off of. |
| semesters | courseKey[][] | Fixed length 8, one array per semester (Fall/Spring × 4 years) |
| isTransfer | boolean | HUB tracker uses transfer vs first-year requirement table |
| extraTerms | object[] | Summer / Winter / overflow post-degree Fall–Spring terms (see below). These courses **do** count toward HUB and credit totals. |
| externalCredits | object[] | AP / transfer credit from transcript import (see below). **Never** counted in HUB Tracker. |
| cumulativeGpa | number? | Scraped from transcript footer on import (GPA UI not built yet) |
| earnedCredits | number? | Scraped from transcript footer on import |
| gradePoints | number? | Scraped from transcript footer on import |
| requirementOverrides | map | Student-reported waive/substitute exceptions to the major requirements tree (see below). **Never** treated as verified — informational only, no approval workflow. |
| stash | courseKey[] | Saved-for-later courses (the planner's "Paw-tential Courses" tab), kept separate from `semesters`/`extraTerms`. Not counted toward HUB, credits, or requirements — purely a bookmark list. |
| createdAt, updatedAt | timestamp | |

#### `extraTerms[]` entry
| Field | Type | Notes |
|---|---|---|
| term | string | e.g. "Summer 2021" |
| season | string | `'summer'` \| `'winter'` \| `'fall'` \| `'spring'` |
| courseKeys | string[] | BU `courseKey`s |
| isPostDegree | boolean? | True for terms after a listed graduation date / overflow Fall–Spring |

#### `externalCredits[]` entry
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
| type | string | `'waive'` — treat the node as fully satisfied, no evaluation. `'substitute'` — add `courseKey` to the node's pool for this evaluation only. |
| courseKey | string? | `'substitute'` only — the courseKey to try claiming for this node. |
| note | string? | Free-text self-reported justification (e.g. "Approved by advisor 3/2026"). Shown in the UI, never validated. |
| createdAt | string | ISO timestamp, set client-side when the override is created |

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
