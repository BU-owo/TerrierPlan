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
| semesters | courseKey[][] | Fixed length 8, one array per semester (Fall/Spring × 4 years) |
| isTransfer | boolean | HUB tracker uses transfer vs first-year requirement table |
| extraTerms | object[] | Summer / Winter / overflow post-degree Fall–Spring terms (see below). These courses **do** count toward HUB and credit totals. |
| externalCredits | object[] | AP / transfer credit from transcript import (see below). **Never** counted in HUB Tracker. |
| cumulativeGpa | number? | Scraped from transcript footer on import (GPA UI not built yet) |
| earnedCredits | number? | Scraped from transcript footer on import |
| gradePoints | number? | Scraped from transcript footer on import |
| createdAt, updatedAt | timestamp | |

#### `extraTerms[]` entry
| Field | Type | Notes |
|---|---|---|
| term | string | e.g. "Summer 2021" |
| season | string | `'summer'` \| `'winter'` \| `'fall'` \| `'spring'` |
| courseKeys | string[] | BU `courseKey`s |
| isPostDegree | boolean? | True for terms after a listed graduation date / overflow Fall–Spring |

#### `externalCredits[]` entry
| Field | Type | Notes |
|---|---|---|
| type | string | `'ap'` \| `'transfer'` |
| sourceTitle | string | Title as printed on the transcript |
| courseKey | string \| null | BU equivalent; null until user maps a transfer row |
| credits | number | |
| institution | string? | Transfer only |
| testSubject | string? | AP / test credit only |
| score | number? | AP / test score, when printed on transcript |
| status | string? | `'needs_mapping'` for a transfer row awaiting a BU equivalent; `'mapped'` once supplied |
| manualHubUnits | string[]? | Admin/BU-confirmed HUB override for an AP/test entry when automatic lookup is unresolved; `[]` confirms no HUB |

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
