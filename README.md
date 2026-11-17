# TerrierPlan

A degree planning, HUB tracking, and class scheduling tool for BU students.

## Setup on a new machine

**Prerequisite:** you need to already be added as a collaborator on the
`terrierplan` Firebase project (Firebase Console → Project Settings →
Users and permissions). If you're not listed there yet, ask the project
owner to add you before continuing — the steps below assume you already
have access.

Every time you clone this repo onto a new machine, you need to redo these steps —
they're intentionally **not** stored in git (they contain credentials or are
machine-specific):

1. **Install dependencies**
   ```
   npm install
   ```

2. **Create your local environment file**
   ```
   cp env.example .env.local
   ```
   Then fill in the real values in `.env.local` from:
   Firebase Console → Project Settings → General → Your apps → Web app config

   (The actual values are also saved in [wherever you keep secrets — e.g. a
   password manager note — fill this in for yourself].)

3. **Run the dev server**
   ```
   npm run dev
   ```
   If the page loads blank with no error, the most common cause is a missing
   or stale `.env.local` — check the browser console (F12) first.

### If you also need to run the import/seed scripts on this machine

The scripts in `scripts/` (`import-courses.cjs`, `import-sections.cjs`,
`patch-fyw-wri.cjs`, etc.) need a Firebase service account key, which is
**also not in git** and must be copied over separately (never store it inside
the repo folder, even gitignored).

```
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your-service-account-key.json"
node scripts/<script-name>.cjs
```

If you don't have the key file on this machine: Firebase Console → Project
Settings → Service Accounts → Generate new private key.

### If you need to deploy Firestore rules/indexes from this machine

```
npx firebase-tools login
npx firebase-tools use --add    # select "terrierplan", alias it "terrierplan"
npx firebase-tools deploy --only firestore:rules
```

### Report a problem (Cloud Function → Discord)

`functions/index.js` has one callable function, `reportIssue` (2nd gen,
Node 22, `us-central1`), used by the "Report a missing course" button in
course search and the feedback / report form (Help modal and the footer's
"Send feedback"). It posts to
a Discord channel through a webhook. It is **not** deployed by the GitHub
workflow; deploy it by hand.

Needs the Blaze plan (2nd gen functions and Secret Manager).

1. **Set the webhook URL as a secret** (once, and again to rotate it). It
   prompts for the value; paste the Discord webhook URL there. Never put it
   in code, `.env*` or any file.
   ```
   npx firebase-tools functions:secrets:set DISCORD_WEBHOOK_URL
   ```
2. **Install and deploy**
   ```
   cd functions && npm install && npm test && cd ..
   npx firebase-tools deploy --only functions:reportIssue
   ```
   After rotating the secret, deploy again so the function picks it up.

Notes:
- The client calls `https://us-central1-<projectId>.cloudfunctions.net/reportIssue`
  (`src/utils/reportIssue.js`). If the region ever changes, change it there too.
- Rate limit: 20 reports per 10 minutes for everyone combined, counted in the
  Firestore doc `rateLimits/reportIssue`. Only the function (Admin SDK) touches
  it; no Firestore rule is needed, and clients can't read or write it.
- Reports carry only category, query, term filter, page path, app version and
  the optional note. The client sends no ID token, and the function stores and
  logs nothing about the sender. Cloud Run's own request logs (Cloud Logging)
  still record caller IP and user agent for their retention period; that is
  platform logging, not something the function writes.
- `VITE_FUNCTIONS_ORIGIN` in `.env.local` points the client at another origin
  (e.g. the Functions emulator). Leave it unset normally.

Run `npx firebase-tools deploy` **from the repo root** — running it from a
parent directory (like your home folder) can accidentally create/use a
`firebase.json` there instead of in the project, which silently breaks
future deploys. Confirm `pwd` shows the repo root before deploying.

## Project structure

- `SCHEMA.md` — Firestore collection schema, source of truth for data shapes
- `HUB_REQUIREMENTS.md` — BU HUB requirement tables (first-year + transfer)
- `.github/copilot-instructions.md` — project conventions and scope boundaries for Copilot
- `scripts/` — one-off Firestore import/patch scripts (see above for credentials)
- `QUEUE.md` — working queue of what's next / recently done
- `To_Do.md` — known bugs, not-yet-built features, and items needing manual verification
- `TERRIERPLAN_HANDOFF.md` — fuller project handoff summary (stack, data model, feature-by-feature status)

## Tech stack

Vite + React, Firebase (Auth + Firestore).

## Credits

- Terrier mascot art (`public/terrier_7.png`, `public/TP2.png`) by Liberty Miller.
