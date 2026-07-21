# HUB Requirements — Corrected Spec

Source: bu.edu/hub (fetched live). Replace whatever logic currently
exists in `hubConstants.js` with this.

## Known data gap — fix first
The `courses` collection's `hubUnits` field is derived from the CSV's
one-hot columns, which only include 19 of the 21 real Hub areas —
**FYW** (First-Year Writing Seminar) and **WRI** (Writing, Research,
and Inquiry) are missing entirely. Until the catalog scrape/import
includes these two columns, no course can ever satisfy them, and the
tracker will always show them as unfulfillable. Flag this to the user
rather than silently working around it — it may need a re-scrape of
the source bulletin data.

## First-Year Student requirements (26 total)

| Group | Area | Code | Count needed |
|---|---|---|---|
| Philosophical, Aesthetic, Historical | Philosophical Inquiry and Life's Meanings | PLM | 1 |
| | Aesthetic Exploration | AEX | 1 |
| | Historical Consciousness | HCO | 1 |
| Scientific and Social Inquiry | Scientific Inquiry I | SI1 | 1 |
| | Social Inquiry I | SO1 | 1 |
| | Scientific Inquiry II **OR** Social Inquiry II | SI2 / SO2 | 1 (either satisfies) |
| Quantitative Reasoning | Quantitative Reasoning I | QR1 | 1 |
| | Quantitative Reasoning II | QR2 | 1 |
| Diversity, Civic, Global | The Individual in Community | IIC | 1 |
| | Global Citizenship and Intercultural Literacy | GCI | 2 |
| | Ethical Reasoning | ETR | 1 |
| Communication | First-Year Writing Seminar | FYW | 1 |
| | Writing, Research, and Inquiry | WRI | 1 |
| | Writing-Intensive Course | WIN | 2 |
| | Oral and/or Signed Communication | OSC | 1 |
| | Digital/Multimedia Expression | DME | 1 |
| Intellectual Toolkit | Critical Thinking | CRT | 2 |
| | Research and Information Literacy | RIL | 2 |
| | Teamwork/Collaboration | TWC | 2 |
| | Creativity/Innovation | CRI | 2 |

## Transfer Student requirements (10 total)

| Group | Requirement | Count needed |
|---|---|---|
| Philosophical, Aesthetic, Historical | PLM **OR** AEX **OR** HCO | 1 |
| Scientific and Social Inquiry | SI1 **OR** SI2 | 1 |
| | SO1 **OR** SO2 | 1 |
| Quantitative Reasoning | QR2 | 1 |
| Diversity, Civic, Global | IIC **OR** GCI **OR** ETR | 1 |
| Communication | WRI **OR** WIN | 1 |
| Intellectual Toolkit | CRT | 1 |
| | RIL | 1 |
| | TWC | 1 |
| | CRI | 1 |

Transfer students may satisfy up to 1 requirement via a Hub
cocurricular experience (out of scope to model for now — just don't
block on it).

## Toggle behavior
The Planner needs a first-year/transfer toggle (persisted per plan,
alongside the existing plan document) that switches which requirement
table above is used to compute the HUB sidebar's progress. Both tables
use the same underlying `hubUnits` codes on each course — only the
required-count/OR-grouping logic differs between the two.

## Proposed color palette (6 capacity groups)
Not scraped from BU's official flyer (couldn't extract exact hex from
a text-only fetch) — this is a proposed palette consistent with the
existing scarlet/cream theme. Swap in exact values later if the user
provides them from the official PDF.

| Group | Color |
|---|---|
| Philosophical, Aesthetic, Historical | `#B0413E` (deep rose) |
| Scientific and Social Inquiry | `#2F6F5E` (forest green) |
| Quantitative Reasoning | `#3B5D8C` (slate blue) |
| Diversity, Civic, Global | `#C77B2E` (amber) |
| Communication | `#7A4F9E` (plum) |
| Intellectual Toolkit | `#4A7A8C` (teal) |
