# TerrierPlan — Working Queue

Last updated: 2026-08-09

## Now
SEQUENCE_GROUP node type (requirementsEngine.js) — new node type for
"choose one bundle from several multi-course sequences." Resolves 6 of
BMB's 8 UNRESOLVED nodes (Gen Chem, Organic Chem, Physics sequences,
Advanced Lab bundle options).

## Ideas — not scoped yet
- Make it easier to see what a course actually is (not just the course
  number) somewhere in the UI — chips/cards feel vague.
- "Tracks" — something about tracks/specializations, not yet defined
  what this means concretely.
- Should locked/completed courses carry across a user's multiple plans,
  or stay per-plan only? (currently per-plan only)
- Collapse a year row into a compact summary (e.g. "Year 1 — 8 courses,
  32 credits") instead of always showing full columns.
- maybe label things planned v current v complete or color code them?
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
- full page for degree completion checking. more robust.
- draw happy rhett for when reqs are complete
- integrate the "when courses are held" script on my Mac.

## Recently done
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
- BMB BA authored as second major (8 UNRESOLVED nodes remain — see queue)
- CS BA Group D range browsing