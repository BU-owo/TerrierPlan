# Firestore Schema — BU Degree Planner / Scheduler / HUB Tracker

## Join key

`bu_courses_all.csv` course numbers ("CAS AA114") and `Fall2026Courses.csv`
Subject Area + Catalog Nbr ("CASAA" + "114") both normalize to the same
string when spaces are stripped and uppercased: **"CASAA114"**.

This normalized string (`courseKey`) is the join key between the `courses`
collection and the `sections` collection. It is NOT necessarily the Firestore
document ID for `courses` in all cases — see below.

---

## Collections

### `courses/{courseKey}`
One doc per catalog course. Source: full bulletin scrape (periodic).

| Field | Type | Notes |
|---|---|---|
| courseNumber | string | Original, e.g. "CAS AA114" |
| name | string | |
| prerequisites | string | Raw text, unparsed |
| description | string | |
| hubUnits | string[] | e.g. `["SI1", "CRI"]` — derived from one-hot columns |
| lastScraped | timestamp | |

Note: this CSV has no credit-hours column. Credits come from `sections` —
if a course has no current sections (e.g. not offered this term), credits
will be unknown until you either backfill from a prior term's data or add
a manual override field later.

### `sections/{term}_{classNbr}`
One doc per section per term. Source: manually imported official schedule
file, once per term. Multiple raw CSV rows (duplicate rows per instructor)
collapse into one doc with an `instructors` array.

| Field | Type | Notes |
|---|---|---|
| courseKey | string | Join key back to `courses` |
| term, session | string | |
| subjectArea, catalogNbr, classSection, classNbr | string | |
| instructors | {first, last}[] | Deduplicated |
| credits | number | |
| campus, daysOfWeek, startTime, endTime, facilId | string | |
| meetingStartDate, meetingEndDate | string | |
| capEnrl, waitCap, minEnrl, totEnrl, waitTot | number | |
| enrlStat | string | "Open" / "Closed" |
| classStat, classType, mode | string | |
| notes | string | Free text — linked lecture/discussion info lives here, unstructured |
| finalExam | string | |
| importedAt | timestamp | |

### `bulletinPages/{majorSlug}`
Stored bulletin text per major, for the planner's side panel (manual
requirement-checking, no rules engine yet).

| Field | Type | Notes |
|---|---|---|
| majorName | string | |
| bulletinUrl | string | Source link, for "view original" |
| content | string | Cleaned text/HTML of the requirements page |
| lastFetched | timestamp | |

### `users/{uid}`
| Field | Type |
|---|---|
| displayName | string |
| email | string |
| createdAt | timestamp |

### `users/{uid}/plans/{planId}`
| Field | Type | Notes |
|---|---|---|
| name | string | e.g. "Plan A — CS major" |
| major | string | Free text for now, no schema validation |
| semesters | courseKey[][] | Fixed length 8, one array per semester |
| createdAt, updatedAt | timestamp | |

### `users/{uid}/schedules/{scheduleId}`
| Field | Type | Notes |
|---|---|---|
| name | string | |
| term | string | |
| selectedSectionIds | string[] | References `sections` doc IDs |
| favorited | boolean | |
| createdAt, updatedAt | timestamp | |

---

## Import order

1. Run `import-courses.js` against `bu_courses_all.csv` — populates `courses`.
2. Run `import-sections.js` against the term's official schedule CSV — populates `sections`.
3. Sections reference `courseKey`, so step 1 should generally run first, but the
   scripts don't hard-fail on a missing course doc — a section can exist
   before its course doc if the catalog scrape lags the schedule import.
