/**
 * Client-side BU unofficial transcript PDF parser.
 * Uses word bounding boxes and left/right column splitting — never naive
 * sequential text extraction (two-column layouts interleave incorrectly).
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { normalizeCourseKey } from './courseKey';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const TERM_RE = /^(Fall|Spring|Summer|Winter)\s+(\d{4})$/i;
const LETTER_GRADE_RE = /^(A|B|C|D)[+-]?$|^P$|^F$/i;
const SKIP_GRADE_RE = /^(W|AU|I|IP|N|NG|MG)$/i;
const DEBUG_TRANSCRIPT = true;

function debugTranscript(stage, payload) {
  if (!DEBUG_TRANSCRIPT) return;
  console.log(`[DEBUG transcriptParser] ${stage}`, payload);
}

/** Strip watermark/decoration single-letter noise from a reconstructed line. */
export function stripNoise(text) {
  return text
    .replace(/(?<=\S)\s+[a-z]\s+(?=\S)/g, ' ')
    .replace(/\s+[a-z]\s+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Group text items into lines within one column, sorted top→bottom.
 * PDF y increases upward, so higher y = higher on page.
 */
function itemsToLines(items, yTolerance = 3) {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => {
    if (Math.abs(b.y - a.y) > yTolerance) return b.y - a.y;
    return a.x - b.x;
  });

  const lines = [];
  let current = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - currentY) <= yTolerance) {
      current.push(item);
    } else {
      current.sort((a, b) => a.x - b.x);
      lines.push(current.map((w) => w.str).join(' ').replace(/\s+/g, ' ').trim());
      current = [item];
      currentY = item.y;
    }
  }
  current.sort((a, b) => a.x - b.x);
  lines.push(current.map((w) => w.str).join(' ').replace(/\s+/g, ' ').trim());
  return lines.filter(Boolean);
}

async function extractPageLines(page) {
  const viewport = page.getViewport({ scale: 1 });
  const midX = viewport.width / 2;
  const content = await page.getTextContent();

  const words = [];
  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    words.push({ str: item.str, x, y, width: item.width ?? 0 });
  }

  const left = words.filter((w) => w.x < midX);
  const right = words.filter((w) => w.x >= midX);

  // Interleave by reading left column fully then right (same vertical band
  // order as printed: left term block, then right term block per page band
  // is approximated by processing left then right top-to-bottom).
  return [...itemsToLines(left), ...itemsToLines(right)].map(stripNoise);
}

/**
 * Parse a course row like:
 *   CASCS 111 INT COMP SCI 1 4.0 A 16.0
 *   CAS CS 111 INTRO TO CS 4.00 B+ 13.32
 */
export function parseCourseLine(line) {
  const cleaned = stripNoise(line);
  // Course code: 2–4 letter college + subject letters + catalog number
  const m = cleaned.match(
    /^([A-Z]{2,4})\s*([A-Z]{1,4})\s*(\d{2,3}[A-Z]?)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Z][+-]?|P|F|W|AU|I|IP|N|NG|MG)\s+(\d+(?:\.\d+)?)\s*$/i,
  );
  if (!m) {
    // Try without grade points (some rows omit them)
    const m2 = cleaned.match(
      /^([A-Z]{2,4})\s*([A-Z]{1,4})\s*(\d{2,3}[A-Z]?)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Z][+-]?|P|F|W|AU|I|IP|N|NG|MG)\s*$/i,
    );
    if (!m2) return null;
    const [, college, subject, number, title, units, grade] = m2;
    return {
      courseCode: `${college}${subject} ${number}`.replace(/\s+/g, ' '),
      courseKey: normalizeCourseKey(`${college}${subject}${number}`),
      title: title.trim(),
      units: parseFloat(units),
      grade: grade.toUpperCase(),
      gradePoints: null,
    };
  }
  const [, college, subject, number, title, units, grade, gp] = m;
  return {
    courseCode: `${college}${subject} ${number}`.replace(/\s+/g, ' '),
    courseKey: normalizeCourseKey(`${college}${subject}${number}`),
    title: title.trim(),
    units: parseFloat(units),
    grade: grade.toUpperCase(),
    gradePoints: parseFloat(gp),
  };
}

/** Pull BU course key embedded in AP/test title text, e.g. "CASBI 107 Biology 1". */
export function parseApBuEquivalent(titleText) {
  const cleaned = stripNoise(titleText);
  const m = cleaned.match(/\b([A-Z]{2,4})\s*([A-Z]{1,4})\s*(\d{2,3}[A-Z]?)\b/i);
  if (!m) return { courseKey: null, title: cleaned };
  const courseKey = normalizeCourseKey(`${m[1]}${m[2]}${m[3]}`);
  const title = cleaned.replace(m[0], '').replace(/\s{2,}/g, ' ').trim();
  return { courseKey, title: title || cleaned };
}

function parseApLine(line) {
  const cleaned = stripNoise(line);
  debugTranscript('test-line-before-parse', cleaned);
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2},?\s+\d{4}\b/i.test(cleaned)
    || /\b(?:degree|conferral|awarded|conferred)\b/i.test(cleaned)) {
    return null;
  }
  // Test Subject | Course Title (with BU code) | Credits
  const m = cleaned.match(/^(.+?)\s{2,}(.+?)\s+(\d+(?:\.\d+)?)\s*$/);
  let testSubject;
  let rest;
  let credits;
  if (m) {
    testSubject = m[1].trim();
    rest = m[2].trim();
    credits = parseFloat(m[3]);
  } else {
    // Fallback: last token is credits
    const parts = cleaned.match(/^(.+)\s+(\d+(?:\.\d+)?)\s*$/);
    if (!parts) return null;
    credits = parseFloat(parts[2]);
    const body = parts[1].trim();
    // Split test subject from BU-equivalent blob at first CAS/ENG/… code
    const codeAt = body.search(/\b[A-Z]{2,4}\s*[A-Z]{1,4}\s*\d{2,3}/i);
    if (codeAt > 0) {
      testSubject = body.slice(0, codeAt).trim();
      rest = body.slice(codeAt).trim();
    } else {
      testSubject = body;
      rest = body;
    }
  }
  const { courseKey, title } = parseApBuEquivalent(rest);
  if (!courseKey) {
    debugTranscript('test-line-no-bu-course-key', { cleaned, testSubject, rest, credits });
    return null;
  }
  const scoreMatch = testSubject.match(/\b([1-5])\s*$/);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
  if (scoreMatch) testSubject = testSubject.slice(0, scoreMatch.index).trim();
  const parsed = { testSubject, courseKey, title, credits, score };
  debugTranscript('test-line-parsed', { cleaned, parsed });
  return parsed;
}

function parseTransferInstitutionHeader(line) {
  const cleaned = stripNoise(line);
  const m = cleaned.match(/^(Fall|Spring|Summer|Winter)\s*(?:\/|[-–—])\s*(.+?)(?:\s+(?:19|20)\d{2})?$/i);
  return m ? m[2].trim() : null;
}

function parseTransferCourseLine(line) {
  const cleaned = stripNoise(line);
  if (/^(course\s+title|title\s+credits?)$/i.test(cleaned)) return null;
  if (parseTransferInstitutionHeader(cleaned)) return null;
  const m = cleaned.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  // Avoid matching term headers / section headers
  if (TERM_RE.test(m[1].trim())) return null;
  if (/^(transfer|test|credit|institution|course|title)/i.test(m[1].trim())) return null;
  return { title: m[1].trim(), credits: parseFloat(m[2]) };
}

function shouldAppendApContinuation(previousSubject, line) {
  const prior = String(previousSubject || '').trim();
  const cleaned = stripNoise(line);
  if (!prior || !cleaned) return false;
  if (!/[&:\-–—]$/.test(prior)) return false;
  if (TERM_RE.test(cleaned)) return false;
  if (/^(test\s+credit|transfer\s+credit|test\s+subject|beginning\s+of|end\s+of|unofficial\s+transcript)/i.test(cleaned)) return false;
  if (/\b[A-Z]{2,4}\s*[A-Z]{1,4}\s*\d{2,3}[A-Z]?\b/i.test(cleaned)) return false;
  if (/\d+(?:\.\d+)?\s*$/.test(cleaned)) return false;
  return cleaned.length <= 60;
}

function looksLikeInstitution(line) {
  const cleaned = stripNoise(line);
  if (TERM_RE.test(cleaned)) return false;
  if (parseCourseLine(cleaned)) return false;
  if (/^(course\s+title|title\s+credits?)$/i.test(cleaned)) return false;
  if (/^\d+(\.\d+)?$/.test(cleaned)) return false;
  if (/cumulative|earned|points|gpa|degree|awarded|graduat/i.test(cleaned)) return false;
  if (/^(transfer credit|test credit|beginning of|end of|unofficial)/i.test(cleaned)) return false;
  // Institution lines are typically Title Case / ALL CAPS without a trailing credit
  if (/\d+\.\d{2}\s*$/.test(cleaned)) return false;
  return cleaned.length >= 4 && cleaned.length < 80;
}

function isTestCreditTerminator(line) {
  return /\b(?:end of (?:undergraduate|graduate|non[- ]degree)?\s*record|beginning of (?:undergraduate|graduate|non[- ]degree)?\s*record|academic record)\b/i.test(line);
}

function parseMetaFromLines(lines) {
  let cumulativeGpa = null;
  let earnedCredits = null;
  let gradePoints = null;
  const joined = lines.join(' \n ');

  const gpaM = joined.match(/Cumulative\s+GPA[:\s]+(\d+\.\d+)/i)
    || joined.match(/Cum(?:ulative)?\.?\s*GPA[:\s]+(\d+\.\d+)/i);
  if (gpaM) cumulativeGpa = parseFloat(gpaM[1]);

  const earnedM = joined.match(/Earned[:\s]+(\d+(?:\.\d+)?)/i);
  if (earnedM) earnedCredits = parseFloat(earnedM[1]);

  const pointsM = joined.match(/(?:Grade\s+)?Points[:\s]+(\d+(?:\.\d+)?)/i);
  if (pointsM) gradePoints = parseFloat(pointsM[1]);

  return { cumulativeGpa, earnedCredits, gradePoints };
}

/**
 * Parse a transcript PDF File/ArrayBuffer into structured buckets.
 * @returns {{
 *   terms: Array<{term, season, isPostDegree, courses: Array<{term, courseCode, courseKey, title, units, grade}>}>,
 *   apCredits: Array<{testSubject, courseKey, title, credits}>,
 *   transferCredits: Array<{institution, title, credits}>,
 *   meta: {cumulativeGpa, earnedCredits, gradePoints}
 * }}
 */
export async function parseTranscriptPdf(source) {
  const data = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;

  const allLines = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const pageLines = await extractPageLines(page);
    allLines.push(...pageLines);
  }

  const terms = [];
  const apCredits = [];
  const transferCredits = [];
  let mode = 'terms'; // 'terms' | 'test' | 'transfer'
  let currentTerm = null;
  let currentInstitution = null;
  let graduated = false;
  let lastApCredit = null;

  for (const raw of allLines) {
    const line = stripNoise(raw);
    if (!line) continue;

    // Do not treat an "Expected Graduation" header as a completed degree.
    // Only an explicit credential-completion line makes later terms post-degree.
    if (/\b(?:degree\s+(?:awarded|conferred|earned)|graduated)\b/i.test(line)) {
      graduated = true;
      continue;
    }

    if (/^TEST\s+CREDIT/i.test(line) || /^ADVANCED\s+PLACEMENT/i.test(line)) {
      mode = 'test';
      currentTerm = null;
      lastApCredit = null;
      continue;
    }
    if (/^TRANSFER\s+CREDIT/i.test(line)) {
      debugTranscript('transfer-mode-enter', line);
      mode = 'transfer';
      currentTerm = null;
      currentInstitution = null;
      continue;
    }
    if (/^BEGINNING OF|END OF|UNOFFICIAL TRANSCRIPT/i.test(line)) {
      if (mode === 'test' && isTestCreditTerminator(line)) mode = 'terms';
      continue;
    }

    // A real term header is always the beginning of regular coursework, even
    // if a prior TEST CREDIT block ended on an earlier page.
    const termM = line.match(TERM_RE);
    if (termM) {
      if (mode === 'transfer') {
        debugTranscript('transfer-term-header', line);
        continue;
      }
      if (mode !== 'terms') {
        debugTranscript('term-header-switches-mode', { fromMode: mode, line });
      }
      mode = 'terms';
      lastApCredit = null;
      const term = `${termM[1][0].toUpperCase()}${termM[1].slice(1).toLowerCase()} ${termM[2]}`;
      currentTerm = {
        term,
        season: termM[1].toLowerCase(),
        isPostDegree: graduated,
        courses: [],
      };
      terms.push(currentTerm);
      continue;
    }

    if (mode === 'test') {
      if (isTestCreditTerminator(line) || parseCourseLine(line)) {
        mode = 'terms';
        currentTerm = null;
        lastApCredit = null;
        continue;
      }
      if (/^TRANSFER\s+CREDIT/i.test(line)) {
        mode = 'transfer';
        lastApCredit = null;
        continue;
      }
      if (lastApCredit && shouldAppendApContinuation(lastApCredit.testSubject, line)) {
        lastApCredit.testSubject = stripNoise(`${lastApCredit.testSubject} ${line}`);
        debugTranscript('test-line-subject-continuation', {
          appendedLine: line,
          mergedSubject: lastApCredit.testSubject,
        });
        continue;
      }
      const ap = parseApLine(line);
      if (ap) {
        apCredits.push(ap);
        lastApCredit = ap;
      }
      continue;
    }

    if (mode === 'transfer') {
      debugTranscript('transfer-line-before-parse', line);
      if (/^TEST\s+CREDIT/i.test(line)) {
        mode = 'test';
        continue;
      }
      if (/^(course\s+title|title\s+credits?)$/i.test(line)) {
        debugTranscript('transfer-header-row-skipped', line);
        continue;
      }
      const institutionHeader = parseTransferInstitutionHeader(line);
      if (institutionHeader) {
        debugTranscript('transfer-institution-header', institutionHeader);
        currentInstitution = institutionHeader;
        continue;
      }
      // New institution header
      if (looksLikeInstitution(line) && !parseTransferCourseLine(line)) {
        debugTranscript('transfer-institution-heuristic', line);
        currentInstitution = line;
        continue;
      }
      const tr = parseTransferCourseLine(line);
      if (tr) {
        debugTranscript('transfer-line-parsed', {
          rawLine: line,
          institution: currentInstitution || 'Unknown institution',
          title: tr.title,
          credits: tr.credits,
        });
        transferCredits.push({
          institution: currentInstitution || 'Unknown institution',
          title: tr.title,
          credits: tr.credits,
        });
      }
      continue;
    }

    if (!currentTerm) continue;

    const course = parseCourseLine(line);
    if (!course) continue;
    if (SKIP_GRADE_RE.test(course.grade)) continue;
    if (!LETTER_GRADE_RE.test(course.grade)) continue;

    currentTerm.courses.push({
      term: currentTerm.term,
      courseCode: course.courseCode,
      courseKey: course.courseKey,
      title: course.title,
      units: course.units,
      grade: course.grade,
    });
  }

  // Drop empty term shells
  const nonEmptyTerms = terms.filter((t) => t.courses.length > 0);
  const meta = parseMetaFromLines(allLines);

  return {
    terms: nonEmptyTerms,
    apCredits,
    transferCredits,
    meta,
  };
}
