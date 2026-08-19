const TEST_TYPES = new Set(['ap', 'ib']);

function createExternalCreditId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ec_${crypto.randomUUID()}`;
  }
  return `ec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCreditId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeType(rawType, fallback) {
  const value = String(rawType || '').trim().toLowerCase();
  if (value === 'ap' || value === 'advanced_placement' || value === 'advanced placement') return 'ap';
  if (value === 'ib' || value === 'international_baccalaureate' || value === 'international baccalaureate') return 'ib';
  if (value === 'transfer' || value === 'transfer_credit' || value === 'transfer credit') return 'transfer';
  return fallback || value || 'transfer';
}

function normalizeCourseKey(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, '').toUpperCase();
  return normalized || null;
}

// Free-text advisor note, trimmed to null when blank — same "null means
// absent" convention as courseKey, so callers can check truthiness instead
// of also handling empty-string.
function normalizeAdvisorNote(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

// manualCourses mirrors the same single-vs-multi distinction the rest of
// this shape already draws between `courseKey` (one course) and `courses`
// (a required multi-course sequence, e.g. auto-resolved Calc BC or IB
// entries) — manualCourseKey/manualCourses are that same split applied to
// a student's manual override, so a picked "CAS BI 105 + CAS BI 107" combo
// isn't forced into the single-courseKey shape/validation.
function normalizeManualCourses(value) {
  if (!Array.isArray(value)) return null;
  const cleaned = value.map((v) => normalizeCourseKey(v)).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

function normalizeStatus(type, status, courseKey) {
  if (type !== 'transfer') return status || undefined;
  if (status === 'mapped' || status === 'needs_mapping') return status;
  return courseKey ? 'mapped' : 'needs_mapping';
}

// manualCourseKey / manualCourses / advisorNote are a student-entered
// override for AP/IB rows that auto-resolved with no single confident
// course (courseNote-only, shown as "Not mapped") — e.g. "my advisor
// confirmed CAS BI 108" (manualCourseKey), "CAS BI 105 + CAS BI 107"
// (manualCourses, when the confirmed mapping is itself multiple courses),
// or just a free-text note when there's no clean course to name. Same
// shape/intent as the existing manualHubUnits override: a manual
// annotation layered on top of the auto-resolved result, not a replacement
// for it. Notably this only annotates which course maps to the credit —
// it does NOT change `credits`
// or `manualHubUnits`, which still come from getApCredits/getApHub. If a
// student's real situation would also change the credit amount (e.g. an
// advisor granting a different number of credits than the standard chart),
// that's a separate, out-of-scope problem — this field isn't meant to
// re-negotiate credit totals, only to record a course mapping.
export function normalizeExternalCredit(credit) {
  if (!credit || typeof credit !== 'object') return null;

  const type = normalizeType(credit.type, credit.institution ? 'transfer' : undefined);
  const courseKey = normalizeCourseKey(credit.courseKey);
  const manualCourses = normalizeManualCourses(credit.manualCourses);
  // manualCourseKey and manualCourses are mutually exclusive, same as the
  // auto-resolved courseKey/courses pair — a multi-course override doesn't
  // also carry a (redundant, differently-shaped) single manualCourseKey.
  const manualCourseKey = manualCourses ? null : normalizeCourseKey(credit.manualCourseKey);
  const advisorNote = normalizeAdvisorNote(credit.advisorNote);
  const id = normalizeCreditId(credit.id) || createExternalCreditId();

  const normalized = {
    ...credit,
    id,
    type,
    courseKey,
    manualCourseKey,
    manualCourses,
    advisorNote,
    status: normalizeStatus(type, credit.status, courseKey),
  };

  if (type === 'transfer' && !normalized.sourceTitle) {
    normalized.sourceTitle = normalized.title || 'Transfer Credit';
  }

  if (TEST_TYPES.has(type) && normalized.testSubject) {
    normalized.testSubject = String(normalized.testSubject).trim();
  }

  return normalized;
}

export function normalizeExternalCredits(rawExternalCredits) {
  if (Array.isArray(rawExternalCredits)) {
    return rawExternalCredits
      .map((credit) => normalizeExternalCredit(credit))
      .filter(Boolean);
  }

  if (!rawExternalCredits || typeof rawExternalCredits !== 'object') {
    return [];
  }

  const grouped = [];
  for (const [groupType, entries] of Object.entries(rawExternalCredits)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      grouped.push({ ...entry, type: entry?.type || groupType });
    }
  }

  return grouped
    .map((credit) => normalizeExternalCredit(credit))
    .filter(Boolean);
}
