# TerrierPlan — Project Handoff Summary

_Last rewritten from scratch by reading the actual source (not prior notes) on 2026-08-07, right after the big merge that brought in transcript import, external credits, extra terms, dark mode, the favicon overhaul, and the disclaimer. Every claim below was checked against code, not assumed from commit messages or the previous version of this file._

## What it is

A degree planning, HUB (BU's gen-ed) tracking, and (eventually) course scheduling web app for Boston University students. Not affiliated with or endorsed by BU — an independent, community-made tool built with AI assistance.

Repo: https://github.com/BU-owo/TerrierPlan
Live: https://terrierplan.web.app/

**⚠️ `main` auto-deploys to the live site on every push** (see CI/CD below). There is no staging environment and no manual approval step — a bad push is live immediately.

## Stack

- Vite + React 19 (JavaScript, not TypeScript)
- Firebase Auth — Google Sign-In only in the actual UI (`LoginPage.jsx` renders just one button). The old handoff claimed email/password was also enabled; that may be true in the Firebase Console's auth provider settings, but nothing in the app UI exposes it.
- Firestore (Blaze/pay-as-you-go plan)
- Firebase Hosting, `dist/` as public dir, SPA rewrite-all-to-`index.html`
- `react-router-dom` v7 with `BrowserRouter` (`/login`, `/planner`, everything else redirects to `/planner`)
- `@dnd-kit/core` for all drag-and-drop (semester board **and** dragging search results straight onto a semester column)
- `pdfjs-dist` (new) — client-side PDF parsing for the transcript importer, runs entirely in the browser, nothing uploaded to a server
- CI/CD: GitHub Actions, two workflows in `.github/workflows/` — one deploys `main` pushes straight to the live Hosting channel, the other builds a PR preview channel. Both run `npm ci && npm run build` with the six `VITE_FIREBASE_*` values injected from GitHub repo secrets.

## Firestore data model

`SCHEMA.md` at the repo root is still the intended source of truth, and it's mostly accurate — but I found one real gap in it (external credit `type`, below), so treat this section as the corrected version.

### `courses/{courseKey}` — reference data, ~8,939 docs
`courseNumber`, `name`, `prerequisites` (raw text), `description`, `hubUnits` (string array like `["SI1","CRI"]`), `lastScraped`. Publicly readable, write-locked to admin SDK only (`firestore.rules`: `allow write: if false`).

### `sections/{term}_{classNbr}` — reference data, ~15,326 docs
Per-term section snapshot: `courseKey`, `term`, `credits`, `instructors[]`, enrollment/status fields, `notes` (free text). Imported once per term, not live. Publicly readable, same write lock as `courses`.

### `bulletinPages/{majorSlug}`
Legacy, effectively orphaned — the app's actual major/minor browser (`BulletinPanel.jsx`) is driven entirely by the static `src/data/bu-programs.js` list + a live iframe of the real bulletin page, not by this collection. Safe to ignore or delete.

### `users/{uid}/plans/{planId}` — verified directly against `PlannerPage.jsx`'s read/write functions (`createDefaultPlan`, `loadPlan`, `persistPlan`, `migrateGuestPlan`), not just SCHEMA.md

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `major` | string | Free text, unvalidated |
| `semesters` | `courseKey[][]` | Fixed length 8 (Fall/Spring × 4 years) |
| `isTransfer` | boolean | Switches which HUB requirement table applies |
| `extraTerms` | object[] | Summer/Winter/overflow terms — see below |
| `externalCredits` | object[] | AP/IB/transfer credit — see below |
| `cumulativeGpa` | number \| null | Scraped from transcript footer. **No UI displays this anywhere** except a one-line summary inside the import modal's review step — there is no persistent GPA display in the planner itself. |
| `earnedCredits` | number \| null | Same as above — captured, stored, never shown outside the import modal |
| `gradePoints` | number \| null | Same |
| `createdAt`, `updatedAt` | timestamp | |

#### `extraTerms[]` entry
`{ term: "Summer 2021", season: 'summer'|'winter'|'fall'|'spring', courseKeys: string[], isPostDegree?: boolean }`. These count toward HUB and credit totals but stay outside the 8-slot grid — rendered by `ExtraTermsPanel.jsx` below the semester board. `isPostDegree` fall/spring overflow terms (more than 8 semesters, or after a detected "degree awarded" line) also land here rather than being dropped.

#### `externalCredits[]` entry — **SCHEMA.md is wrong here, this is the one thing I'd fix in that file**
SCHEMA.md documents `type` as `'ap' | 'transfer'`. The actual code (`normalizeExternalCredit` in `src/utils/externalCredits.js`, plus `getIbHub`/`isApScoreDependent` in `src/data/apIbHubCredit.js`, plus every check in `HubSidebar.jsx` and `ExternalCreditsPanel.jsx`) treats `'ib'` as a fully first-class third type alongside `'ap'` and `'transfer'`. **However** — and this is a real gap, not just a doc omission — grep confirms `type: 'ib'` is never actually *assigned* anywhere in the codebase. The transcript parser (`transcriptParser.js`) only recognizes `TEST CREDIT` / `ADVANCED PLACEMENT` transcript sections and always produces AP-shaped entries; there is no `INTERNATIONAL BACCALAUREATE` detection at all, and `transcriptMapping.js`'s `applyImport` hardcodes `type: 'ap'` for every test-credit row it creates. So **IB HUB lookup logic exists and works if you hand it an `'ib'`-typed credit, but nothing in the app can currently produce one** — real IB credit on a transcript will either fail to parse or get mis-tagged as AP. There's also no manual "add an external credit" UI at all; the only way credits get into this array is via transcript import.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `ec_<uuid>` or a timestamp-based fallback, generated client-side |
| `type` | `'ap' \| 'ib' \| 'transfer'` | See above — `'ib'` is modeled but unreachable |
| `sourceTitle` | string | Title as printed on transcript |
| `courseKey` | string \| null | BU equivalent; `null` until mapped (transfer only) |
| `credits` | number | |
| `institution` | string? | Transfer only |
| `testSubject` | string? | AP/IB only |
| `score` | number? | AP/IB score if printed/entered |
| `isHigherLevel` | boolean? | IB only — modeled in `getIbHub`, never set anywhere for the same reason as above |
| `status` | string? | `'needs_mapping'` / `'mapped'` (transfer), or `'needs_review'` / `'auto_hub_resolved'` / `'manual_hub_confirmed'` / `'no_hub_confirmed'` (AP score/HUB resolution states) |
| `manualHubUnits` | string[]? | Manual HUB override when automatic AP/IB lookup can't resolve one; `[]` explicitly confirms "no HUB" |

BU policy, hardcoded as a comment in `apIbHubCredit.js` straight from BU's Advanced Credit Guide: **transfer credit never earns HUB, full stop**, even if it's equated to a BU course that normally carries HUB units. `HubSidebar.jsx`'s HUB-counting logic correctly skips `type === 'transfer'` entirely — verified, this is not a bug, it's intentional and matches BU policy.

### `users/{uid}/schedules/{scheduleId}`
Unchanged, still completely unused — the scheduler feature doesn't exist yet.

## Firestore rules (`firestore.rules`)
`courses`/`sections`/`bulletinPages` — public read, no client write. `users/{uid}` and its `plans`/`schedules` subcollections — owner-only read/write (`request.auth.uid == userId`). No changes here since the last handoff.

## Features — built and verified working (by reading the actual component code)

- **Degree Planner** (`/planner`): drag courses into an 8-semester grid, now laid out as **Year 1–4 rows with Fall/Spring side by side** (`SemesterBoard.jsx` renders a `year-row` per year) — the year-based grid layout that was on the wishlist in the old handoff is done.
- **Drag-and-drop from search results directly onto a semester column now works.** `CourseSearch.jsx`'s result cards are draggable (`data: { from: 'search', courseKey, course }`), and `PlannerPage.jsx`'s `handleDragEnd` checks `active.data.current?.from === 'search'` and routes it through `handleAddCourse`. The old handoff's "known bug: drag from search not working, only click-to-add" is resolved.
- **Course search**: client-side substring match over the whole `courses` collection loaded once into memory (unchanged approach), **plus a new multi-select HUB-unit filter** (`HubFilterSelect` in `CourseSearch.jsx`) that ORs together any combination of the 21 HUB codes.
- **HUB Tracker sidebar**: progress against `HUB_REQUIREMENTS.md`'s two tables, first-year/transfer toggle, now also folds in AP/IB external credit (via `getApHub`/`getIbHub`) into the same unit-count map used for course-based HUB units, correctly excluding transfer credit.
- **Bulletin browser**: unchanged — school → major/minor picker from `bu-programs.js` → live iframe embed with an always-visible "open in new tab" fallback.
- **Transcript import** (new, `ImportTranscriptModal.jsx` + `transcriptParser.js` + `transcriptMapping.js`): drop in an unofficial BU transcript PDF, parsed **entirely client-side** with `pdfjs-dist` using word bounding-box positions (not naive text extraction, which would interleave BU's two-column layout wrong). Three distinct sub-parsers: regular Fall/Spring/Summer/Winter term courses, `TEST CREDIT`/`ADVANCED PLACEMENT` blocks, and `TRANSFER CREDIT` blocks (with institution-header detection). A 3-step review UI (Upload → Review → Confirm) lets you resolve conflicts against courses already in your plan (skip/replace/keep-both), fill in AP scores for score-dependent exams, map transfer credits to BU equivalents (or explicitly save them as incomplete for later), and shows cumulative GPA/earned credits/points if found on the transcript footer.
- **External credit management**: once imported, `ExternalCreditsPanel.jsx` lets you edit AP scores, fill in transfer BU-equivalents, and manually confirm/override HUB units for exams the automatic lookup couldn't resolve — all post-import editing, no "add new" flow.
- **Extra/summer terms**: `ExtraTermsPanel.jsx` shows summer/winter/overflow-semester courses outside the main grid, remove-only (no manual add UI — populated by transcript import).
- **Dark mode** (new, self-described in its commit as "half implemented" — see Known Issues): a theme toggle button in the header and on the login page, persisted to `localStorage['terrierplan_theme']`, driven by `html[data-theme]` CSS variable overrides in `index.css`.
- **Disclaimer footer**: done. Shown on `/login` (and anywhere that isn't `/planner`, via `AppRoutes`'s `isPlanner` check), reads: *"Not affiliated with or endorsed by Boston University. This is an independent, community-made tool built with AI assistance. Data is sourced from BU's official catalog and website. Use at your own discretion."*
- **Mobile-responsive layout**: bottom tab bar (Search/Planner/HUB) switches between single-panel views under ~860px, swipeable one-card-at-a-time semester columns, touch-sized tap targets. (This was built in the same session as this doc — see the mobile-friendliness work earlier in git history.)
- **Guest browsing** with `localStorage` fallback (`terrierplan_session` key) and migration-to-Firestore on sign-in, including the extended `extraTerms`/`externalCredits`/GPA fields — verified in `migrateGuestPlan`.
- **Social link previews**: Open Graph + Twitter Card meta tags (what "embed thing for discord" actually did — see below).
- Firebase Hosting + GitHub Actions auto-deploy, **now actually wired with the Firebase env vars** (see "yml something?" below) — before that commit the CI build would have shipped with undefined Firebase config.

## What the two unclear commit messages actually did

**"yml something?" (`2ac6f6d`)** — edited both `.github/workflows/firebase-hosting-*.yml` files to inject the six `VITE_FIREBASE_*` secrets as `env:` vars on the `npm ci && npm run build` step, for both the merge-to-`main` deploy and the PR-preview build. Before this, the CI-built bundle had no Firebase config baked in at all (Vite inlines `import.meta.env.VITE_*` at build time, and nothing was setting those in the runner) — so any deploy through GitHub Actions prior to this commit would have shipped with `undefined` `apiKey`/`projectId`/etc., breaking Auth and Firestore entirely on the live site. This is also incidentally the commit that makes "main auto-deploys to the live site" actually functional and dangerous, since it made the CI deploy produce a *working* build.

**"embed thing for discord" (`2aa42f4`)** — added Open Graph (`og:title`, `og:description`, `og:image`, etc.) and Twitter Card meta tags to `index.html`, plus a plain `<meta name="description">`. Purely for link-preview cards when the URL is shared in Discord/Slack/iMessage/etc. — no functional/app behavior change.

## Known bugs / issues (found by reading code, not by testing the live app — verify these hands-on)

1. **Dark mode coverage is genuinely partial**, matching its own commit message. `planner.css` has only 8 `data-theme='dark'` override rules total (covering modals, search input focus, the HUB year toggle, and side-panel backgrounds). Several newer transcript-import/external-credit elements use hardcoded light-theme hex colors that won't invert — e.g. `.external-credit-row.needs-review` and `.import-incomplete-warning` use a literal `#fff5f4` pink background with `#5c1f1c`/`#8a4a45`/`#b42318`/`#176b3a` text, which will be illegible or look broken against the dark palette's near-black backgrounds.
2. **The mascot images aren't a Terrier.** `public/favicondark.png`, `faviconlight.png`, and `faviconred.png` — used everywhere the app calls it a "mascot" (login page, loading spinner, empty-state illustrations, the header logo) — are actually generic stock clip-art of a checkmark overlapping two paw prints, not an illustration of a dog/terrier. Worth a real asset pass if the BU-mascot branding goal in `copilot-instructions.md` still matters. Minor related nit: the header logo specifically uses `faviconred.png` (a *red* checkmark) against the scarlet-red header background — the checkmark stroke has low contrast there, though the black paw prints still read fine.
3. **Debug logging is left on everywhere in the transcript-import code path, unconditionally, in production.** `DEBUG_IMPORT = true` in `PlannerPage.jsx`, `ImportTranscriptModal.jsx`, and `transcriptMapping.js`; `DEBUG_TRANSCRIPT = true` in `transcriptParser.js`; `DEBUG_EXTERNAL_CREDITS = true` in `ExternalCreditsPanel.jsx`. These aren't gated behind `import.meta.env.DEV` or similar — every user's browser console gets a firehose of `console.log` on every keystroke/save/import. One spot (`TransferExternalCreditRow`'s render and `onChange` in `ExternalCreditsPanel.jsx`) logs unconditionally with no flag check at all. Not a security issue (nothing sensitive, all client-side plan data the user already owns), but it's real console noise and a little bit of a perf/readability cost that looks like leftover debugging from chasing the "sign-in loses guest plan" bug (see the code comment at `PlannerPage.jsx:262-265` about a stale-closure bug that used to eat the last-added course on guest saves — that bug appears fixed now via a dedicated `useEffect`, but the debug scaffolding from hunting it was never removed).
4. **`scripts/import-courses.js` and `scripts/import-sections.js` (no `.cjs`) are stale duplicates using the old `firebase-admin` v11-style API** (`admin.credential.applicationDefault()`, `admin.firestore()`) that will not work with the `firebase-admin: ^14.2.0` pinned in `package.json`. Only the `.cjs` versions were updated to the current API (`applicationDefault()` from `firebase-admin/app`, `getFirestore()` from `firebase-admin/firestore`). Anyone running the wrong one will get confusing auth/API errors. Consider deleting the `.js` versions entirely — they appear to be forgotten leftovers, not an intentional dual format.
5. **`scripts/patch-fyw-wri.cjs`'s run status against production Firestore could not be verified from the repo** (needs live Firestore access, which this audit didn't have). The script is idempotent (`arrayUnion`), safe to re-run if unsure. If it was never run, `FYW` and `WRI` HUB units still cannot be satisfied by any course in the tracker — check a known course doc (e.g. `CASWR120`) for `hubUnits` containing `"FYW"` to confirm.
6. **No manual "add external credit" UI.** If a user's transcript doesn't parse cleanly, or they want to add AP/transfer credit without a transcript at all, there's currently no way to do that — `externalCredits` can only be populated via the import flow, then edited (not created) afterward.
7. `bulletinPages` Firestore collection is orphaned/unused by the current app (the bulletin browser uses static data + an iframe instead) — safe to delete, not currently doing so since nothing depends on it either way.

## Explicitly deferred / not started

- **Scheduler page** (section/time picking, conflict detection, calendar export, etc.) — `users/{uid}/schedules` collection exists in the schema but is completely unused in app code. Full feature wishlist from the original handoff (edit-in-place, live seat availability, blocked-time filters, multiple generated combos, Google Calendar export, custom colors, autosave) — none of it built.
- **HUB course-finder** ("find me a class for my missing HUB unit") — not built. The closest thing is the new HUB-unit filter in course search, which requires the user to already be searching, not a guided "here's what to take" flow.
- **GPA calculation / display** — the *data* is captured (`cumulativeGpa`, `earnedCredits`, `gradePoints`, scraped straight off the transcript footer rather than recomputed) and persisted on the plan doc, but there is still no GPA UI anywhere in the planner itself, only a one-line summary shown transiently inside the import modal's review step. A projected/planned-GPA calculator (for not-yet-taken courses) doesn't exist at all.
- **Degree-requirements engine** (checking a plan against actual major requirements beyond HUB) — deliberately deprioritized per `copilot-instructions.md`; still fully manual via the bulletin browser.
- **Custom domain** — Firebase Hosting default domain (`terrierplan.web.app`) only, no custom domain registered as far as this repo shows.

## Environment/infra gotchas (carried forward, still true as of this rewrite)

- `.env.local` and the Firebase service-account key JSON are both gitignored and must be manually recreated on every new machine; `.env.example` is the template for the former.
- Firebase CLI (`firebase init`) walks **up** the directory tree looking for an existing `firebase.json`/`.firebaserc` — always confirm `pwd` is the actual repo root before running Firebase CLI commands.
- Firestore composite indexes are NOT needed for single-field `orderBy`+`startAt`/`endAt` prefix queries (confirmed still true — `firestore.indexes.json` is empty: `{"indexes": [], "fieldOverrides": []}`).
- `firebase-admin` v12+ API shape: `admin.credential` → `applicationDefault()` directly; `admin.firestore()` → `getFirestore()` from the `firebase-admin/firestore` subpackage; same for `FieldValue`. (This is exactly the distinction that makes the stale `.js` import scripts, above, broken.)
- Firestore Spark (free) plan's 20,000 writes/day quota was exceeded once during the initial bulk course+section import, requiring the upgrade to Blaze (still effectively free at this app's usage level).
- Import/patch scripts in `scripts/` need `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account key file kept **outside** the repo folder.

## User's working style / preferences (carried forward — not something code can verify, so treat as historical context rather than re-confirmed fact)

- Not a professional developer, self-described as "vibe coding," learning through this project.
- Prefers exact commands over vague guidance for terminal/infra work.
- Appreciates proactive warnings before risky actions (secrets, data loss, destructive git operations) — worth being extra careful given `main`'s auto-deploy.
- Wants BU scarlet/cream branding with mascot touches at empty states/loading/success moments, but dense data views (semester board, course tables) should stay clean and scannable first, not overly illustrated. (See Known Issue #2 above — the current "mascot" asset doesn't actually deliver on this yet.)
- Has floated adding a trusted collaborator as an Editor on the same Firebase project (not a separate project).
