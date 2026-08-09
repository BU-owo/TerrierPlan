# TerrierPlan — Working Queue

Last updated: 2026-08-09

## Queued (in order)
1. Standalone Requirements page (was "full page for degree completion
   checking" in backlog below — promoted here). The sidebar tab is
   getting cramped now that it holds two majors, SEQUENCE_GROUP bundles,
   the exception/override modal, range-browsing, and collapsible
   UNRESOLVED groups all at once. Run AFTER SEQUENCE_GROUP lands and is
   committed — building/testing a new page against BMB's current broken
   UNRESOLVED state would mean re-verifying it twice. The engine output
   (evaluateRequirementTree) is UI-agnostic, so this is a new consumer
   of existing data, not a rework of the engine.
   Good opportunity to fold in while building fresh rather than
   retrofitting the sidebar twice:
     - course-name clarity (not just course numbers)
     - planned / current / complete labeling or color coding

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