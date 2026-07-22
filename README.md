# TerrierPlan

A degree planning, HUB tracking, and (eventually) scheduling tool for BU students.

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
   cp .env.example .env.local
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

Run `npx firebase-tools deploy` **from the repo root** — running it from a
parent directory (like your home folder) can accidentally create/use a
`firebase.json` there instead of in the project, which silently breaks
future deploys. Confirm `pwd` shows the repo root before deploying.

## Project structure

- `SCHEMA.md` — Firestore collection schema, source of truth for data shapes
- `HUB_REQUIREMENTS.md` — BU HUB requirement tables (first-year + transfer)
- `.github/copilot-instructions.md` — project conventions and scope boundaries for Copilot
- `scripts/` — one-off Firestore import/patch scripts (see above for credentials)

## Tech stack

Vite + React, Firebase (Auth + Firestore).