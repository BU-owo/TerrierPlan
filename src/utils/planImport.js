// Reading a TerrierPlan plan PDF back in. Two halves:
//  - readPlanAttachment(file): opens the PDF with pdfjs and pulls out the
//    embedded terrierplan-plan.json (see planPdf.js, which writes it).
//  - sanitizePlanBlob(blob, ctx): pure, never throws. Treats the blob as
//    untrusted: whitelists fields and rebuilds every object, so nothing from
//    the file is spread into app state or written to Firestore as-is.
// pdfjs is imported lazily inside readPlanAttachment so this module (and its
// tests) load without a browser, and so it never pulls in pdf-lib.
import { normalizeCourseEntry, createNoteEntry, DEFAULT_NOTE_CREDITS } from './courseEntry.js';
import { normalizeCourseKey } from './courseKey.js';

export const PLAN_FORMAT = 'terrierplan-plan';
export const PLAN_VERSION = 1;
export const PLAN_ATTACHMENT_NAME = 'terrierplan-plan.json';

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_BLOB_BYTES = 256 * 1024;
export const MAX_SLOTS = 16;
export const MIN_SLOTS = 8;
export const MAX_SUMMER_YEAR = 7;
export const MAX_NOTE_TEXT = 100;
export const MAX_NOTE_CREDITS = 16;
export const MAX_EXTRA_TERMS = 8;
export const MAX_STASH = 100;
export const MAX_NAME = 60;
export const FALLBACK_NAME = 'Imported Plan';
const MAX_ENTRIES_PER_SLOT = 40;
const MAX_KEYS_PER_EXTRA_TERM = 40;
const MAX_NOTE_OVERRIDE_TEXT = 200;
const EXTRA_SEASONS = new Set(['summer', 'winter', 'fall', 'spring']);

// Loose shape check only; the catalog is the real authority. (The stricter
// isValidCourseKeyFormat would reject ~2,100 real catalog ids such as
// study-abroad "...E" keys.)
const KEY_SHAPE = /^[A-Z0-9.]{4,12}$/;
const RESERVED_KEY = /^__.*__$/;

const ERRORS = {
  tooBig: 'That file is too big to import (8 MB max).',
  unreadable: "Couldn't read the plan data inside that PDF.",
  blobTooBig: 'The plan data in that PDF is too big to import.',
  malformed: "The plan data in that PDF is damaged, so it can't be imported.",
  wrongFormat: "That PDF's plan data isn't in a format TerrierPlan recognizes.",
  newerVersion: 'That plan PDF was made by a newer version of TerrierPlan. Refresh the page to get the latest version, then try again.',
  missingSemesters: "That plan PDF doesn't have any semesters in it.",
  noCourses: 'No valid courses found.',
  generic: "Couldn't read that plan.",
};

// ── Reading the attachment ──────────────────────────────────────────────────

// Returns null when the PDF has no terrierplan-plan.json (or isn't a PDF
// pdfjs can open) so the transcript flow runs as before; { blob } on
// success; { error: { code, message } } when the attachment is there but
// unusable.
export async function readPlanAttachment(file) {
  if (!file) return null;
  if (file.size > MAX_FILE_BYTES) {
    return { error: { code: 'file-too-big', message: ERRORS.tooBig } };
  }

  let task;
  try {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const data = await file.arrayBuffer();
    task = pdfjs.getDocument({ data });
    const pdf = await task.promise;

    const attachments = await pdf.getAttachments();
    if (!attachments) return null;
    let id = null;
    for (const [key, meta] of attachments) {
      if (meta?.filename === PLAN_ATTACHMENT_NAME) {
        id = key;
        break;
      }
    }
    if (id == null) return null;

    let bytes;
    try {
      bytes = await pdf.getAttachmentContent(id);
    } catch {
      return { error: { code: 'unreadable', message: ERRORS.unreadable } };
    }
    if (!bytes || typeof bytes.length !== 'number') {
      return { error: { code: 'unreadable', message: ERRORS.unreadable } };
    }
    if (bytes.length > MAX_BLOB_BYTES) {
      return { error: { code: 'blob-too-big', message: ERRORS.blobTooBig } };
    }
    try {
      return { blob: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch {
      return { error: { code: 'malformed', message: ERRORS.malformed } };
    }
  } catch {
    // Not something pdfjs can open: let the transcript flow report that.
    return null;
  } finally {
    try {
      await task?.destroy();
    } catch {
      // nothing useful to do
    }
  }
}

// ── Sanitizing ──────────────────────────────────────────────────────────────

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeKey(key) {
  return typeof key === 'string' && key.length > 0 && !RESERVED_KEY.test(key);
}

// Tabs/newlines become spaces; other control characters are dropped (no
// escapes in the source on purpose).
function stripControl(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 9 || code === 10 || code === 13) out += ' ';
    else if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return stripControl(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function shortLabel(value) {
  if (typeof value === 'string') return cleanText(value, 24) || '(blank)';
  if (value === null || value === undefined) return '(blank)';
  return `(${typeof value})`;
}

function slotLabel(index) {
  return `Year ${Math.floor(index / 2) + 1} ${index % 2 === 0 ? 'Fall' : 'Spring'}`;
}

// Maps a raw courseKey to its catalog key, or says why it can't be used.
function resolveKey(raw, catalogIds) {
  if (typeof raw !== 'string' || raw.length > 40) return { reason: 'not a course code' };
  const key = normalizeCourseKey(raw);
  if (!KEY_SHAPE.test(key)) return { reason: 'not a course code' };
  if (catalogIds.has(key)) return { key };
  // "...S" session keys: same stripping the transcript import does.
  const stripped = /^(.*\d)S$/.exec(key);
  if (stripped && catalogIds.has(stripped[1])) return { key: stripped[1] };
  return { reason: 'not in the course catalog' };
}

function collectNodeIds(tree) {
  const ids = new Set();
  const stack = [tree];
  let guard = 0;
  while (stack.length > 0 && guard < 5000) {
    guard += 1;
    const node = stack.pop();
    if (!isPlainObject(node)) continue;
    if (typeof node.id === 'string') ids.add(node.id);
    if (Array.isArray(node.children)) stack.push(...node.children);
  }
  return ids;
}

function fatal(code, message) {
  return { plan: null, summary: null, dropped: [], errors: [{ code, message }] };
}

export function sanitizePlanBlob(blob, { catalogIds, programs } = {}) {
  try {
    return sanitize(blob, catalogIds instanceof Set ? catalogIds : new Set(), programs || {});
  } catch {
    return fatal('invalid', ERRORS.generic);
  }
}

function sanitize(blob, catalogIds, programs) {
  if (!isPlainObject(blob) || blob.format !== PLAN_FORMAT) {
    return fatal('wrong-format', ERRORS.wrongFormat);
  }
  if (typeof blob.version !== 'number' || !Number.isInteger(blob.version) || blob.version < 1) {
    return fatal('wrong-format', ERRORS.wrongFormat);
  }
  if (blob.version > PLAN_VERSION) return fatal('newer-version', ERRORS.newerVersion);
  if (!isPlainObject(blob.semesters) && !Array.isArray(blob.semesters)) {
    return fatal('missing-semesters', ERRORS.missingSemesters);
  }

  const dropped = [];
  const drop = (where, what, reason) => dropped.push({ where, what, reason });
  const seen = new Set(); // course keys already placed in the plan
  const counts = { courses: 0, placeholders: 0 };

  // Course/placeholder entries for one slot.
  function processEntries(rawEntries, where) {
    const out = [];
    if (!Array.isArray(rawEntries)) {
      if (rawEntries !== undefined && rawEntries !== null) drop(where, 'entries', 'not a list');
      return out;
    }
    rawEntries.forEach((raw, i) => {
      if (i >= MAX_ENTRIES_PER_SLOT) {
        if (i === MAX_ENTRIES_PER_SLOT) drop(where, `${rawEntries.length - MAX_ENTRIES_PER_SLOT} more entries`, 'too many in one semester');
        return;
      }
      if (isPlainObject(raw) && raw.kind === 'note') {
        const credits = Number(raw.credits);
        out.push(normalizeCourseEntry({
          kind: 'note',
          id: createNoteEntry().id,
          text: cleanText(raw.text, MAX_NOTE_TEXT),
          credits: Number.isFinite(credits)
            ? Math.min(MAX_NOTE_CREDITS, Math.max(0, credits))
            : DEFAULT_NOTE_CREDITS,
        }));
        counts.placeholders += 1;
        return;
      }
      const rawKey = typeof raw === 'string' ? raw : isPlainObject(raw) ? raw.courseKey : undefined;
      const resolved = resolveKey(rawKey, catalogIds);
      if (!resolved.key) {
        drop(where, shortLabel(rawKey), resolved.reason);
        return;
      }
      if (seen.has(resolved.key)) {
        drop(where, resolved.key, 'already in the plan');
        return;
      }
      seen.add(resolved.key);
      out.push(normalizeCourseEntry({ courseKey: resolved.key }));
      counts.courses += 1;
    });
    return out;
  }

  // ── semesters: object keyed by slot index (an array is tolerated) ──
  const rawSlots = new Map(); // slot index -> raw entries
  const semSource = blob.semesters;
  const semKeys = Array.isArray(semSource) ? semSource.map((_, i) => String(i)) : Object.keys(semSource);
  for (const key of semKeys) {
    if (!isSafeKey(key) || !/^\d{1,3}$/.test(key)) {
      drop('Semesters', shortLabel(key), 'unrecognized slot');
      continue;
    }
    const index = Number(key);
    const value = Array.isArray(semSource) ? semSource[index] : semSource[key];
    if (index >= MAX_SLOTS) {
      drop(`Slot ${index + 1}`, Array.isArray(value) ? `${value.length} entries` : 'entries', `beyond ${MAX_SLOTS / 2} years`);
      continue;
    }
    rawSlots.set(index, value);
  }

  // ── gridSummerTerms: { [year 0-7]: entries[] }, empty arrays kept ──
  const rawSummers = new Map();
  if (isPlainObject(blob.gridSummerTerms)) {
    for (const key of Object.keys(blob.gridSummerTerms)) {
      if (!isSafeKey(key) || !/^\d{1,3}$/.test(key) || Number(key) > MAX_SUMMER_YEAR) {
        drop('Summer', shortLabel(key), 'not a valid year');
        continue;
      }
      rawSummers.set(Number(key), blob.gridSummerTerms[key]);
    }
  }

  let slotCount = MIN_SLOTS;
  for (const index of rawSlots.keys()) slotCount = Math.max(slotCount, index + 1);
  for (const year of rawSummers.keys()) slotCount = Math.max(slotCount, (year + 1) * 2);
  slotCount = Math.min(MAX_SLOTS, slotCount + (slotCount % 2));

  const semesters = Array.from({ length: slotCount }, () => []);
  [...rawSlots.keys()].sort((a, b) => a - b).forEach((index) => {
    semesters[index] = processEntries(rawSlots.get(index), slotLabel(index));
  });

  const gridSummerTerms = {};
  [...rawSummers.keys()].sort((a, b) => a - b).forEach((year) => {
    gridSummerTerms[String(year)] = processEntries(rawSummers.get(year), `Year ${year + 1} Summer`);
  });

  // ── extraTerms ──
  const extraTerms = [];
  if (Array.isArray(blob.extraTerms)) {
    blob.extraTerms.forEach((raw, i) => {
      if (i >= MAX_EXTRA_TERMS) {
        if (i === MAX_EXTRA_TERMS) drop('Summer/Winter list', `${blob.extraTerms.length - MAX_EXTRA_TERMS} more terms`, 'too many terms');
        return;
      }
      const term = isPlainObject(raw) ? cleanText(raw.term, 40) : '';
      const season = isPlainObject(raw) && typeof raw.season === 'string' ? raw.season.toLowerCase() : '';
      if (!term || !EXTRA_SEASONS.has(season)) {
        drop('Summer/Winter list', shortLabel(isPlainObject(raw) ? raw.term : raw), 'unrecognized term');
        return;
      }
      const courseKeys = [];
      const rawKeys = Array.isArray(raw.courseKeys) ? raw.courseKeys.slice(0, MAX_KEYS_PER_EXTRA_TERM) : [];
      rawKeys.forEach((rawKey) => {
        const resolved = resolveKey(rawKey, catalogIds);
        if (!resolved.key) {
          drop(term, shortLabel(rawKey), resolved.reason);
        } else if (seen.has(resolved.key)) {
          drop(term, resolved.key, 'already in the plan');
        } else {
          seen.add(resolved.key);
          courseKeys.push(resolved.key);
          counts.courses += 1;
        }
      });
      if (courseKeys.length === 0) {
        drop('Summer/Winter list', term, 'no valid courses');
        return;
      }
      extraTerms.push({ term, season, courseKeys, isPostDegree: raw.isPostDegree === true });
    });
  } else if (blob.extraTerms !== undefined && blob.extraTerms !== null) {
    drop('Summer/Winter list', 'extra terms', 'not a list');
  }

  // ── stash ──
  const stash = [];
  if (Array.isArray(blob.stash)) {
    blob.stash.forEach((rawKey, i) => {
      if (i >= MAX_STASH) {
        if (i === MAX_STASH) drop('Saved for later', `${blob.stash.length - MAX_STASH} more courses`, `over the ${MAX_STASH} limit`);
        return;
      }
      const resolved = resolveKey(rawKey, catalogIds);
      if (!resolved.key) drop('Saved for later', shortLabel(rawKey), resolved.reason);
      else if (stash.includes(resolved.key)) drop('Saved for later', resolved.key, 'listed twice');
      else stash.push(resolved.key);
    });
  } else if (blob.stash !== undefined && blob.stash !== null) {
    drop('Saved for later', 'stash', 'not a list');
  }

  // ── name / major / transfer flag ──
  const name = cleanText(blob.name, MAX_NAME) || FALLBACK_NAME;
  const isTransfer = blob.isTransfer === true;

  const knownUrls = programs.urls instanceof Set ? programs.urls : new Set();
  let majorBulletinUrl = null;
  if (typeof blob.majorBulletinUrl === 'string' && knownUrls.has(blob.majorBulletinUrl)) {
    majorBulletinUrl = blob.majorBulletinUrl;
  } else if (blob.majorBulletinUrl !== null && blob.majorBulletinUrl !== undefined) {
    drop('Major', 'major', 'program not recognized');
  }

  // ── requirementOverrides ──
  const requirementOverrides = {};
  const rawOverrides = blob.requirementOverrides;
  if (isPlainObject(rawOverrides) && Object.keys(rawOverrides).length > 0) {
    const program = Array.isArray(programs.requirements)
      ? programs.requirements.find((p) => p && majorBulletinUrl && p.bulletinUrl === majorBulletinUrl)
      : null;
    if (!program) {
      drop('Requirement exceptions', 'all exceptions', 'major has no requirement data');
    } else {
      const nodeIds = collectNodeIds(program.tree);
      for (const nodeId of Object.keys(rawOverrides)) {
        const raw = rawOverrides[nodeId];
        if (!isSafeKey(nodeId) || !nodeIds.has(nodeId)) {
          drop('Requirement exceptions', shortLabel(nodeId), 'not a requirement in this major');
          continue;
        }
        if (!isPlainObject(raw) || (raw.type !== 'waive' && raw.type !== 'substitute')) {
          drop('Requirement exceptions', shortLabel(nodeId), 'unrecognized type');
          continue;
        }
        const created = typeof raw.createdAt === 'string' ? new Date(raw.createdAt) : null;
        if (!created || Number.isNaN(created.getTime())) {
          drop('Requirement exceptions', shortLabel(nodeId), 'no valid date');
          continue;
        }
        const override = { type: raw.type };
        if (raw.type === 'substitute') {
          const resolved = resolveKey(raw.courseKey, catalogIds);
          if (!resolved.key) {
            drop('Requirement exceptions', shortLabel(nodeId), resolved.reason);
            continue;
          }
          override.courseKey = resolved.key;
        }
        override.note = cleanText(raw.note, MAX_NOTE_OVERRIDE_TEXT) || null;
        override.createdAt = created.toISOString();
        requirementOverrides[nodeId] = override;
      }
    }
  }

  const summary = {
    name,
    years: slotCount / 2,
    courseCount: counts.courses,
    placeholderCount: counts.placeholders,
    stashCount: stash.length,
    extraTermCount: extraTerms.length,
    overrideCount: Object.keys(requirementOverrides).length,
    majorBulletinUrl,
  };

  if (counts.courses === 0 && counts.placeholders === 0) {
    return { plan: null, summary, dropped, errors: [{ code: 'no-courses', message: ERRORS.noCourses }] };
  }

  return {
    plan: { name, majorBulletinUrl, isTransfer, semesters, gridSummerTerms, extraTerms, stash, requirementOverrides },
    summary,
    dropped,
    errors: [],
  };
}
