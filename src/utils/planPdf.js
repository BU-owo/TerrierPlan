// "Download plan PDF": draws the plan directly from planner state with
// pdf-lib (light palette, Helvetica, selectable text) and embeds the plan as
// a versioned JSON attachment. Export only — nothing reads the attachment
// back yet. Loaded with a dynamic import() on click so pdf-lib stays out of
// the main chunk.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { entryCourseKey, isNoteEntry } from './courseEntry';
import { BU_SCHOOLS } from '../data/bu-programs';
import { COURSE_KEY_PATTERN } from './courseKey';

export const PLAN_PDF_FORMAT = 'terrierplan-plan';
export const PLAN_PDF_VERSION = 1;
export const PLAN_PDF_ATTACHMENT_NAME = 'terrierplan-plan.json';

const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 30;
const FOOTER_TEXT_Y = 20;
const FOOTER_RULE_Y = 33;
const FOOTNOTE_Y = 39;
const CONTENT_BOTTOM = 52;
const HEADER_BAND_H = 52;
const STRIP_H = 26;
const CONT_BAR_H = 20;
const BLOCK_GAP = 8;
const ROW_TOP_PAD = 2;

const GUTTER_W = 22;
const CELL_PAD = 5;
const CODE_W = 54;
const CREDIT_W = 30;
const MAX_NAME_LINES = 3;
// Tried in order; the first one where the whole plan fits on one page wins.
// A plan that doesn't fit even at the smallest is drawn at full size across
// as many pages as it needs.
const SCALES = [1, 0.94, 0.88, 0.82, 0.76];

const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.42, 0.44, 0.48);
const RULE = rgb(0.78, 0.8, 0.83);
const HAIR = rgb(0.9, 0.91, 0.93);
const BAND = rgb(0.93, 0.93, 0.94);
const SUMMER_BAND = rgb(0.88, 0.88, 0.9);
const SCARLET = rgb(0.8, 0, 0);
const WHITE = rgb(1, 1, 1);

const DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

// Code point -> stand-in text. Anything the Helvetica (WinAnsi) font can't
// encode is replaced here (or by "?") so drawText and widthOfTextAtSize can
// never throw. Numeric on purpose (no literal odd characters in the source).
const REPLACEMENTS = new Map([
  ...[0x2018, 0x2019, 0x201a, 0x2032].map((c) => [c, "'"]),
  ...[0x201c, 0x201d, 0x201e, 0x2033].map((c) => [c, '"']),
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212].map((c) => [c, '-']),
  ...[0x2192, 0x21d2, 0x27f6].map((c) => [c, '->']),
  ...[0x2190, 0x21d0].map((c) => [c, '<-']),
  [0x2194, '<->'],
  [0x2026, '...'],
  ...[0xa0, 0x09, 0x0a, 0x0d, 0x202f, ...Array.from({ length: 9 }, (_, i) => 0x2002 + i)].map((c) => [c, ' ']),
  // Zero-width characters and variation selectors: dropped.
  ...[0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff, 0xfe0e, 0xfe0f].map((c) => [c, '']),
]);

const supportedCache = new WeakMap();

export function sanitizeWinAnsi(value, font) {
  let supported = supportedCache.get(font);
  if (!supported) {
    supported = new Set(font.getCharacterSet());
    supportedCache.set(font, supported);
  }
  let out = '';
  for (const ch of String(value ?? '')) {
    const code = ch.codePointAt(0);
    if (REPLACEMENTS.has(code)) out += REPLACEMENTS.get(code);
    else out += supported.has(code) ? ch : '?';
  }
  return out;
}

function formatCourseKey(courseKey) {
  const m = String(courseKey).match(COURSE_KEY_PATTERN);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : String(courseKey);
}

function findMajorLabel(majorBulletinUrl) {
  if (!majorBulletinUrl) return null;
  for (const school of BU_SCHOOLS) {
    const program = school.programs.find((p) => p.url === majorBulletinUrl);
    if (program) return `${program.name} ${program.degree}`.trim();
  }
  return null;
}

function slugify(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return slug || 'plan';
}

export function planPdfFilename(planName) {
  return `terrierplan-${slugify(planName)}.pdf`;
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    // A single word wider than the column: hard-split it.
    while (font.widthOfTextAtSize(current, size) > maxWidth && current.length > 1) {
      let cut = current.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(current.slice(0, cut), size) > maxWidth) cut -= 1;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Same line count as a plain greedy wrap, but at the narrowest width that
// still gives that count, so the last line isn't a lone orphaned word.
function wrapBalanced(text, font, size, maxWidth) {
  const lines = wrapText(text, font, size, maxWidth);
  if (lines.length < 2) return lines;
  let lo = maxWidth * 0.5;
  let hi = maxWidth;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (wrapText(text, font, size, mid).length <= lines.length) hi = mid;
    else lo = mid;
  }
  return wrapText(text, font, size, hi);
}

// Keeps at most `max` lines, ending the last one with "..." if it was cut.
function clampLines(lines, max, font, size, maxWidth) {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last.length > 0 && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[max - 1] = `${last}...`;
  return kept;
}

function oneLine(text, font, size, width) {
  return clampLines(wrapText(text, font, size, width), 1, font, size, width)[0] || '';
}

// Last year (0-based) that has anything in it; years after it are left off
// so a short plan doesn't print blank rows. Empty years before it stay.
function lastUsedYear(semesters, gridSummerTerms) {
  let last = 0;
  semesters.forEach((entries, i) => {
    if ((entries || []).length > 0) last = Math.max(last, Math.floor(i / 2));
  });
  Object.entries(gridSummerTerms || {}).forEach(([year, entries]) => {
    if ((entries || []).length > 0) last = Math.max(last, Number(year) || 0);
  });
  return last;
}

function knownCredit(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The one place per-entry credits and the semester total are decided; the
// rows are drawn from `rows` and the header from `known`/`unknown`, so they
// can't drift apart. `credits: null` = unknown (no creditsMap entry).
function summarizeEntries(entries, creditsMap) {
  let known = 0;
  let unknown = 0;
  const rows = (entries || []).map((entry) => {
    const credits = isNoteEntry(entry)
      ? knownCredit(entry.credits)
      : knownCredit(creditsMap?.[entryCourseKey(entry)]);
    if (credits == null) unknown += 1;
    else known += credits;
    return { entry, credits };
  });
  return { rows, known, unknown };
}

function creditLabel(known, unknown) {
  return `${known}${unknown > 0 ? '+' : ''} cr`;
}

export async function buildPlanPdf({
  planName,
  majorBulletinUrl,
  isTransfer,
  semesters,
  serializedSemesters,
  gridSummerTerms,
  extraTerms,
  stash,
  requirementOverrides,
  completedCourseKeys,
  externalCredits,
  courseMap,
  creditsMap,
  totalCredits,
}) {
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  doc.setTitle(sanitizeWinAnsi(`TerrierPlan - ${planName || 'Plan'}`, font));
  doc.setCreator('TerrierPlan');
  doc.setProducer('TerrierPlan');

  const clean = (value) => sanitizeWinAnsi(value, font);
  const plainSemesters = semesters || [];
  const years = lastUsedYear(plainSemesters, gridSummerTerms) + 1;

  // Any course (grid, Summer column or Summer/Winter list) with no credit
  // data makes the page-header total a lower bound.
  const planUnknown = [
    ...plainSemesters,
    ...Object.values(gridSummerTerms || {}),
  ].reduce((n, entries) => n + summarizeEntries(entries, creditsMap).unknown, 0)
    + (extraTerms || []).reduce(
      (n, term) => n + (term.courseKeys || []).filter((k) => knownCredit(creditsMap?.[k]) == null).length,
      0,
    );

  // ── Layout (measure only; drawing happens later, per page) ──
  const colW = (PAGE_W - MARGIN * 2 - GUTTER_W) / 2;
  const maxPageBody = PAGE_H - MARGIN - CONT_BAR_H - 8 - CONTENT_BOTTOM;

  function buildRows(entries, s) {
    const size = 8.6 * s;
    const lh = 10.4 * s;
    const rowGap = 3 * s;
    const nameX = CELL_PAD + CODE_W + 6;
    const nameW = colW - nameX - CREDIT_W - CELL_PAD - 4;
    const summary = summarizeEntries(entries, creditsMap);
    const rows = summary.rows.map(({ entry, credits }) => {
      let code;
      let name;
      let isNote = false;
      if (isNoteEntry(entry)) {
        isNote = true;
        code = 'Placeholder';
        name = entry.text || '';
      } else {
        const key = entryCourseKey(entry);
        const info = courseMap?.[key];
        code = info?.courseNumber || formatCourseKey(key);
        name = info?.name || '';
      }
      const nameFont = isNote ? italic : font;
      const nameLines = name
        ? clampLines(wrapBalanced(clean(name), nameFont, size, nameW), MAX_NAME_LINES, nameFont, size, nameW)
        : [];
      return {
        code: clean(code),
        nameLines,
        credits,
        isNote,
        height: Math.max(1, nameLines.length) * lh + rowGap,
      };
    });
    return { rows, summary, size, lh, nameX };
  }

  function layoutColumn(entries, s) {
    const built = buildRows(entries, s);
    let { rows } = built;
    let hidden = 0;
    // A column taller than a whole page keeps what fits and says how many
    // rows are left out, rather than splitting a year across pages.
    let used = 0;
    const fitting = [];
    for (const row of rows) {
      if (used + row.height > maxPageBody - built.lh * 4) break;
      used += row.height;
      fitting.push(row);
    }
    if (fitting.length < rows.length) {
      hidden = rows.length - fitting.length;
      rows = fitting;
    }
    const bodyH = rows.reduce((sum, r) => sum + r.height, 0) + (hidden > 0 ? built.lh + 3 * s : 0) + ROW_TOP_PAD;
    return { ...built, rows, hidden, bodyH: Math.max(bodyH, built.lh + 3 * s + ROW_TOP_PAD) };
  }

  function layoutYear(year, s) {
    const headH = 14 * s;
    const fall = layoutColumn(plainSemesters[year * 2], s);
    const spring = layoutColumn(plainSemesters[year * 2 + 1], s);
    const gridBodyH = Math.max(fall.bodyH, spring.bodyH);

    let summer = null;
    // Only a Summer column that actually has entries gets a strip.
    const summerEntries = gridSummerTerms?.[year] || [];
    if (summerEntries.length > 0) {
      const entries = summerEntries;
      // Courses flow across the same two columns as Fall/Spring.
      const half = Math.ceil(entries.length / 2);
      const left = layoutColumn(entries.slice(0, half), s);
      const right = layoutColumn(entries.slice(half), s);
      summer = {
        left,
        right,
        summary: summarizeEntries(entries, creditsMap),
        headH: 12 * s,
        bodyH: Math.max(left.bodyH, right.bodyH),
      };
    }
    const height = headH + gridBodyH + (summer ? summer.headH + summer.bodyH : 0);
    return { year, s, headH, fall, spring, gridBodyH, summer, height };
  }

  const layoutAll = (s) => Array.from({ length: years }, (_, y) => layoutYear(y, s));
  const totalHeight = (list) => list.reduce((sum, b) => sum + b.height, 0) + BLOCK_GAP * (list.length - 1);

  // First page spends more on the header than the later ones.
  const firstBodyTop = PAGE_H - HEADER_BAND_H - STRIP_H - 10;
  const laterBodyTop = PAGE_H - CONT_BAR_H - 8;
  const firstBodyH = firstBodyTop - CONTENT_BOTTOM;
  let blocks = layoutAll(1);
  for (const s of SCALES) {
    const candidate = s === 1 ? blocks : layoutAll(s);
    if (totalHeight(candidate) <= firstBodyH) {
      blocks = candidate;
      break;
    }
  }

  // ── Drawing ──
  const pages = [];
  const pageHasPlus = [];
  let page = null;
  let cursorY = 0;
  let pageTop = 0;

  const totalValue = totalCredits > 0 ? `${totalCredits}${planUnknown > 0 ? '+' : ''} cr` : null;

  function drawFirstHeader() {
    page.drawRectangle({ x: 0, y: PAGE_H - HEADER_BAND_H, width: PAGE_W, height: HEADER_BAND_H, color: SCARLET });
    page.drawText('TERRIERPLAN', { x: MARGIN, y: PAGE_H - 17, size: 8, font: bold, color: WHITE });
    const nameWidth = PAGE_W - MARGIN * 2;
    page.drawText(oneLine(clean(planName || 'My Plan'), bold, 21, nameWidth), {
      x: MARGIN,
      y: PAGE_H - 42,
      size: 21,
      font: bold,
      color: WHITE,
    });

    const stripTop = PAGE_H - HEADER_BAND_H;
    page.drawRectangle({ x: 0, y: stripTop - STRIP_H, width: PAGE_W, height: STRIP_H, color: BAND });
    const major = findMajorLabel(majorBulletinUrl);
    const items = [
      totalValue ? ['TOTAL CREDITS', totalValue] : null,
      ['YEARS', String(years)],
      major ? ['MAJOR', major] : null,
      ['GENERATED', dateLabel],
    ].filter(Boolean);
    let x = MARGIN;
    items.forEach(([label, value]) => {
      const labelText = clean(label);
      const valueText = oneLine(clean(value), bold, 9.5, 300);
      page.drawText(labelText, { x, y: stripTop - 10, size: 6.2, font: bold, color: MUTED });
      page.drawText(valueText, { x, y: stripTop - 21, size: 9.5, font: bold, color: INK });
      x += Math.max(bold.widthOfTextAtSize(valueText, 9.5), bold.widthOfTextAtSize(labelText, 6.2)) + 30;
    });
    if (totalValue && totalValue.includes('+')) pageHasPlus[pageHasPlus.length - 1] = true;
    return firstBodyTop;
  }

  function drawContinuationBar() {
    page.drawRectangle({ x: 0, y: PAGE_H - CONT_BAR_H, width: PAGE_W, height: CONT_BAR_H, color: SCARLET });
    const text = oneLine(clean(`TERRIERPLAN  |  ${planName || 'My Plan'} (continued)`), bold, 8, PAGE_W - MARGIN * 2);
    page.drawText(text, { x: MARGIN, y: PAGE_H - 13, size: 8, font: bold, color: WHITE });
    return laterBodyTop;
  }

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    pageHasPlus.push(false);
    pageTop = pages.length === 1 ? drawFirstHeader() : drawContinuationBar();
    cursorY = pageTop;
  }

  function drawRows(col, x, topY) {
    let y = topY - ROW_TOP_PAD;
    const { size, lh, nameX } = col;
    const k = lh / 10.4;
    col.rows.forEach((row, i) => {
      if (i > 0) {
        page.drawLine({
          start: { x: x + CELL_PAD, y: y + 1.5 * k },
          end: { x: x + colW - CELL_PAD, y: y + 1.5 * k },
          thickness: 0.4,
          color: HAIR,
        });
      }
      const baseline = y - lh + 2.6 * k;
      const textColor = row.isNote ? MUTED : INK;
      const codeFont = row.isNote ? italic : bold;
      let codeSize = size;
      while (codeSize > 5.5 && codeFont.widthOfTextAtSize(row.code, codeSize) > CODE_W) codeSize -= 0.2;
      page.drawText(row.code, { x: x + CELL_PAD, y: baseline, size: codeSize, font: codeFont, color: textColor });
      row.nameLines.forEach((line, li) => {
        page.drawText(line, {
          x: x + nameX,
          y: baseline - li * lh,
          size,
          font: row.isNote ? italic : font,
          color: textColor,
        });
      });
      // Credits live in their own right-aligned column, never in the label.
      const text = row.credits == null ? '-- cr' : `${row.credits} cr`;
      page.drawText(text, {
        x: x + colW - CELL_PAD - font.widthOfTextAtSize(text, size),
        y: baseline,
        size,
        font,
        color: row.credits == null ? MUTED : textColor,
      });
      y -= row.height;
    });
    if (col.hidden > 0) {
      page.drawText(clean(`+${col.hidden} more`), {
        x: x + CELL_PAD,
        y: y - lh + 2.6 * k,
        size,
        font: italic,
        color: MUTED,
      });
    }
  }

  function drawBandLabel(x, topY, width, headH, title, summary, s, fill) {
    page.drawRectangle({ x, y: topY - headH, width, height: headH, color: fill });
    const size = 8 * s;
    const y = topY - headH + (headH - size) / 2 + 1;
    page.drawText(clean(title.toUpperCase()), { x: x + CELL_PAD, y, size, font: bold, color: INK });
    if (summary.rows.length > 0) {
      const text = creditLabel(summary.known, summary.unknown);
      page.drawText(text, { x: x + width - CELL_PAD - bold.widthOfTextAtSize(text, size), y, size, font: bold, color: INK });
      if (summary.unknown > 0) pageHasPlus[pageHasPlus.length - 1] = true;
    }
  }

  // Dev-only: the number in a semester header must equal the sum of the
  // credits actually printed on its rows (when nothing is unknown and no
  // rows were cut for space).
  function assertSemester(label, cols, summary) {
    if (!DEV || summary.unknown > 0 || cols.some((c) => c.hidden > 0)) return;
    const printed = cols.reduce((sum, c) => sum + c.rows.reduce((s2, r) => s2 + (r.credits ?? 0), 0), 0);
    if (printed !== summary.known) {
      console.warn('[planPdf] semester total mismatch', { semester: label, printed, header: summary.known });
    }
  }

  function drawYear(block) {
    const { year, s, headH, fall, spring, gridBodyH, summer, height } = block;
    const top = cursorY;
    const gridLeft = MARGIN + GUTTER_W;
    const tableW = colW * 2;

    // Left-side year tab.
    page.drawRectangle({ x: MARGIN, y: top - height, width: GUTTER_W, height, color: SCARLET });
    const tabText = `YEAR ${year + 1}`;
    const tabSize = 8.5 * s;
    page.drawText(tabText, {
      x: MARGIN + GUTTER_W / 2 + tabSize * 0.35,
      y: top - height / 2 - bold.widthOfTextAtSize(tabText, tabSize) / 2,
      size: tabSize,
      font: bold,
      color: WHITE,
      rotate: degrees(90),
    });

    page.drawRectangle({ x: gridLeft, y: top - height, width: tableW, height, borderColor: RULE, borderWidth: 0.75 });
    page.drawLine({
      start: { x: gridLeft + colW, y: top },
      end: { x: gridLeft + colW, y: top - headH - gridBodyH },
      thickness: 0.5,
      color: RULE,
    });

    [[fall, 0, 'Fall', year * 2], [spring, 1, 'Spring', year * 2 + 1]].forEach(([col, ci, title, slot]) => {
      const x = gridLeft + ci * colW;
      drawBandLabel(x, top, colW, headH, title, col.summary, s, BAND);
      drawRows(col, x, top - headH);
      assertSemester(slot, [col], col.summary);
    });

    if (summer) {
      const sTop = top - headH - gridBodyH;
      drawBandLabel(gridLeft, sTop, tableW, summer.headH, 'Summer', summer.summary, s, SUMMER_BAND);
      page.drawLine({
        start: { x: gridLeft + colW, y: sTop - summer.headH },
        end: { x: gridLeft + colW, y: sTop - summer.headH - summer.bodyH },
        thickness: 0.5,
        color: RULE,
      });
      drawRows(summer.left, gridLeft, sTop - summer.headH);
      drawRows(summer.right, gridLeft + colW, sTop - summer.headH);
      assertSemester(`summer:${year}`, [summer.left, summer.right], summer.summary);
    }

    cursorY = top - height - BLOCK_GAP;
  }

  function drawFooters() {
    const text = clean(`Unofficial plan generated by TerrierPlan on ${dateLabel}. Verify with your advisor.`);
    pages.forEach((p, i) => {
      p.drawLine({
        start: { x: MARGIN, y: FOOTER_RULE_Y },
        end: { x: PAGE_W - MARGIN, y: FOOTER_RULE_Y },
        thickness: 0.5,
        color: RULE,
      });
      p.drawText(text, { x: MARGIN, y: FOOTER_TEXT_Y, size: 8, font, color: MUTED });
      const label = `Page ${i + 1} of ${pages.length}`;
      p.drawText(label, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(label, 8), y: FOOTER_TEXT_Y, size: 8, font, color: MUTED });
      if (pageHasPlus[i]) {
        p.drawText('+ = some courses have no credit data', { x: MARGIN, y: FOOTNOTE_Y, size: 7, font: italic, color: MUTED });
      }
    });
  }

  newPage();
  blocks.forEach((block) => {
    // A year is never split, and its header never ends up alone at the
    // bottom of a page: a block that doesn't fit starts a fresh page.
    if (cursorY - block.height < CONTENT_BOTTOM && cursorY < pageTop) newPage();
    drawYear(block);
  });

  drawFooters();

  // ── Machine-readable attachment ──
  // Built field by field, so nothing account-specific (uid, email, name) can
  // leak in. advisorNote is student-entered free text, left out on purpose.
  const payload = {
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
  await doc.attach(
    new TextEncoder().encode(JSON.stringify(payload)),
    PLAN_PDF_ATTACHMENT_NAME,
    {
      mimeType: 'application/json',
      description: 'TerrierPlan plan data',
      creationDate: now,
      modificationDate: now,
    },
  );

  return doc.save();
}

// Builds the PDF and triggers the browser download.
export async function downloadPlanPdf(args) {
  const bytes = await buildPlanPdf(args);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = planPdfFilename(args.planName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
