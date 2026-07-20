# Copilot Instructions — BU Degree Planner / Scheduler / HUB Tracker

## Stack
- Vite + React frontend
- Firebase Auth for login
- Firestore for all persisted data (no other database)
- Deployed collections/schema are defined in `SCHEMA.md` at the repo root — treat it as the source of truth for field names and shapes. Do not invent new fields or collections without updating that file first.

## Data model summary
- `courses/{courseKey}` — catalog data, HUB units as a `hubUnits` string array (already flattened from one-hot columns, don't re-derive from raw CSV columns in app code)
- `sections/{term}_{classNbr}` — per-term section data, already deduplicated (one doc per section, `instructors` is an array)
- `bulletinPages/{majorSlug}` — stored bulletin text for the planner's side panel; this is DISPLAY ONLY, not parsed into structured requirements
- `users/{uid}/plans/{planId}` — a saved degree plan, `semesters` is a fixed-length array of 8 arrays of `courseKey`s
- `users/{uid}/schedules/{scheduleId}` — a saved schedule, `selectedSectionIds` references `sections` doc IDs

## Explicit non-goals for now (do not build these unless asked)
- No degree-requirements rules engine yet — requirement checking beyond HUB units is manual, via the bulletin panel. Do not add major-specific validation logic.
- No open-seat notifications.
- No live/real-time section data — section data is imported once per term and treated as a snapshot with an `importedAt` timestamp. Don't build polling/websocket infrastructure for this.
- Registration itself is out of scope — this tool never submits registration actions, only plans/schedules for reference.

## Visual style
This should feel fun and BU-branded, not like a generic dashboard — go
playful, not corporate.
- Palette: BU scarlet/red and white/cream as the base, with room for a
  secondary accent color for HUB-unit tags, status badges, etc.
- Mascot: lean into Rhett the Boston Terrier where it makes sense — empty
  states, loading states, success moments (e.g. "all HUB units fulfilled!")
  are good spots for a small illustration or mascot touch. Don't force it
  into every corner of the UI.
- Typography/shape language: rounded corners, friendly (not stiff/corporate)
  UI chrome, warm and encouraging copy tone ("Nice, 3 more HUB units to go!"
  rather than "3 requirements remaining").
- Exception — keep dense, functional views (the scheduler's time grid, big
  course tables, the drag-and-drop semester board) clean and legible first.
  Cute styling shouldn't reduce scanability where users are processing a lot
  of information at once; save the more playful/illustrated treatment for
  headers, empty states, confirmations, and lower-density areas.
- Keep this consistent across pages — a slice built in one prompt should
  visually match a slice built in another. When in doubt, match whatever's
  already been built rather than introducing a new style.

## Conventions
- `courseKey` is always the join key between `courses` and `sections`: subject+catalog number, spaces stripped, uppercased (e.g. "CASAA114"). Use existing normalization helpers rather than re-implementing this.
- Firestore reads/writes for user data always scoped under `users/{uid}/...` — never a top-level `plans` or `schedules` collection.
- Reference data (`courses`, `sections`, `bulletinPages`) is read-only from the client; it's populated by import scripts, not app code.

## Build order (current phase)
1. Degree Planner page (drag courses into 8 semesters, credit totals, HUB auto-tracking, bulletin side panel)
2. HUB Tracker page (reuses HUB data from the Planner)
3. Scheduler rebuild
4. GPA + transcript/AP/IB import
5. Degree-requirements engine (later — do not start on this yet)

When in doubt about a feature's scope, check this file and `SCHEMA.md` before assuming — don't add functionality (real-time updates, requirement validation, notifications) that's explicitly listed as a non-goal above.
