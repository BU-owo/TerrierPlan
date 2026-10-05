# TerrierPlan

## Project
- Degree planner + class scheduler for BU students. React 19 + Vite 6, react-router-dom 7, Firebase 12 (Auth + Firestore), @dnd-kit. Hosted on Firebase Hosting (`dist/`).
- Pages: `src/pages/PlannerPage.jsx` (/planner), `src/pages/SchedulerPage.jsx` (/scheduler). Route wiring in `src/App.jsx` (route paths unverified).
- Data: Firestore `courses`, `sections`, `bulletinPages`, `offeringHistory` (read-only reference, writes only via Admin SDK scripts); per-user `users/{uid}/plans` and `users/{uid}/schedules`. Also `siteStats` and presence docs (rules unverified). Field shapes live in `SCHEMA.md`.
- Course catalog is also served statically from `public/courses.json` (built by `scripts/export-catalog.cjs`, fetched in `src/utils/courseQuery.js`). Guests (signed out) keep drafts in localStorage (`src/utils/draftStorage.js` and the pages); exact guest-to-account flow unverified.
- Commands: `npm run dev`, `npm run build`, `npm run lint`.

## Git and deploys (hard rules)
- `main` auto-deploys to the live site on every push (`.github/workflows/firebase-hosting-merge.yml`). Real users are on it.
- NEVER run `git commit`, `git push`, `git revert`, `git reset`, `git stash` or anything that changes git history or the remote. I commit and push by hand after I've tested. Leave changes uncommitted and tell me which files changed.
- Never touch production Firestore (no scripts that write or delete, no import scripts) unless I explicitly say so for that task.

## How to work
- Read the code first; line numbers I give you are hints only.
- Make the minimum change. Don't refactor, rename, or "improve" unrelated code. Don't touch logic I tell you to leave alone.
- Don't reword UI copy beyond what I ask for. Keep copy short and casual, matching the surrounding text.
- When I say "diagnose only", edit nothing, give file:line evidence and confidence, say what you couldn't verify, sketch the fix in a few sentences, then stop and wait for my go.
- After any change: run lint and build (output to the scratchpad, not the repo). Report new lint errors and warnings.
- End every change with a short diff summary (files, what changed, anything you added that I didn't ask for) and an exact hand-test list.
- Say plainly when something is unverified or you didn't run it. Don't claim a fix works without testing.

## Data safety (users' saved plans and schedules)
- Never remove or overwrite a user's local (guest) data before the Firestore write has succeeded.
- Don't change autosave/flush logic (persistPlan, flushPendingPlanWrite), guest migration, or sign-out handling unless the task is specifically about them.
