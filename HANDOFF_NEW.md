# TerrierPlan — Project Handoff

Rewritten from code on 2026-10-08 at commit 04f6992.

Anything marked **unverified** was not confirmed by reading code in this repo (live Firestore, the Firebase/GitHub consoles, runtime behavior, and visual checks were not touched or run).

## What it is

A degree planner, HUB (BU gen-ed) tracker, and course scheduler for Boston University students. Independent and community-made; the footer says it is not affiliated with or endorsed by BU (`src/components/GlobalFooter.jsx`).

- Repo: https://github.com/BU-owo/TerrierPlan (`git remote -v`)
- Live: https://terrierplan.web.app/ (`index.html` og:url, `.firebaserc` project `terrierplan`)
- **`main` auto-deploys to the live site on every push** (`.github/workflows/firebase-hosting-merge.yml`, `channelId: live`). No staging, no approval step.
- Routes (`src/App.jsx`, `BrowserRouter`):
  - `/` → `HomePage` (`src/pages/HomePage.jsx`, marketing/feature list, links into the app)
  - `/login` → `LoginPage`
  - `/planner` → `PlannerPage`
  - `/scheduler` → `SchedulerPage`
  - `*` → `<Navigate to="/planner" replace />` (every unknown path lands on the planner, not a 404)
  - Query params: `/planner?view=requirements` and `/planner?view=hub` open full-screen overlays (not routes). `?mockMeetings=1` is dev-only (`src/utils/mockMeetings.js`, gated on `import.meta.env.DEV`).
- App shell (`App.jsx`): auth-loading screen until `onAuthStateChanged` resolves; a one-time "Welcome / beta" modal (`terrierplan_beta_seen`); theme in `terrierplan_theme`, applied as `html[data-theme]`; one `.app-shell` flex column holds the routed page plus `GlobalFooter` on every route.
- Crash handling: `src/startupErrors.js` (imported first in `main.jsx`) plus `src/components/ErrorBoundary.jsx` render a "Something went wrong" screen with Reload and "Reset saved scheduler data and reload" buttons. After `markAppReady()` (auth loaded), uncaught window errors only log. `unhandledrejection` only logs. `vite:preloadError` reloads once per 30 s.

## Stack

- Vite 6 (`^6.0.5`) + React 19 (`^19.1.0`), JavaScript (no TypeScript). `react-router-dom ^7.18.1`.
- Firebase JS SDK `^12.16.0`: Auth (**Google sign-in popup only**: `LoginPage.jsx`, `GuestSignInButton.jsx`; no email/password UI, no domain restriction in code or rules) and Firestore. No Storage, no Functions.
- `@dnd-kit/core ^6.3.1` for all drag and drop.
- `pdfjs-dist ^6.2.108` for client-side transcript parsing (`src/utils/transcriptParser.js`, worker via `?url` import).
- `core-js ^3.50.0`: `main.jsx` imports `core-js/actual/iterator` because pdfjs needs the global `Iterator` (Safari < 18.4).
- **No Cloud Functions.** No `functions/` dir, no `firebase-functions` dep. `firebase.json` configures only `firestore` (rules + indexes) and `hosting` (`public: dist`, SPA rewrite `** → /index.html`, `Cache-Control: no-cache` on `/courses.json`).
- Unused dependencies (no import anywhere in `src/`, `scripts/`, or root `.cjs`): `papaparse`, `@dnd-kit/utilities`.
- Dev deps: eslint 9 (+ react-hooks, react-refresh), `firebase-admin ^14.2.0` and `csv-parse ^7.0.1` (both only used by `scripts/`).
- `package.json` scripts: `dev`, `build`, `lint`, `preview`. **There is no `test` script.** Five `*.test.js` files under `src/utils/` use `node:test`; they run with `node --test src/utils/*.test.js` (27 tests, all pass on Node v24.14.1). The command written in their header, `node --test src/utils/` (directory argument), fails on Node 24.
- Lint (`npm run lint`): 0 errors, 6 warnings, all "unused eslint-disable directive": `scripts/create-courses-from-schedule.cjs:153`, `src/pages/PlannerPage.jsx:529,792,807`, `src/pages/SchedulerPage.jsx:109,2032`. `npm run build` was not run in this pass (no source changed).
- CI/CD: two workflows in `.github/workflows/`. Both run `npm ci && npm run build` with the six `VITE_FIREBASE_*` values from GitHub secrets, then `FirebaseExtended/action-hosting-deploy`. `firebase-hosting-merge.yml` deploys `main` pushes to `live`. `firebase-hosting-pull-request.yml` builds a preview channel for same-repo PRs. Neither runs lint or tests.
- Standalone tooling (not in the Vite build or CI). Node scripts in `scripts/`:
  - `import-courses`, `import-sections`, `import-offering-data`, `import-catalog`, `import-details`, `create-courses-from-schedule`
  - `backfill-schedule-history`, `backfill-meetings`, `build-meetings-plan`
  - `fix-si-so-swap`, `fix-hub-from-audit`, `fix-course-details`, `patch-fyw-wri`
  - `export-catalog`, `audit-catalog`
  - shared logic in `scripts/lib/meetings.cjs`
  - `scheduleclasses/merge-section-types.cjs` joins the roster `Component` column onto a schedule CSV.
- Python (no `requirements.txt` anywhere; they import `requests` and `bs4`): `scrape_bu_courses.py` (root), `scripts/scrape_bu_instructors.py`, `scripts/scrape-missing.py`, `scripts/probe-bulletin.py`, `scripts/swap-si-so-csv.py`. Root tests: `test_hub_map.py`, `test_scrape_text.py` (`python -m unittest`, per their headers; not run).
- `.claude/`: `settings.json` denies `git commit/push/revert/reset` through Bash; `commands/` has `briefing`, `diagnose`, `frame`.

## Firestore data model

Every collection read or written anywhere in `src/` or `scripts/`:

| Collection | Client (`src/`) | Scripts | Rule |
|---|---|---|---|
| `courses/{courseKey}` | read | write (Admin) | public read, no write |
| `sections/{term}_{classNbr}` | read | write (Admin) | public read, no write |
| `offeringHistory/{courseKey}` | read (`CourseInfoPanel.jsx`) | write (Admin) | public read, no write |
| `users/{uid}` | read + write | none | owner only |
| `users/{uid}/plans/{planId}` | read + write + delete | none | owner only |
| `users/{uid}/schedules/{id}` | read + write + delete | none | owner only |
| `siteStats/global` | read + write | none | public read, pinned writes |
| `presence/{sessionId}` | read (count) + write | none | public read, pinned writes |
| `meta/{marker}` | none | write (Admin) | none (default-deny to clients) |
| `bulletinPages/{slug}` | **none** | **none** | public read, no write (rule only) |

### `courses/{courseKey}`

Doc id is the courseKey (subject + catalog number, spaces stripped, uppercased; `src/utils/courseKey.js`). Fields by writer:

- `import-courses.cjs` (from `bu_courses_all.csv`): `courseNumber`, `name`, `prerequisites`, `description`, `hubUnits` (string[]), `lastScraped`. `set` with `merge:true`, no dry-run.
- `import-offering-data.cjs`, and `import-catalog.cjs --update-existing`: `offeringPattern`, `offeredSeasons`, `fallRatio`, `springRatio`, `summerRatio`, `firstOfferedYear`, `lastOfferedYear`, `datasetYearsAvailable`, `offeringDataUpdatedAt`. `import-catalog` also writes `career`, `studyAbroad`, `inScheduleData`, and `scheduleDataCheckedAt` (with `inScheduleData:false`) on docs not in the JSON.
- `import-catalog.cjs --create-new` and `create-courses-from-schedule.cjs`: new docs with `name`, `courseNumber`, `career`, `studyAbroad`, `inScheduleData`, `source:'schedule-history'`, `nameIsAbbreviated:true`, `createdAt`.
- `import-details.cjs`: `name`, `nameIsAbbreviated`, `description`, `prerequisites`, `hubUnits`, `detailsSource:'hub-pages'`, `detailsImportedAt` (only on `source:'schedule-history'` docs).
- `backfill-schedule-history.cjs`: fills empty `hubUnits`/`description`/`prerequisites` on `source:'schedule-history'` docs.
- `fix-si-so-swap`, `fix-hub-from-audit`, `patch-fyw-wri`: `hubUnits` only. `fix-course-details`: fields on four docs (CASIR432, CASIR732, CASEE325, CASWS375).
- The client does not read every field. The static catalog (below) carries only `courseNumber`, `name`, `hubUnits`, `offeringPattern`, `career`, `studyAbroad`, `upcomingSeasons`.

### Static catalog `public/courses.json`

Built by `scripts/export-catalog.cjs` (read-only against Firestore). Compact array sorted by id: `{ id, courseNumber, name, hubUnits, offeringPattern, career, studyAbroad, upcomingSeasons }`, with null/false/empty fields omitted. 16,399 entries at HEAD (424 with `upcomingSeasons`, 2,874 with `hubUnits`). `upcomingSeasons` is a snapshot of `sections` at export time, so it goes stale until re-exported.

`src/utils/courseQuery.js` `loadAllCourses()` fetches `/courses.json` once per session and falls back to `getDocs(collection('courses'))` if that fails. The catalog download is gated (`requestCatalogLoad`) until a plan is showing or the user searches.

Reads still done straight from Firestore:
- `courseMap` in the planner (`fetchCourseData`, `where(documentId(),'in',…)` in chunks of 30)
- `CourseInfoPanel` (`getDoc(courses/{key})`)
- the transcript key resolver (`resolveCourseKeys`)
- `lookupCourses` in the scheduler (catalog first, Firestore for misses)

Consequence: HUB counting (`useHubProgress`) uses Firestore `hubUnits` via `courseMap`, while search and `HubFullView` use the static catalog's `hubUnits`. They agree only if the catalog was exported after the last Firestore hub fix. Whether the Firestore SI/SO swap was applied is **unverified** (see Unverified).

### `offeringHistory/{courseKey}`

`{ history: [{ term, year, season, sectionCount }], updatedAt }`, written by `import-offering-data.cjs` and `import-catalog.cjs`. Read by `CourseInfoPanel.jsx` (`fetchOfferingHistory`; past-offerings grid, ignores years before 2020).

### `sections/{term}_{classNbr}`

Written by `scripts/import-sections.cjs` (`set` merge; the default run writes, `--dry-run` doesn't). Fields: `term`, `session`, `subjectArea`, `catalogNbr`, `classSection`, `classNbr`, `description`, `credits`, `campus`, `daysOfWeek`, `startTime`, `endTime`, `facilId`, `meetingStartDate`, `meetingEndDate`, `capEnrl`, `waitCap`, `minEnrl`, `totEnrl`, `waitTot`, `acadGroup`, `enrlStat`, `classStat`, `classType`, `component`, `componentLabel`, `mode`, `notes`, `finalExam`, `instructors[{first,last}]`, `courseKey`, `importedAt`, optional `meetings[]`.

- `meetings[]` entries: `{ daysOfWeek, startTime, endTime, facilId, meetingStartDate, meetingEndDate, kind: 'class'|'exam' }`. Written only for undergrad sections (not OTPMS/MED/LAW) with 2+ distinct recurring weekly patterns. Built by `scripts/lib/meetings.cjs`; `meetings[0]` must equal the top-level meeting fields. `import-sections` and `backfill-meetings.cjs` both write it.
- `kind:'exam'` means a recurring weekly exam block: a `NO ROOM` pattern, a pattern that is `NO ROOM` on a sibling section, or a single evening day with exam/midterm in the section notes. `ENGEK125` Fri 4:30–6:15 PM is forced to exam; `2271_10107` is forced to class.
- `finalExam` is stored (Spring 2027 CSV values: `No` 20,404 rows, `Yes` 3,546, blank 1,080, `Last Class Meeting` 1) but **nothing in `src/` reads it**.
- Seat fields (`capEnrl`, `totEnrl`, `enrlStat`, `waitCap`, `waitTot`) are an import snapshot, not live.
- Terms: `CURRENT_TERM = '2271'` (Spring 2027), `CURRENT_TERM_LABEL = 'Spring 2027'` in `src/utils/term.js`. Source files at HEAD: `Fall2026Courses.csv` (term 2268, 15,326 unique sections, no `Component` column), `scheduleclasses/schedule_with_types.csv` (2268, 15,607), `scheduleclasses/schedule_with_types_spring2027.csv` (2271, 15,050, has `Component`). Which of these are in live Firestore is **unverified**.

### `meta/{marker}`

Marker docs written only by one-shot Admin scripts so a second `--apply` refuses to run: `hubSiSoSwap`, `hubAuditFix`, `meetingsBackfill`, `courseDetailsFixOct8`, `scheduleHistoryBackfill`. No client code or rule touches `meta`.

### `bulletinPages/{majorSlug}`

Nothing reads or writes it (only `firestore.rules` and docs mention it). The major picker uses `src/data/bu-programs.js`.

### `users/{uid}` (the account/profile doc)

Client writes exactly three fields with `setDoc(..., {merge:true})` (`persistProfile` in `PlannerPage.jsx`):

| Field | Notes |
|---|---|
| `currentSemesterTarget` | `number` (index into `semesters`) \| `'summer:{year}'` \| `null`. Student-level, shared across plans. |
| `completedCourseKeys` | `courseKey[]`: the global "locked/completed" list, shared across plans. |
| `externalCredits` | `object[]`: AP/IB/transfer credit, student-level (shape below). |

`displayName`, `email`, `createdAt` (listed in `SCHEMA.md`) are never written by any code. Load (`loadUserProfile`): if the account has no `completedCourseKeys` or a guest `terrierplan_profile` exists, they are merged (union of keys and credits; account `currentSemesterTarget` wins) and persisted before the guest copy is removed. If the account has no `externalCredits` field it is backfilled once by `migratePlanExternalCredits` (union of all plan docs' legacy `externalCredits`, deduped by id then by content, with manual overrides winning).

Autosave: debounced 800 ms, `pendingProfileWriteRef` flushed on unmount, `pagehide`, sign-out (`handleSignOut`), and the browser `online` event. Writes are blocked until `profileLoadedForUid` matches the uid.

### `users/{uid}/plans/{planId}`

Fields actually persisted, from `createDefaultPlan`, `persistPlan`, `migrateGuestPlan`, `loadPlan`:

| Field | Written by | Notes |
|---|---|---|
| `name` | create, persist, migrate | Unique per user (`uniquePlanName` appends " 2", " 3"…). |
| `major` | create (`''`), migrate (`guestPlan.major \|\| ''`) | **Never updated after creation, never read** (`loadPlan` ignores it). Dead field. The live field is `majorBulletinUrl`. |
| `majorBulletinUrl` | create, persist, migrate | `string \| null`; matches a `url` in `bu-programs.js` and a requirements JSON's `bulletinUrl`. |
| `semesters` | create, persist, migrate | **Object keyed by slot index** (`semestersToFirestore`; Firestore forbids nested arrays). Read tolerates an array. Length `max(8, maxKey+1)`. "+ Add Year" appends a Fall/Spring pair, capped at `MAX_PLAN_YEARS = 8` (16 slots). Entries below. |
| `gridSummerTerms` | create, persist, migrate | `{ [yearIndex]: entry[] }`; key presence (even `[]`) means that year's optional Summer column is on. |
| `isTransfer` | create, persist, migrate | Switches the HUB requirement table (first-year vs transfer). |
| `extraTerms` | create, persist, migrate | `{ term, season: 'summer'\|'winter'\|'fall'\|'spring', courseKeys[], isPostDegree? }[]`; populated only by transcript import. |
| `cumulativeGpa`, `earnedCredits`, `gradePoints` | create, persist, migrate | `number \| null`, from the transcript footer. No persistent UI shows them. |
| `requirementOverrides` | create, persist, migrate | `{ [nodeId]: { type: 'waive'\|'substitute', courseKey?, note?, createdAt (ISO string) } }`. |
| `stash` | create, persist, migrate | `courseKey[]`, the "Paw-tential Courses" list. |
| `externalCredits` | **migrate only** | Written once on guest migration as a legacy backup so `loadUserProfile` can lift it into the profile. `persistPlan` (`updateDoc`) never writes or clears it; `loadPlan` never reads it. |
| `createdAt`, `updatedAt` | create/migrate; `updatedAt` on every persist | `serverTimestamp()`. |

Entry kinds inside `semesters` and `gridSummerTerms` (`src/utils/courseEntry.js`, normalized on read):
- Course: `{ courseKey, locked, source: 'manual'\|'transcript' }`. `locked`/`source` are legacy: actual locked state comes from `users/{uid}.completedCourseKeys`. Old docs may hold a bare courseKey string.
- Placeholder: `{ kind: 'note', id, text, credits }` (default 4 credits; shown as "Placeholder"). No courseKey. It counts toward credit totals only, never HUB, requirements, offering warnings, or locking.

`extraTerms` and `stash` hold bare courseKeys.

Plan autosave (signed-in): debounced 1500 ms; `pendingPlanWriteRef` captures uid, planId, and data at edit time, and `flushPendingPlanWrite` writes it on plan switch, unmount, `pagehide`, leave-confirm, and `online`. A save for a different uid than the current user is dropped, not written. `persistPlan` does an extra `getDoc` read-back after every successful write; the result is only used for dev debug logging (`PlannerPage.jsx` ~1359).

Guest storage (`localStorage`): `terrierplan_session` (plan blob: `name`, `major`, `majorBulletinUrl`, `semesters` (array), `gridSummerTerms`, `isTransfer`, `extraTerms`, `cumulativeGpa`, `earnedCredits`, `gradePoints`, `requirementOverrides`, `stash`, `updatedAt` ISO) and `terrierplan_profile` (`currentSemesterTarget`, `completedCourseKeys`, `externalCredits`). Guests have exactly one plan; the plan switcher (`PlanSelector`) renders only when signed in.

Guest→account migration (`migrateGuestPlanIfNeeded`): a blank guest plan is discarded without migrating; otherwise it claims `terrierplan_planner_plan_migrating` (60 s TTL), `addDoc`s a new plan (never overwrites), and removes `terrierplan_session` only after the write succeeds (on failure it stays for retry). Profile: persisted before `terrierplan_profile` is removed. Sign-out resets all plan state to defaults and reloads the guest blob.

### `externalCredits[]` entry (on `users/{uid}`)

Normalized by `normalizeExternalCredit` (`src/utils/externalCredits.js`, which spreads unknown fields through). Fields:

| Field | Notes |
|---|---|
| `id` | `ec_<uuid>`; the dedupe/update key. |
| `type` | `'ap' \| 'ib' \| 'transfer'`. |
| `sourceTitle` | Transcript title, or `"AP <Subject>"` / `"IB <Subject>"` for manual exams. |
| `courseKey` | `string \| null`. A multi-course auto-resolution (e.g. Calc BC) is stored **joined with `+`** (`"A+B"`, `resolveCourseKeyForEntry` in `ExternalCreditsPanel.jsx`). No persisted `courses` array exists. |
| `credits` | number. |
| `institution` | transfer only. |
| `testSubject`, `score` | AP/IB. `score` is set for AP only. |
| `isHigherLevel` | IB manual entries set `true`. |
| `status` | transfer: `'needs_mapping' \| 'mapped' \| 'no_equivalent'`. AP/IB: `'needs_review' \| 'auto_hub_resolved' \| 'manual_hub_confirmed' \| 'no_hub_confirmed'`. |
| `manualHubUnits` | `string[]`; `[]` confirms "no HUB". |
| `manualCourseKey` / `manualCourses` | Student override when auto-resolution had no confident course; mutually exclusive (`manualCourses` wins). |
| `advisorNote` | `string \| null`, free text (transfer notes capped at 200 chars). |

Creation paths:
- **AP/IB manual checklist** (`ExternalCreditChecklistForm`, `+ Add External Credit` → "AP / IB"): creates `type:'ap'` and `type:'ib'` entries; IB records no score, HL only.
- **Manual transfer form** (`TransferCreditForm`, same button → "Transfer"): school, course title, credits (0.5–16, steps of 0.5), optional BU equivalent picked from the catalog, a "No BU equivalent" checkbox, and an optional note. Duplicate school+title is rejected. Existing transfer rows can be edited.
- **Transcript import** (`transcriptMapping.js` `applyImport`): `type:'ap'` for every test-credit row (hardcoded), `type:'transfer'` for transfer rows. Imported transfer rows are matched against existing ones by school+title+credits so manual entries survive an import.
- **`'ib'` is manual-only.** `transcriptParser.js` and `transcriptMapping.js` contain no IB detection (`transcriptParser.js` is unchanged since 60feb10; `transcriptMapping.js` changed only in `f76b022`, the transfer-matching work).

Transfer credit never earns HUB (`useHubProgress.js` skips anything but `ap`/`ib`; policy comment in `src/data/apIbHubCredit.js`). Credit totals (`PlannerPage` `externalCreditTotal`): AP/IB always count; transfer counts only once mapped to a BU course or marked `no_equivalent`.

### `users/{uid}/schedules/{scheduleId}`

`{ name, term, selectedSectionIds: string[], favorited: boolean, createdAt, updatedAt }`. `term` is the term of the sections (falls back to the section-id prefix, then `CURRENT_TERM`; `scheduleTerm()` in `term.js`). **No lock state is saved**; loading a schedule restores picks as unlocked. Guests keep the same shape (with ids `local-…`, ISO timestamps) in `terrierplan_scheduler_schedules`, and migration to the account is one schedule at a time with a claim key, shrinking the local list as each write lands.

### `siteStats/global` and `presence/{sessionId}`

`src/hooks/useSiteStats.js`, mounted once in `GlobalFooter` and written **from the browser**:
- `siteStats/global.totalUsersEver` (number): a client transaction creates it at `1` or increments by exactly `+1`, once per browser, gated by `localStorage.terrierplan_visitor_id`.
- `presence/{id}` where `id` is the signed-in uid or the visitor id (so one doc per signed-in user or browser, **not per tab**): `{ lastSeen: serverTimestamp(), expiresAt: now + 10 min }`, refreshed every 30 s. "Online now" = `getCountFromServer` of docs with `lastSeen` in the last 2 min, polled every 45 s. The footer shows `N Terriers · M online now` only once both numbers have loaded.
- **No TTL policy is referenced anywhere in the repo**: `expiresAt` is written for one, but `firestore.indexes.json` has empty `fieldOverrides` and no script or config sets it. Stale `presence` docs accumulate unless a TTL was set in the console (**unverified**).
- Both counters are client-trusted by design.

### Other browser storage keys

- `terrierplan_theme`
- `terrierplan_beta_seen`
- `terrierplan_visitor_id`
- `terrierplan_planner_view` (`detailed` | `overview`)
- `terrierplan_planner_left_collapsed`, `terrierplan_planner_right_collapsed`
- `terrierplan_planner_plan_migrating`
- `terrierplan_scheduler_draft` (guest) and `terrierplan_scheduler_draft_<uid>` (signed-in)
- `terrierplan_scheduler_schedules`, `terrierplan_scheduler_schedules_migrating`
- `terrierplan_scheduler_preview_width`, `terrierplan_scheduler_course_colors`
- `terrierplan_scheduler_guest_banner_dismissed` (sessionStorage)
- `terrierplan_preload_reload_at`

## Firestore rules (`firestore.rules`)

- `courses`, `sections`, `bulletinPages`, `offeringHistory`: `allow read: if true; allow write: if false`.
- `users/{userId}` and its `plans/{planId}` and `schedules/{scheduleId}`: read/write only when `request.auth.uid == userId`. Any other subcollection under `users/{uid}` is default-denied.
- `siteStats/global`: public read; create only with exactly `{totalUsersEver: 1}`; update only with exactly `{totalUsersEver: previous + 1}`; no delete.
- `presence/{sessionId}`: public read; `write` (create/update) allowed to anyone, including signed-out users, for any session id, only if the doc has exactly the keys `lastSeen` and `expiresAt`, both timestamps (any value, not tied to server time).
- No rule for `meta` (admin-only, default-deny).
- Client collections with no rule: **none**. Rules with no use: **`bulletinPages`**.
- `offeringHistory` now has a rule (the previous handoff said it didn't). Whether the **deployed** rules match this file is **unverified**; the README says rules are deployed by hand (`firebase deploy --only firestore:rules`).
- Composite indexes: none needed. Every query is equality-only, a single-field range or order, or `in`. `firestore.indexes.json` is `{"indexes": [], "fieldOverrides": []}`.

## Features

### Planner (`/planner`, `src/pages/PlannerPage.jsx`, ~2,450 lines)

- **Board** (`SemesterBoard.jsx`, `SemesterColumn.jsx`, `CourseCard.jsx`): Year rows with Fall/Spring side by side. "+ Add Year" up to 8 years. Optional per-year Summer column ("+ Add Summer term"). Desktop-only "All semesters" overview (`terrierplan_planner_view`, ≥861 px) with compact cards. Drag between columns; drag from Search or the stash onto a column. Mobile (≤860 px): bottom tab bar Search / Planner / Status, swipeable semester columns.
- **Placeholders** (`NoteCard.jsx`): free-text "Placeholder" entries with credits.
- **Locking / current semester**: a card's lock toggles membership in the global `completedCourseKeys`. A per-semester lock toggle locks or unlocks a whole column. Choosing "I am currently in…" (`currentSemesterTarget`) marks slots past/current/upcoming (`getSemesterStatus`) and one-time auto-locks the newly past slots' courses. New plans are seeded with the currently locked courses at their slots (`handleNewPlan`).
- **Multiple plans** (signed-in): `PlanSelector.jsx` — select, rename, new, delete (confirm modal). "Saving… / Saved / error / offline" badge.
- **Search** (`CourseSearch.jsx`, `SearchPanelTabs.jsx`): client-side over the static catalog; subject-prefix mode; multi-select HUB-unit filter (OR); a requirement "range filter" hook (set by `onBrowseRange`); Law/Dental/Medical results sorted last with a school chip; offering badges; "i" button opens `CourseInfoPanel`.
- **Course info panel** (`CourseInfoPanel.jsx`): one instance shared by search, stash, and placed cards. Shows description, prerequisites, HUB tags, the current-term sections (days/time, instructors, seats snapshot, exam time via `describeExamTime`, section type), credits, and past offerings from `offeringHistory`. It never displays section `notes` and never reads `finalExam`.
- **Paw-tential Courses stash** (`StashPanel.jsx`): `stash` on the plan; star toggle, drag or semester-picker to place; never counts toward HUB, credits, or requirements.
- **Offering data** (`utils/offeringPattern.js`): badges on search/stash cards and a season-mismatch warning on placed cards, using `offeringPattern` and the catalog's `upcomingSeasons` (a real scheduled section silences the warning). Informational only.
- **HUB tracker**:
  - sidebar (`HubSidebar.jsx`, `HubYearToggle.jsx`), counts shared with the full view through `useHubProgress.js`. First-year vs transfer tables are in `utils/hubConstants.js` (21 HUB codes, 6 groups). AP/IB credits fold in; transfer never does.
  - **Full-screen HUB view** (`HubFullView.jsx`, `?view=hub`, opened by the ⤢ button): progress rings per group, a "potential" dashed arc for what the stash would add, and a HUB **course finder** built on `queryCourses` (department prefix autocomplete, include codes with AND/OR, exclude codes, courses already on the plan excluded, stash toggle on results; Law/Dental/Medical courses dropped).
- **Credits panel** (`CreditsPanel.jsx`): totals split into completed/planned using the same lock/semester status as the trackers, plus AP/IB, transfer, no-equivalent, and placeholder credits.
- **Transcript import** (`ImportTranscriptModal.jsx`, `transcriptParser.js`, `transcriptMapping.js`): client-side `pdfjs-dist` using word bounding boxes with left/right column splitting. Parser modes: `terms`, `test`, `transfer`. Three-step Upload → Review → Confirm UI with conflict resolution against the existing plan. Footer GPA/credits are saved to the plan and shown only in the review step. **Not validated against a real transcript in this pass.**
- **External Credit panel** (`ExternalCreditsPanel.jsx`, ~1,530 lines): see the entry shape above. Add/edit/remove AP/IB scores, HUB overrides, course-mapping overrides, advisor notes, and transfer rows. `src/data/apIbHubCredit.js` has AP and IB subject tables with `getApHub/getApCredits/getApCourseInfo/getIbHub/getIbCredits/getIbCourseInfo`.
- **Extra terms** (`ExtraTermsPanel.jsx`): Summer/Winter/overflow terms from import, remove-only.
- **Requirements tab** (`RequirementsBulletinTab.jsx` in `SidePanelTabs.jsx`): just a school → major/minor picker (`MajorPicker.jsx`, `bu-programs.js`) plus an "Open … bulletin ↗" link. No iframe. The old in-app `BulletinPanel.jsx` is deleted.
- **Requirements engine and full view** — see the next section. The sidebar tree no longer renders; the full-screen view is reachable only by URL.
- **Collapsible side panels** (`usePanelCollapse.js`, `PanelCollapseControls.jsx`): left (Search/Stash) and right (HUB/Requirements/Credits) panels collapse to rails on desktop; state in `localStorage`.
- **Guest mode**: planner and scheduler work signed out, saving to `localStorage`. The planner header says "Browsing as guest", and a guest with edits sees a "Your plan is saved locally. Sign in to sync it to the cloud." banner. Signed-in users with unsent edits get a `beforeunload` warning and an in-app leave-confirm modal.
- **Header/footer/help**: shared `AppHeader.jsx` (row 1: brand, `HeaderNav` Home/Planner/Scheduler tabs, "?" help, theme toggle, `UserMenu`; row 2: page toolbar), rendered by each page. `HelpSupportModal.jsx` ("Need a paw?") contains only a `mailto:terrierplan@gmail.com` link and a Discord invite (`https://discord.gg/bostonuniversity`). The email and Discord constants are duplicated in `HelpSupportModal.jsx`, `GlobalFooter.jsx`, `HomePage.jsx` (and the Discord URL in `startupErrors.js`).
- **Dark mode**: toggle in the header and login page; token overrides in `html[data-theme='dark']` (`src/index.css`).

### Degree-requirements engine

- `src/utils/requirementsEngine.js` `evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides)`.
- Node types: `ALL` (container with `children`, or leaf with `courses`), `COUNT`, `REMAINDER` (always evaluated last among siblings), `SEQUENCE_GROUP`, `UNRESOLVED` (never blocks parents).
- Pool entries: plain courseKey, `OR_EQUIVALENT`, `SUBSTITUTE_GROUP`, `COURSE_RANGE`, `COURSE_RANGE_CAP`, `COURSE_LIST`, `SEQUENCE_GROUP`.
- One shared `claimed` set (no double counting). Overrides: `waive` and `substitute` keyed by node `id`.
- Authoring reference: `src/data/requirements/SCHEMA.md`.
- Programs: `src/data/bu-programs.js` lists **187** programs across **10** schools (CAS, QST, ENG, COM, SAR, CFA, CDS, SHA, WHEELOCK, CGS). **2** have a structured JSON, auto-discovered by `import.meta.glob` in `src/components/requirements/programs.js`:
  - `src/data/requirements/cas/computer-science-ba.json` (uses `ALL`, `COUNT`, `SUBSTITUTE_GROUP`, `REMAINDER`, `COURSE_RANGE`, `UNRESOLVED`)
  - `src/data/requirements/cas/biochemistry-molecular-biology-ba.json` (adds `OR_EQUIVALENT`, `SEQUENCE_GROUP`, `COURSE_LIST`)
  - Both have `verifiedBy: null`, `verifiedDate: null`.
- UI: `RequirementTree.jsx` (compact/full density) with `RequirementNodeView`, `CoursePool`, `CourseChip`, `SequenceGroupDetail`, `ExceptionModal`, `PetitionActiveDisplay`. `RequirementsSidebar.jsx` and `RequirementsFullView.jsx` wrap it. **`SidePanelTabs.jsx` no longer renders `RequirementsSidebar`** (it renders `RequirementsBulletinTab`, and ignores the `onOpenFullView` prop `PlannerPage` passes in). The only way to see the tree or the exception flow is `/planner?view=requirements`. The homepage lists "Coming Soon: Major / Minor Requirement Tracking".
- External credits feed the engine through `requirementsCourseKeys`; a multi-course credit stored as `"A+B"` is pushed in unsplit, so it can't match `A` or `B` (no `split('+')` exists in `src/`).

### Scheduler (`/scheduler`, `src/pages/SchedulerPage.jsx`, ~2,470 lines, `src/components/scheduler/*`)

Single-term: every query uses `CURRENT_TERM`. Other terms' saved schedules can be previewed but not edited.

- **Draft** (`draftCourses`): `[{ courseKey, considering: { [componentCode]: sectionId[] }, locked: sectionId[] }]`. Sections come from `sections where courseKey == X and term == CURRENT_TERM`, with `classStat === 'Cancelled'` filtered client-side. Groups are by the raw `component` code (`sectionComponents.js`; LEC first, blank component → "Other"). A group with exactly one option is auto-checked. A `notes` string shared by every section in a group is shown once.
- **Time filter** (`GlobalTimeFilter.jsx`, `sectionFilters.js`): one global filter (same-every-day or per-weekday), presets, no per-course filter. Sections outside it are dimmed. `filterAutoUncheck.js` auto-unchecks failing picks and restores them when the filter loosens, never touching pins or hand-toggled sections.
- **Auto mode generation** (`scheduleCombos.js`): `generateSchedulesAsync`, iterative backtracking that yields to the browser, debounced 300 ms after any draft edit, cancellable. Only "complete" courses are generated (every component group needs a pick or lock); `IncompleteBanner` lists the rest. Caps: `MAX_EXPLORED = 200,000`, `MAX_RESULTS = 2,000`; `truncated` is surfaced. `LargeSelectionBanner` warns when the estimated product (`selectionEstimate.js`) exceeds 200,000. Conflicts use `sectionsConflict` (class meetings only; **exam meetings never conflict**).
- **Locking**: a locked section becomes its own forced single-option slot (`buildGenerationSlots`), and locking clears that group's `considering`. Locks live in the in-memory draft and the localStorage draft, never in a saved schedule.
- **No-schedule diagnosis**: when generation comes back empty (and not truncated), the page re-runs generation with each course dropped and records `noScheduleCulprits`. This logic is **inlined in `SchedulerPage.jsx`**; the exported `diagnoseNoSchedule` in `scheduleCombos.js` is not imported anywhere.
- **Manual mode**: the student places one section per (course, component) by hand (`manualSectionIds`); overlaps allowed. The preview shows an "N overlaps" stepper (`manualOverlapPairs`), and clicking an overlap chip opens `OverlapPopover.jsx` with "Find another time" (opens swap mode). Switching modes keeps both modes' state.
- **Section swap / ghosts** (`WeeklyGrid.jsx`, `SectionSwapSheet.jsx`, `swapReasons.js`): per placed section, a swap button overlays every other section of that course+component as dashed "ghost" blocks, labeled "Not selected" / "Outside time filter". Clicking one swaps it in. A "Show all" ghost layer per group. A **displace flow** walks through sections displaced by a swap one at a time. Mobile uses a bottom sheet.
- **Bookmarks** (`BookmarkedSchedulesPanel.jsx`): content-keyed (`scheduleKey`) shortlist, stepper "All / Bookmarked" modes. **Persisted to `localStorage` with the draft** (not Firestore; they don't follow the user across devices). One click promotes a bookmark to a saved schedule.
- **Saved schedules** (`SavedSchedulesPanel.jsx`): save, rename, favorite, delete, grouped by term (current first). Loading a current-term schedule asks `window.confirm` before replacing the draft. A schedule from another term is shown read-only.
- **Draft autosave** (`utils/draftStorage.js`): `terrierplan_scheduler_draft[_<uid>]`, version 1, term-scoped. Saves courses, time filter, sort mode (`time`|`section`), mode, `manualSectionIds`, bookmarks, and the previewed combination plus stepper index. Debounced 500 ms and flushed on `pagehide`/`visibilitychange`/unmount. Restored on load after revalidating section ids against Firestore. On first sign-in the guest draft is adopted only if the account has none, and the guest key is cleared only after the account write succeeds.
- **Exams and notes**:
  - A section's `meetings[]` can contain `kind:'exam'` entries. They render as a dashed non-interactive overlay on the grid (`WeeklyGrid.jsx`), an "Exam block" chip and "Exam: …" line in `SectionRow.jsx`, and "Exam: …" in `SectionSwapSheet.jsx` and `CourseInfoPanel.jsx`.
  - **There is no final-exam date/time feature and no midterm field.** `finalExam` is imported but never read.
  - Section `notes` (BU free text, sometimes raw/truncated HTML) go through `parseSectionNotes` (`sectionNotes.js`: tags stripped, entities decoded, only http(s) links kept) and render via `SectionNotes.jsx` in `DraftCourseCard.jsx` (group hint) and `SectionRow.jsx`. Notes are not shown in the swap sheet, grid tooltips, or course info panel.
- **Other**: resizable preview pane (`terrierplan_scheduler_preview_width`); 12-slot per-course color palette with manual overrides (`scheduleColors.js`, `terrierplan_scheduler_course_colors`); guest banner; mobile views Search / Build / Preview. Seats in the UI are the import snapshot (`describeSeatStatus`), not live.
- Exported but unused by the app: `generateSchedules` (strict sync search), its `allowOverlaps` ranked-by-overlap path (`generateRankedByOverlap`), `diagnoseNoSchedule`, `isCourseReady`. Overlap handling in the app is only the Manual mode.

### Other

- Homepage (`HomePage.jsx` + `home.css`) with three feature cards using `public/RhettPlan.png`, `RhettCheck.png`, `RhettCal.png` (real Boston-terrier illustrations).
- Open Graph / Twitter Card meta tags in `index.html`.

## Known bugs / issues

Found by reading code unless noted. None were reproduced in a browser.

Carried-over items, re-checked:

1. **Dark mode coverage**: still unverified. Semantic tokens exist in `src/index.css`. Dark-specific selectors: `planner.css` 18, `scheduler.css` 4, `home.css` 1, `App.css` 1, `CourseInfoPanel.css` 1; `AppHeader.css` and `HelpSupportModal.css` have none (may rely on tokens). A panel-by-panel visual check was not done.
2. **Mascot assets**: changed. `public/favicondark.png`, `faviconlight.png`, `faviconred.png` are still the checkmark-plus-paw-prints art (viewed `faviconlight.png`); they remain the login/loading/empty-state/header images (`App.jsx`, `LoginPage.jsx`, `CourseSearch.jsx`, `StashPanel.jsx`, `AppHeader.jsx`). Real terrier art exists (`public/Rhett*.png`) but is used only on `HomePage.jsx`. Contrast of the red check on the red header: not viewed.
3. **Debug logging gating**: fixed and still true. All `[DEBUG …]` helpers (`PlannerPage`, `ImportTranscriptModal`, `ExternalCreditsPanel`, `transcriptParser`, `transcriptMapping`) return early unless `import.meta.env.DEV`; the `persistPlan` logs are inside `if (import.meta.env.DEV)`. Remaining `console.error/warn` calls are normal error logging.
4. **Stale scripts**: partly fixed, partly changed.
   - `scripts/*.js` are gone.
   - A **stale duplicate** `patch-fyw-wri.cjs` sits at the repo root (old `admin.firestore()` style); the maintained copy is `scripts/patch-fyw-wri.cjs`.
   - `scripts/import-courses.cjs` `HUB_COLUMNS` has 19 codes (no `FYW`, `WRI`), and `scrape_bu_courses.py` doesn't scrape them either. Re-running `import-courses` does `set(..., {merge:true})` with a fresh `hubUnits` array, which would replace the array and drop any `FYW`/`WRI` added by `patch-fyw-wri`. It has no dry-run.
5. **`patch-fyw-wri` applied to live Firestore**: unverified (not queried).
6. **Manual external credit**: AP/IB and transfer now both have manual-add UIs. Still open: IB via transcript import (no IB detection, `applyImport` hardcodes `'ap'`).
7. **`bulletinPages`**: still orphaned (rule only, no reads or writes).
8. **`offeringHistory` rule**: fixed in `firestore.rules`; deployment unverified. It is now read by `CourseInfoPanel`.
9. **`presence` cleanup**: still true in code (no TTL referenced; console state unverified).
10. **Client-trusted counters**: still true (`siteStats`, `presence`).

New:

11. **Requirements tree UI is unreachable from the UI** (only `/planner?view=requirements`). `SidePanelTabs.jsx` ignores `onOpenFullView`; the sidebar renders `RequirementsBulletinTab`. See the engine section.
12. **"Reset saved scheduler data and reload" doesn't clear a signed-in user's draft.** `startupErrors.js` `resetDraftAndReload` removes only `terrierplan_scheduler_draft` (the guest key); signed-in drafts are stored under `terrierplan_scheduler_draft_<uid>` (`draftStorage.js` `draftKey`). If a crash is caused by a signed-in user's stored draft, the button won't fix it. Confidence high from code; runtime unverified.
13. **Multi-course external credits don't reach the requirements engine.** The `"A+B"` `courseKey` is pushed into `requirementsCourseKeys` unsplit (`PlannerPage.jsx` ~1996). `manualCourses` entries are split correctly; auto-resolved ones are not. Affects only the requirements tree.
14. **`persistPlan` read-back**: one extra `getDoc` per successful plan save, used only for dev logging (`PlannerPage.jsx` ~1359).
15. **`major` field on plan docs is dead** (written as `''`, never updated or read).
16. **`finalExam` is stored and never read**; there's no final-exam UI.
17. **Unused code and deps**: `papaparse`, `@dnd-kit/utilities`; `generateSchedules`/`allowOverlaps`, `diagnoseNoSchedule` (duplicated inline), `isCourseReady`, and `src/components/planner/RequirementsSidebar.jsx` (not rendered).
18. **Stale term naming**: `CourseInfoPanel.jsx` still has `fetchFall2026`/`fall2026Cache` and comments saying "Fall 2026", but queries `CURRENT_TERM` (`2271`, Spring 2027). `import-catalog.cjs` defaults `--term 2268`.
19. **Test tooling**: no `npm test`; the documented `node --test src/utils/` fails on Node 24. Nothing in CI runs tests or lint.
20. **Repo hygiene**: `.firebase/hosting.ZGlzdA.cache` is tracked (and `.firebase` isn't gitignored). `scripts/courses.json` (~21 MB), `scripts/courses.new.json` (~22 MB), and several large CSVs are tracked.
21. **"Boston University students only"** (`LoginPage.jsx`) is copy only. Any Google account can sign in; no `hd` parameter and no rule checks the email domain.
22. **Env template name**: the file is `env.example` (no leading dot) but `README.md` and `CLAUDE.md` say `.env.example` / `cp .env.example .env.local`.
23. **Static catalog vs Firestore drift risk**: planner HUB counting reads Firestore `hubUnits`; search reads the catalog. See Firestore data model.
24. `LoginPage`/Planner **sign-in popups** need pop-ups allowed; a failure shows an inline message (no fallback to redirect flow).

## Deferred / status of the old wishlist

| Item | Status |
|---|---|
| HUB course-finder | **Exists**: `HubFullView.jsx` (dept prefix, AND/OR include, exclude codes, stash). Not a guided "what's missing" flow. |
| GPA UI | **Not built.** `cumulativeGpa`/`earnedCredits`/`gradePoints` are captured and persisted but shown only in the import modal's review step. No planned-GPA calculator. The homepage says "Coming Soon: GPA calculator". |
| Custom domain | **Not in the repo.** `terrierplan.web.app` everywhere (`index.html`, `.firebaserc`). Console/DNS: unverified. |
| Manual transfer credit | **Exists**: `TransferCreditForm` in `ExternalCreditsPanel.jsx` (add + edit). |
| Calendar export | **Not built** (no `.ics`/calendar code in `src/`). |
| Live seat availability | **Not built.** Seat counts are the import snapshot; `.github/copilot-instructions.md` lists live data as a non-goal. |
| Autosave | **Exists**: planner (signed-in plan 1.5 s debounce, profile 0.8 s debounce, guest immediate `localStorage`) and scheduler draft (`localStorage`, 0.5 s). Saved schedules remain an explicit save. |

Also not built: "Compare multiple plans" (homepage "Coming Soon"), major/minor tracking in the UI (see Known issue 11), more than one major per plan (`majorBulletinUrl` is singular), IB transcript import, final-exam dates, a multi-term scheduler (`CURRENT_TERM` is one constant), onboarding (`QUEUE.md` item), and a signed-in plan comparison.

## Env / infra gotchas

- `.env.local` (gitignored) holds the six `VITE_FIREBASE_*` values; template is **`env.example`** (no dot). A blank page with no error usually means a missing or stale `.env.local` (README).
- Admin scripts need `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account key outside the repo. `export-catalog.cjs` warns if it is inside the repo. They use modular `firebase-admin/app` + `firebase-admin/firestore` imports (admin `^14.2.0`); the stale root `patch-fyw-wri.cjs` uses the legacy `admin.firestore()` style.
- Safety pattern in the one-shot fix/backfill scripts: dry-run by default; `--apply`/`--commit` writes after a backup to **`../TerrierPlan-out/`** (a sibling folder of the repo; it exists locally with `audit/`, `hub-html/`, `course-details-fix-backup.json`, and two meetings backups dated 2026-10-07 and 2026-10-08), sets a `meta/*` marker, and refuses to re-run. Whether those applied to live Firestore is **unverified**.
- Scripts that **write immediately with no dry-run**: `import-courses.cjs`, `import-offering-data.cjs`, `patch-fyw-wri.cjs`. `import-sections.cjs` writes unless `--dry-run` is passed. Read-only: `export-catalog.cjs`, `audit-catalog.cjs`, `build-meetings-plan.cjs`.
- After any change to `courses` or `sections` (or moving `CURRENT_TERM`), re-run `scripts/export-catalog.cjs` and commit the new `public/courses.json`; `upcomingSeasons` is a snapshot. `firebase.json` serves `/courses.json` with `no-cache`.
- Changing terms means changing `CURRENT_TERM`/`CURRENT_TERM_LABEL` in `src/utils/term.js`; `export-catalog.cjs` reads that constant by regex.
- `firestore.indexes.json` is empty; the current queries need no composite index.
- Firestore `in` queries are chunked at 30 (`IN_QUERY_LIMIT`).
- Firebase CLI, run from the repo root (`firebase.json` + `.firebaserc`, project `terrierplan`). README warns `firebase` walks up the tree for an existing `firebase.json`; that is CLI behavior, not checkable from code.
- Billing plan (Spark vs Blaze) and Firestore doc counts: **unverified**. The old "~8,939 courses" matches `bu_courses_all.csv` (8,939 data rows); the Fall 2026 CSV has 15,326 unique sections.
- No Python dependency file; install `requests` and `beautifulsoup4` manually to run the scrapers.
- Browser: pdf.js needs a modern browser; the `core-js` Iterator polyfill covers Safari < 18.4.

## Working style (from `CLAUDE.md`, the only in-repo source)

- `main` auto-deploys. The owner commits and pushes by hand after testing. Do not run `git commit/push/revert/reset/stash` or anything else that changes history or the remote; leave changes uncommitted and list the changed files. (`.claude/settings.json` denies four of these.)
- Never touch production Firestore (no writing or deleting scripts, no imports) unless explicitly told to for that task.
- Read the code first; line numbers from the owner are hints only. Make the minimum change; don't refactor, rename, or reword UI copy beyond the ask; keep copy short and casual.
- "Diagnose only" means no edits: file:line evidence, confidence, what couldn't be verified, a few-sentence fix sketch, then stop and wait.
- After any change: run `npm run lint` and `npm run build` (output outside the repo), report new errors/warnings, end with a diff summary and an exact hand-test list.
- Data safety: never remove or overwrite a user's local guest data before the Firestore write has succeeded. Don't touch autosave/flush (`persistPlan`, `flushPendingPlanWrite`), guest migration, or sign-out handling unless the task is about them.
- Personal-preference notes in the previous handoff (self-described non-professional developer, prefers exact commands, wants scarlet/cream branding with mascot touches at empty/loading/success states, may add a collaborator as Firebase Editor): **unverified**, not derivable from code. The branding intent does appear in `.github/copilot-instructions.md`.

## Discrepancies vs previous handoff

(The previous handoff is `TERRIERPLAN_HANDOFF.md`; `HANDOFF_OLD.md` does not exist in the repo.)

Handoff claims that were wrong or stale:
- Route list: omitted `/` (HomePage); also said everything else redirects to `/planner` without noting the Home route exists.
- "No single shared header component; the help button is duplicated per page": now there is a shared `AppHeader.jsx` (+ `HeaderNav`, `UserMenu`), rendered by each page.
- "Bulletin browser: school → major picker → live iframe embed" and `BulletinPanel.jsx`: deleted; replaced by `RequirementsBulletinTab.jsx` (picker + external link, no iframe).
- "Degree-requirements engine … consumed by both the compact sidebar tab and the full-screen view": the sidebar no longer renders the tree; the full view is reachable only through `?view=requirements`.
- `offeringHistory` "has no Firestore rule" and "unreadable from the client": `firestore.rules` now has a public-read rule, and `CourseInfoPanel.jsx` reads it ("Nothing in the app reads this yet" is also false).
- `externalCredits` was described as an array on the plan doc: it now lives on `users/{uid}` (student-level, shared across plans). Plan docs only carry a legacy copy written by guest migration.
- `externalCredits.courses` ("string[], multi-course auto-resolution") and `manualCourseKey` vs `courses` as a persisted pair: no persisted `courses` field exists; multi-course auto-resolution is stored as one `courseKey` joined with `+`.
- Plan fields listed as a table omitted `gridSummerTerms` and said `semesters` is a "fixed length 8" array: it is an object keyed by slot index, length ≥ 8, growable to 16, plus per-year Summer columns.
- `major` described as a plan field "free text, unvalidated": written once as `''`, never updated or read.
- "Locked" state described nowhere / SCHEMA's per-entry `locked`: locking is global `users/{uid}.completedCourseKeys`, plus `currentSemesterTarget`.
- "Transfer credit still has no manual-add path" (Known issue 6 and Deferred): a manual transfer form exists (`TransferCreditForm`).
- Deferred "HUB course-finder — not built": `HubFullView.jsx` implements it.
- "Autosave of in-progress drafts … a draft resets on reload by design": the scheduler draft autosaves to `localStorage` (`draftStorage.js`), including bookmarks and manual placements; the planner autosaves too.
- "Bookmarking: session-only … never written to Firestore": bookmarks persist in the `localStorage` draft (still never in Firestore).
- Scheduler feature list omitted Manual mode, overlaps stepper/popover, displace flow, "Show all" ghosts, incomplete/large-selection banners, time-filter auto-uncheck, sort modes, multi-meeting and exam-block support, section-notes rendering, other-term schedule preview.
- "Generation … capped (`MAX_EXPLORED`/`MAX_RESULTS`)": values are 200,000 and 2,000; also the diagnostic is inlined in the page, not the exported `diagnoseNoSchedule`.
- "Stale `.js` import scripts" item and the three-script list: gone, but new scripts were added (`import-catalog`, `import-details`, `create-courses-from-schedule`, `backfill-*`, `fix-*`, `build-meetings-plan`, `export-catalog`, `audit-catalog`, `lib/meetings.cjs`, plus Python `scrape-missing`, `probe-bulletin`, `swap-si-so-csv`); a stale duplicate `patch-fyw-wri.cjs` remains at root.
- Stack list omitted `core-js`; "Python scrapers (two)": there are five Python scripts plus two Python test files.
- "`scripts/scrape_bu_instructors.py` … output feeds the existing `scripts/import-*.cjs` importers": no importer reads its CSV.
- "`presence/{sessionId}` … id = uid or visitor id" is right, but SCHEMA's "one doc per active browser tab" is not (see below).
- "Mascot" item: Terrier art now exists (`Rhett*.png`, homepage only); favicons unchanged.
- "Course docs ~8,939": the static catalog now has 16,399 entries including schedule-history-created courses; Firestore count unverified.
- Features list omitted: homepage, `AppHeader`/`UserMenu`, global crash screen (`startupErrors.js`, `ErrorBoundary`), placeholders, all-semesters overview, per-year Summer columns, lock-semester and "I am currently in…", collapsible panels, `CourseInfoPanel`, `HubFullView`, `usePanelCollapse`, `useUpcomingSeasons`, static catalog loading, plan-seeding on new plan.
- "What the two unclear commit messages did" section dropped: it described history, not current state (the CI env-var injection and OG tags are covered under Stack and Features).

`To_Do.md` stale or wrong:
- Lists `offeringHistory` has no Firestore rule as open: the rule exists.
- "Scheduler: no autosave/crash recovery for the in-progress draft … deliberately not persisted anywhere": it autosaves to `localStorage`.
- "live seat availability (`SectionRow.jsx`)": seat counts are an import snapshot, not live.
- "HUB course-finder" listed as not built: `HubFullView.jsx`.
- Requirements engine entry says "compact sidebar tab and full-screen view all exist": the sidebar no longer renders the tree.
- "Manual add external credit UI" entry mentions only AP/IB; a transfer form exists too.
- Mascot item doesn't mention the `Rhett*.png` assets.
- Header says it was built from `TERRIERPLAN_HANDOFF.md` and "re-verified 2026-09-17"; it predates the Oct 2026 planner/scheduler work.
- Doesn't mention: Requirements UI hidden, `resetDraftAndReload` gap, `finalExam` unused, multi-course credit `+` keys, unused deps, missing test script.

`SCHEMA.md` stale or wrong:
- `externalCredits[].type` is listed as `'ap' | 'transfer'`; `'ib'` is missing, along with `isHigherLevel`, `manualCourseKey`, `manualCourses`, `advisorNote`, transfer `status: 'no_equivalent'`, and AP/IB `status` values `needs_review`/`auto_hub_resolved`/`manual_hub_confirmed`/`no_hub_confirmed`. The `courseKey` row doesn't say multi-course is `+`-joined.
- Plan table has no `gridSummerTerms` row; its description lives only inside the `semesters` row.
- `users/{uid}`: `displayName`, `email`, `createdAt` are documented but never written by any code.
- Plan `major` row doesn't say it is dead (never updated).
- `presence`: "One doc per active browser tab" is wrong: the doc id is the uid or visitor id, shared by all tabs of that browser/user.
- `courses` table omits `career`, `studyAbroad`, `inScheduleData`, `scheduleDataCheckedAt`, `source`, `nameIsAbbreviated`, `createdAt`, `detailsSource`, `detailsImportedAt`.
- `sections` table omits `description` and `acadGroup`; `finalExam` has no description and isn't marked unused.
- `meta` collection (marker docs) isn't documented.
- "Import order" still names `import-courses.js` and `import-sections.js` (now `.cjs`) and doesn't cover `import-catalog`, `import-details`, `create-courses-from-schedule`, `backfill-*`, `fix-*`.
- `users/{uid}/schedules` says nothing about guest `local-…` ids or that locks aren't saved.
- Correct and verified: `offeringHistory` access note, `semesters` object-keyed storage, placeholder entries, `completedCourseKeys`/`currentSemesterTarget` on `users/{uid}`, `siteStats`/`presence` field shapes and rules, `meetings` semantics.

Other docs:
- `README.md`: `cp .env.example .env.local` (the file is `env.example`); "(eventually) scheduling" (scheduler is built).
- `CLAUDE.md`: "route paths unverified" (they are `/`, `/login`, `/planner`, `/scheduler`), "siteStats and presence … rules unverified" (rules exist), "exact guest-to-account flow unverified" (documented above).
- `QUEUE.md` (last updated 2026-09-08): still lists "Homepage", "Scheduler page rebuild (fully unbuilt)", "Manual add external credit", "HUB course-finder" as queued; all exist.
- `.github/copilot-instructions.md`: "Scheduler rebuild" and the `bulletinPages` "side panel" description are stale.

## Unverified

- Live Firestore: whether `firestore.rules` as written is the deployed version; document counts (courses, sections, offeringHistory); which terms' sections are imported; whether `meta/*` markers exist; whether the SI/SO swap, HUB audit fix, schedule-history backfill, meetings backfill, and course-details fix were applied to production (local backups exist in `../TerrierPlan-out/`).
- Whether Firestore `courses.hubUnits` match the static catalog's (SI/SO swap commit `94a39ba` was labeled "Firestore not yet fixed" for the catalog; the later state of Firestore wasn't checked).
- Whether a Firestore TTL policy on `presence.expiresAt` was configured in the console.
- Firebase Console settings: enabled auth providers (email/password), authorized domains, billing plan (Spark vs Blaze), service accounts.
- GitHub Actions secrets and whether the last deploy of HEAD succeeded.
- Any runtime behavior: nothing was run in a browser. This includes the guest↔account migration, autosave/flush ordering, `?view=requirements` and `?view=hub` deep links, the scheduler restore/adoption flow, drag and drop, the mobile layouts, and the transcript parser against a real BU transcript.
- Dark mode correctness panel by panel; header-logo contrast.
- The meaning of `finalExam` values (`Yes`/`No`/blank/`Last Class Meeting`); assumed to be a has-final flag, never read by the app.
- Python scrapers and their tests (`test_hub_map.py`, `test_scrape_text.py`): not run. `npm run build` was not run.
- That `public/courses.json`'s `upcomingSeasons` matches current Firestore `sections`.
- Personal working-style claims in the previous handoff (see Working style).
- Custom-domain status outside the repo (DNS/Hosting console).
