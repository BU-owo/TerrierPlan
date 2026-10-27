# Updating a term's schedule

Three commands: `prepare`, `check`, `apply`. All in `scripts/refresh-term.cjs`.

## 1. Get the two BU files

Both come from the BU reporting site (downloads as `.xls`; `.csv` works too). Export **all** sections for the term, every school.

| Report | File looks like | Used for |
| --- | --- | --- |
| R0032B (class schedule) | `BU_R0032B_SR_CLASS_SCHD_DOWNLD_<n>.xls` | the sections themselves |
| R0010K (class roster) | `BU_R0010K_SR_ROSTER_FROM_LIST_<n>.xls` | `Component` (LEC/DIS/LAB…) per Class Nbr |

Row 1 of each `.xls` is a title row; the script finds the real header itself. Keep the originals in `scheduleclasses/` if you want them in git.

## 2. The commands

```
node scripts/refresh-term.cjs prepare <schedule.xls> <roster.xls>
node scripts/refresh-term.cjs check scheduleclasses/schedule_with_types_<term>.csv
GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json \
  node scripts/refresh-term.cjs apply scheduleclasses/schedule_with_types_<term>.csv
```

`check` also needs `GOOGLE_APPLICATION_CREDENTIALS` (it reads live Firestore, read-only). `check --offline` runs just the local parts and does not unlock `apply`.

**prepare** (offline) turns the two files into `scheduleclasses/schedule_with_types_<season><year>.csv`, e.g. `..._fall2027.csv`: skips the title row, writes meeting dates as MM/DD/YYYY, and joins Component from the roster using `scheduleclasses/merge-section-types.cjs`. If that file already exists it is renamed to `.OLD.csv` first; an existing `.OLD.csv` is renamed to `.OLD-<timestamp>.csv` before that, so nothing is overwritten.

**check** prints PASS/FAIL/INFO lines and exits nonzero on any FAIL. It also lists courses in the CSV that have no entry in `public/courses.json` (informational; `apply` creates them). On a pass it writes `../TerrierPlan-out/refresh-check-<date>.json` with a hash of the CSV.

**apply** refuses unless a passed check matches this exact CSV (change one byte and you must re-check). Then, stopping at the first failure and saying what was already written:
1. back up the term's live `sections` to `../TerrierPlan-out/sections-<term>-backup-<timestamp>.json`
2. `import-sections.cjs` (merge-sets, never deletes)
3. `retire-stale-sections.cjs --apply` (marks live sections missing from the CSV as Cancelled; backup at `../TerrierPlan-out/retire-stale-sections-backup-<term>-<timestamp>.json`. A marker `meta/retireStaleSections<term>` from an earlier run is printed as a warning and overwritten.)
4. `create-courses-from-schedule.cjs --input <csv> --commit` (creates `courses` docs for courses in the CSV that aren't in `public/courses.json`, with `create()`, so it never overwrites; prints "Created N, failed M". "Already exists" is fine; any other failure stops apply here.)
5. `export-catalog.cjs` (rewrites `public/courses.json`)

You must type the term id to start. At the end it prints the git commands. It never runs git; you run them by hand in a clean checkout of `main` (`public/courses.json` + the CSV), because a push to `main` deploys.

If the term is new, also move `CURRENT_TERM` / `CURRENT_TERM_LABEL` in `src/utils/term.js` (that's a normal code change, tested and pushed separately). `export-catalog` reads it.

## 3. What each check means

| Line | Meaning | If it's wrong |
| --- | --- | --- |
| import-sections dry run ran clean | The real importer can parse the CSV and build meetings. "N with a different meeting row than before" is informational. `WARNING … meetings[0] differs` lines mean that section gets no `meetings` array. | Look at the first warnings printed. |
| N sections in CSV | Unique `<term>_<Class Nbr>` ids. Compare to last term; a big drop usually means a partial export. | Re-export from BU. |
| meetings arrays: N (M contain a kind:'exam') | Sections with 2+ weekly patterns, and how many include an exam block. Sudden 0 exams means the Notes parsing found nothing. | Spot-check a few big lectures. |
| non-Cancelled rows with a blank Component | Sections the roster didn't cover. Must be 0. Cancelled rows are allowed to have no Component. | Re-export the roster with every section. |
| N courses in the CSV are missing from public/courses.json | New courses BU added since the catalog was built (first 20 keys shown). Informational. `apply` creates their course docs (name, number and career from the CSV; no HUB, description or prerequisites). | If it's huge, check that your `public/courses.json` is current (pull `main`). |
| live sections NOT in the CSV | Sections in Firestore that BU dropped from this export, with their current `classStat`. `apply` marks all of them Cancelled and passes that count to retire as `--expect`. | Eyeball the list. If it's huge, the CSV is probably partial; don't apply. |

## 4. Rollback

Nothing is deleted anywhere; every write is a merge-set or a `create()` of a new course doc.
- **Bad CSV, not applied yet:** `mv schedule_with_types_<term>.OLD.csv schedule_with_types_<term>.csv` (or `git checkout` it). `apply` will want a fresh `check`.
- **Retire went wrong:** `../TerrierPlan-out/retire-stale-sections-backup-*.json` holds the full docs of everything it touched. Restore `classStat` from it and delete `retiredAt`. If retire ran more than once, use the oldest backup; later ones already hold `Cancelled`.
- **Wrong course docs created:** the keys are printed in step 4's output, and every one has `source: 'schedule-history'` and a `createdAt`. Delete those docs with an Admin SDK script, then re-run `export-catalog`.
- **Import went wrong:** `../TerrierPlan-out/sections-<term>-backup-<timestamp>.json` is `{ docId: data }` for every live section of the term from before the import. Write the fields back from it with an Admin SDK script (write that one carefully; there isn't a generic restore script).
- **courses.json went wrong:** `git checkout public/courses.json`, or revert the commit by hand.

## 5. Known gaps

- **BU drops sections without marking them Cancelled.** They just vanish from the export. That's what retire-stale-sections is for. If you skip it, those sections stay on the live site as Active.
- **BU sometimes labels real lectures `IND`** (Independent Course) in the roster. The pipeline copies the roster's Component as-is, so those sections come through as IND.
- **New course docs are bare.** Courses created in step 4 have no HUB units, description or prerequisites, and the name is BU's abbreviated schedule title. Fill them in with a bulletin scrape and backfill (see `backfill-schedule-history.cjs`).
