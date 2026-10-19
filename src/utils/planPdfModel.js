// The pure, font-free parts of the plan PDF (see planPdf.js, which draws
// them): which rows a term prints, its Marine Semester label, the credit
// numbers, how the header total reconciles with the term totals, how tall an
// empty year must be, and the embedded plan data. Kept apart (and imported
// with explicit .js extensions) so node tests can load it.
import {
  entriesNoteCredits, entryCourseKey, isBlockEntry, isCourseEntry, isMarineTerm, isMarker, isNoteEntry,
} from './courseEntry.js';

export const PLAN_PDF_FORMAT = 'terrierplan-plan';
export const PLAN_PDF_VERSION = 1;
export const PLAN_PDF_ATTACHMENT_NAME = 'terrierplan-plan.json';

function knownCredit(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The entries a term PRINTS: everything except the Marine marker, which the
// board hides too (a real marker always; a degraded one — a plain note an old
// tab left — once the term is a Marine Semester). The marker stays in the
// plan data and in the embedded attachment; only its visible row goes.
export function visibleEntries(entries, slotIndex) {
  const marine = isMarineTerm(entries, slotIndex);
  return (entries || []).filter((entry) => !(isMarker(entry) && (isBlockEntry(entry) || marine)));
}

// One term, as the PDF shows it. `marine` uses the board's own derivation
// (isMarineTerm: a marker, or any course tagged Marine-only, mixed terms
// included). `slotIndex` is the grid slot (undefined for the halves of a Summer
// strip, which are never a Marine Semester). Credits come from the visible rows
// only: a note through entriesNoteCredits (the marker would be 0 anyway), a
// course from creditsMap (null = unknown, which makes the total a lower
// bound), an entry of an unknown kind counts 0.
export function summarizeTerm(entries, creditsMap, slotIndex) {
  const marine = isMarineTerm(entries, slotIndex);
  let known = 0;
  let unknown = 0;
  const rows = visibleEntries(entries, slotIndex).map((entry) => {
    if (!isNoteEntry(entry) && !isCourseEntry(entry)) return { entry, credits: 0 };
    const credits = isNoteEntry(entry)
      ? entriesNoteCredits([entry])
      : knownCredit(creditsMap?.[entryCourseKey(entry)]);
    if (credits == null) unknown += 1;
    else known += credits;
    return { entry, credits };
  });
  return { rows, known, unknown, marine };
}

export function creditLabel(known, unknown) {
  return `${known}${unknown > 0 ? '+' : ''} cr`;
}

// Band title of a term: the season, plus a muted "Marine Semester" label.
export function termTitle(season, marine) {
  return { name: season.toUpperCase(), label: marine ? 'Marine Semester' : null };
}

// Everything a Fall/Spring/Summer term holds, added up the way the term headers
// are: the "in terms" figure of the header total.
export function termsCreditTotal(semesters, gridSummerTerms, creditsMap) {
  let known = 0;
  let unknown = 0;
  (semesters || []).forEach((entries, i) => {
    const t = summarizeTerm(entries, creditsMap, i);
    known += t.known;
    unknown += t.unknown;
  });
  Object.values(gridSummerTerms || {}).forEach((entries) => {
    const t = summarizeTerm(entries, creditsMap, undefined);
    known += t.known;
    unknown += t.unknown;
  });
  return { known, unknown };
}

// Credits of courses in the Summer/Winter list (extraTerms), which count in the
// planner's total but are not drawn in the PDF.
export function extraTermsCredits(extraTerms, creditsMap) {
  return (extraTerms || []).reduce(
    (sum, term) => sum + (term.courseKeys || []).reduce((s, key) => s + (knownCredit(creditsMap?.[key]) ?? 0), 0),
    0,
  );
}

// A one-line footnote that makes the header TOTAL CREDITS add up with the term
// totals, or null when they already agree: "Total credits: 52 cr in terms + 4 cr
// AP/IB/transfer". `externalTotal` is the planner's external-credit figure; when
// it isn't given, whatever is left over is reported as "other credit".
export function totalsFootnote({ totalCredits, termsKnown, termsUnknown = 0, extraKnown = 0, externalTotal }) {
  if (!(totalCredits > 0)) return null;
  const plus = termsUnknown > 0 ? '+' : '';
  if (totalCredits === termsKnown && extraKnown === 0) return null;
  const parts = [`${termsKnown}${plus} cr in terms`];
  if (extraKnown > 0) parts.push(`${extraKnown} cr in Summer/Winter terms (not shown)`);
  const accounted = termsKnown + extraKnown;
  const external = externalTotal != null ? externalTotal : totalCredits - accounted;
  if (external > 0) parts.push(`${external} cr ${externalTotal != null ? 'AP/IB/transfer credit' : 'other credit'}`);
  if (parts.length === 1 && totalCredits === accounted) return null;
  return `Total credits: ${parts.join(' + ')}.`;
}

// Minimum height of a year block so its rotated "YEAR n" tab fits: the
// label's printed width (it runs along the block's height) plus padding. An
// empty year is otherwise shorter than its own label.
export function yearMinHeight(labelWidth, scale = 1) {
  return labelWidth + 14 * scale;
}

// The machine-readable attachment. Built field by field, so nothing
// account-specific (uid, email, name) can leak in. advisorNote is
// student-entered free text, left out on purpose. `semesters` is the plan's
// serialized grid INCLUDING the Marine marker, even though its row isn't
// printed, so re-importing recreates the Marine Semester exactly.
export function buildPlanPayload({
  now, planName, majorBulletinUrl, isTransfer, serializedSemesters, gridSummerTerms, extraTerms, stash,
  requirementOverrides, completedCourseKeys, externalCredits,
}) {
  return {
    format: PLAN_PDF_FORMAT,
    version: PLAN_PDF_VERSION,
    exportedAt: now.toISOString(),
    name: planName ?? null,
    majorBulletinUrl: majorBulletinUrl ?? null,
    isTransfer: Boolean(isTransfer),
    semesters: serializedSemesters,
    gridSummerTerms: gridSummerTerms || {},
    extraTerms: extraTerms || [],
    stash: stash || [],
    requirementOverrides: requirementOverrides || {},
    student: {
      completedCourseKeys: completedCourseKeys || [],
      externalCredits: (externalCredits || []).map((credit) => {
        // eslint-disable-next-line no-unused-vars
        const { advisorNote, ...rest } = credit || {};
        return rest;
      }),
    },
  };
}
