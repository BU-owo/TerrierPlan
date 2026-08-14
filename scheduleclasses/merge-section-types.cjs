/**
 * merge-section-types.js
 *
 * Joins BU's "Component" (section type: LEC/DIS/LAB/etc.) field from the
 * roster export into your main schedule export, matched on Class Nbr.
 *
 * Usage:
 *   node merge-section-types.js <schedule_file> <roster_file> <output_file>
 *
 * Example:
 *   node merge-section-types.js schedule.csv BU_R0010K_SR_ROSTER_FROM_LIST.csv schedule_with_types.csv
 *
 * - schedule_file: your main data source (tab- or comma-delimited, auto-detected).
 *     Must have a "Class Nbr" column.
 * - roster_file: the BU_R0010K_SR_ROSTER_FROM_LIST.csv export (comma-delimited).
 *     Must have "Class Nbr" and "Component" columns.
 * - output_file: where to write the merged result. Extension (.csv/.json)
 *     controls output format.
 */

const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");

// BU component code legend.
// Core codes are from BU's official list. A handful of additional codes
// showed up in real data pulls (mostly MED/SDM grad-professional programs)
// that aren't in the official list — those are intentionally left unlabeled
// here so they fall through to the raw code (see below) rather than showing
// a guessed-at label. A few undergrad-relevant ones (CFA performance/ensemble
// courses, and PLC which also shows up in LAW/BUA) got real labels added
// since this tool is undergrad-facing and those will actually appear.
const COMPONENT_LABELS = {
  // Official/core
  APP: "Applied Art",
  DIS: "Discussion Section",
  DRS: "Directed Study",
  EXP: "Clinical Experience",
  IND: "Independent Course",
  LAB: "Laboratory",
  LEC: "Lecture",
  OTH: "Other",
  PLB: "Pre-lab Section",

  // Added — undergrad-relevant (mostly CFA)
  CAP: "Applied/Performance Instruction",
  MUO: "Music Ensemble (Large)",
  MUE: "Music Ensemble (Small)",
  PLC: "Placement",

  // Intentionally NOT labeled (grad/professional-only in observed data —
  // MED/SDM/MET — will fall through to the raw code via the ?? fallback
  // in main() rather than showing a guessed label):
  // SML, LRG, CLN, DID, RSC, PCL, FLD
};

function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const result = Papa.parse(raw, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  if (result.errors.length) {
    const fatal = result.errors.filter((e) => e.type !== "FieldMismatch");
    if (fatal.length) {
      console.warn(`Warning: ${fatal.length} parse issue(s) in ${filePath}. First:`, fatal[0]);
    }
  }
  return result.data;
}

function main() {
  const [, , scheduleArg, rosterArg, outputArg] = process.argv;

  if (!scheduleArg || !rosterArg || !outputArg) {
    console.error(
      "Usage: node merge-section-types.js <schedule_file> <roster_file> <output_file>"
    );
    process.exit(1);
  }

  const scheduleRows = parseFile(scheduleArg);
  const rosterRows = parseFile(rosterArg);

  if (!scheduleRows.length || !("Class Nbr" in scheduleRows[0])) {
    console.error('Schedule file is missing a "Class Nbr" column. Found columns:', Object.keys(scheduleRows[0] || {}));
    process.exit(1);
  }
  if (!rosterRows.length || !("Class Nbr" in rosterRows[0]) || !("Component" in rosterRows[0])) {
    console.error('Roster file is missing "Class Nbr" or "Component". Found columns:', Object.keys(rosterRows[0] || {}));
    process.exit(1);
  }

  // Build lookup: Class Nbr -> Component (dedupe, since roster can repeat)
  const componentByClassNbr = new Map();
  for (const row of rosterRows) {
    const classNbr = String(row["Class Nbr"]).trim();
    const component = String(row["Component"]).trim();
    if (classNbr && component) {
      componentByClassNbr.set(classNbr, component);
    }
  }

  let matched = 0;
  let unmatched = 0;
  const unmatchedSample = [];

  const merged = scheduleRows.map((row) => {
    const classNbr = String(row["Class Nbr"] ?? "").trim();
    const component = componentByClassNbr.get(classNbr);

    if (component) {
      matched++;
    } else {
      unmatched++;
      if (unmatchedSample.length < 10) {
        unmatchedSample.push(classNbr || "(blank)");
      }
    }

    return {
      ...row,
      Component: component || "",
      "Component Label": component ? (COMPONENT_LABELS[component] || component) : "",
    };
  });

  // Sanity check: report any roster Class Nbrs never seen in the schedule file
  const scheduleClassNbrs = new Set(scheduleRows.map((r) => String(r["Class Nbr"] ?? "").trim()));
  const rosterOnly = [...componentByClassNbr.keys()].filter((cn) => !scheduleClassNbrs.has(cn));

  console.log(`Schedule rows: ${scheduleRows.length}`);
  console.log(`Roster rows (unique Class Nbr): ${componentByClassNbr.size}`);
  console.log(`Matched: ${matched}`);
  console.log(`Unmatched (schedule row with no Component found): ${unmatched}`);
  if (unmatchedSample.length) {
    console.log(`  Sample unmatched Class Nbr values: ${unmatchedSample.join(", ")}`);
  }
  console.log(`Class Nbr present in roster but not in schedule file: ${rosterOnly.length}`);

  const ext = path.extname(outputArg).toLowerCase();
  if (ext === ".json") {
    fs.writeFileSync(outputArg, JSON.stringify(merged, null, 2), "utf8");
  } else {
    const csv = Papa.unparse(merged);
    fs.writeFileSync(outputArg, csv, "utf8");
  }

  console.log(`\nWrote merged output to ${outputArg}`);
}

main();