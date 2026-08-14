# TerrierPlan — Working Queue

Last updated: 2026-08-14

## Queued (in order)
Nothing queued right now — pick the next item from Ideas or the older
backlog below.

## Ideas — not scoped yet
- "Tracks" — something about tracks/specializations, not yet defined
  what this means concretely.
- Should locked/completed courses carry across a user's multiple plans,
  or stay per-plan only? (currently per-plan only)
- Collapse a year row into a compact summary (e.g. "Year 1 — 8 courses,
  32 credits") instead of always showing full columns.
- separate minors and majors. highlight or identify which are complete.

### Older backlog (pre-dates this queue, from To_Do doc — not urgent)
- GPA UI (data captured, nothing displayed in planner)
- Manual "add external credit" button (currently import-only)
- HUB course-finder ("what class fills my missing HUB unit")
- Scheduler page rebuild (fully unbuilt)
- IB credit import path (blocked on a sample IB transcript)
- Dark mode gaps on a few transcript/external-credit elements
- BulletinPanel removal (once requirements coverage is thorough enough)
- Custom domain
- draw happy rhett for when reqs are complete
- integrate the "when courses are held" script on my Mac.
- a my major thing to lock it or a planning / possibilities /etc mode.

## Recently done
- Standalone full-screen Requirements view (`RequirementsFullView.jsx`,
  opened from the sidebar tab, closed via a button or Escape). Not a
  route — an overlay/mode inside `PlannerPage.jsx` that shares its plan
  state directly instead of duplicating it, mirrored to a `?view=requirements`
  URL param for linkability/back-button support (applied only once plan
  data has actually finished loading, so a refreshed link never flashes
  open over an empty plan). Reuses the same tree-walk/pool/exception logic
  as the compact sidebar via a shared `RequirementTree` component
  (`density="full"` vs `"compact"`), so the two never drift apart. Both
  items planned for the fold-in landed: course names now show inline (not
  just codes), and claimed-but-not-yet-eligible chips get a
  planned-vs-completed distinction (`CourseChip`'s `density="full"` mode,
  driven by a new `lockStatusMap`: locked/transcript-sourced courses read
  as completed, everything else as planned).
- Course offering-frequency data. `scripts/import-offering-data.cjs`
  (idempotent, merge-only — only touches courseKeys that already have a
  `courses` doc) merges historical PeopleSoft schedule data onto each
  course: `offeringPattern` (e.g. "Fall", "Alternating Spring", "Not
  offered in 5 years"), `offeredSeasons`, fall/spring/summer ratios, and
  first/last offered year. Full per-term history goes to a separate
  `offeringHistory/{courseKey}` collection (see SCHEMA.md — this
  collection currently has no Firestore rule and is therefore unreadable
  from the client; nothing reads it yet, but it's a gap to close before
  anything tries to). Surfaced in the app two ways, both purely
  informational (never affects drag-and-drop, HUB counting, or
  requirement evaluation): a season-agnostic badge on search/stash result
  cards ("Rarely offered", "Fall only", "Offered some years" — normal
  patterns like "Fall and Spring" stay unbadged on purpose), and a
  season-mismatch warning directly on a placed course card comparing its
  historical pattern against the semester it's actually sitting in
  (`getOfferingWarning` in `src/utils/offeringPattern.js` — "warning" for
  a likely real mismatch, dismissible "notice" for the softer
  alternating-pattern heads-up).
- "Paw-tential Courses" stash. A save-for-later course list, separate tab
  next to Search (`SearchPanelTabs.jsx`), star/unstash toggle button on
  every search result card, drag-and-drop onto a semester column exactly
  like a live search result. Persisted on the plan doc (`stash:
  courseKey[]`, see SCHEMA.md), survives reload via a courseMap prefetch
  for stashed keys. Deliberately independent of the planner grid — never
  touches `semesters`/`gridSummerTerms` or counts toward HUB/credits.
- SEQUENCE_GROUP node type added to requirementsEngine.js — works both as a
  standalone node (General Chemistry / Organic Chemistry / Physics
  sequences) and as a pool entry inside an existing COUNT (BB401+BB402
  bundles in Advanced Lab Elective and BMB Electives, counting as ONE slot
  regardless of how many courses back it — fixes the exact double-count risk
  the old note flagged). BMB's UNRESOLVED count: 8 → 4. Only "any two of
  BB450/451/452/453" stayed UNRESOLVED as anticipated — a combinatorial
  choose-2-of-4 doesn't fit SEQUENCE_GROUP's fixed-course-list shape without
  enumerating all 6 pairs, which isn't a clean fit. Also surfaced two more
  catalog gaps while verifying course keys live (same pattern as MB 722):
  CH 111 and PY 241/242 don't exist in the `courses` Firestore collection —
  flagged in the JSON, not guessed around. 13 direct-engine test scenarios
  (satisfaction, claim priority/no double-counting, bundle-counts-as-one-
  slot, waive + substitute overrides) all pass. SCHEMA.md updated.
- Round 1: consolidated waive/petition entry point into a single "Report
  an exception" button + node picker, collapsed UNRESOLVED badges into
  one summary row, fixed MB 722 courseKey to CASMB722 — confirmed a real
  catalog gap, neither CASMB722 nor GMSMB722 exists in the `courses`
  Firestore collection (flagged in the JSON rather than guessed further).
  Verified in-browser: substitute flow, waive flow, remove flow, and the
  direct-from-summary shortcut all work.
- Interactive requirements panel (click-to-add from requirement pools)
- "Browse eligible courses" range filter → Search tab
- Lock feature (padlock toggle, transcript auto-lock)
- Optional summer term per year (gridSummerTerms)
- Variable year count ("+ Add Year")
- BMB BA authored as second major (4 UNRESOLVED nodes remain, down from 8
  after SEQUENCE_GROUP above)
- CS BA Group D range browsing