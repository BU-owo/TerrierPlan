const TEST_TYPES = new Set(['ap', 'ib']);

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

function normalizeStatus(type, status, courseKey) {
  if (type !== 'transfer') return status || undefined;
  if (status === 'mapped' || status === 'needs_mapping') return status;
  return courseKey ? 'mapped' : 'needs_mapping';
}

export function normalizeExternalCredit(credit) {
  if (!credit || typeof credit !== 'object') return null;

  const type = normalizeType(credit.type, credit.institution ? 'transfer' : undefined);
  const courseKey = normalizeCourseKey(credit.courseKey);

  const normalized = {
    ...credit,
    type,
    courseKey,
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
