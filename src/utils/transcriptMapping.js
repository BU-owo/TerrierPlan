import { SEMESTER_LABELS } from './hubConstants';

const SEASON_ORDER = { spring: 0, summer: 1, fall: 2, winter: 3 };

function normalizeSeason(term) {
  const rawSeason = String(term.season ?? '').trim().toLowerCase();
  const rawMatch = rawSeason.match(/^(fall|spring|summer|winter)\b/);
  if (rawMatch) return rawMatch[1];

  // Keep imports made with an earlier parser version compatible even if its
  // season field contained the full term label (for example, "Fall 2020").
  const termMatch = String(term.term ?? '').match(/^(Fall|Spring|Summer|Winter)\b/i);
  return termMatch ? termMatch[1].toLowerCase() : null;
}

function termSortKey(term) {
  const m = term.term.match(/^(Fall|Spring|Summer|Winter)\s+(\d{4})$/i);
  if (!m) return 0;
  const year = parseInt(m[2], 10);
  const season = m[1].toLowerCase();
  // Academic ordering within a calendar year: Spring → Summer → Fall → Winter
  return year * 10 + (SEASON_ORDER[season] ?? 5);
}

/**
 * Map parsed transcript terms onto the 8-slot Fall/Spring grid + extraTerms.
 *
 * @param {object} parsed - result of parseTranscriptPdf
 * @param {string[][]} existingSemesters - current plan semesters (length 8)
 * @param {Array<{term, courseKeys}>} existingExtraTerms
 * @returns {{
 *   slotAssignments: Array<{slotIndex, slotLabel, term, courses}>,
 *   extraTermAssignments: Array<{term, season, isPostDegree, courses}>,
 *   conflicts: Array<{courseKey, title, term, targetKind, targetLabel, existingLocation, resolution}>,
 *   apCredits, transferCredits, meta
 * }}
 */
export function buildImportPreview(parsed, existingSemesters, existingExtraTerms = []) {
  const existingKeys = new Map(); // courseKey → { kind, label }
  (existingSemesters || []).forEach((sem, i) => {
    for (const key of sem) {
      existingKeys.set(key, { kind: 'slot', label: SEMESTER_LABELS[i] ?? `Slot ${i}` });
    }
  });
  for (const et of existingExtraTerms || []) {
    for (const key of et.courseKeys || []) {
      existingKeys.set(key, { kind: 'extra', label: et.term });
    }
  }

  const sorted = [...(parsed.terms || [])].map((term) => ({
    ...term,
    season: normalizeSeason(term),
  })).sort(
    (a, b) => termSortKey(a) - termSortKey(b),
  );

  const fallSpring = sorted.filter(
    (t) => t.season === 'fall' || t.season === 'spring',
  );
  const summerWinter = sorted.filter(
    (t) => t.season === 'summer' || t.season === 'winter',
  );

  const slotAssignments = [];
  const extraTermAssignments = [];
  let slotIndex = 0;

  for (const t of fallSpring) {
    if (slotIndex < 8 && !t.isPostDegree) {
      slotAssignments.push({
        slotIndex,
        slotLabel: SEMESTER_LABELS[slotIndex],
        term: t.term,
        season: t.season,
        isPostDegree: false,
        courses: t.courses,
      });
      slotIndex += 1;
    } else {
      // Overflow or post-degree Fall/Spring → extraTerms (still HUB-counting)
      extraTermAssignments.push({
        term: t.term,
        season: t.season,
        isPostDegree: true,
        courses: t.courses,
      });
    }
  }

  for (const t of summerWinter) {
    extraTermAssignments.push({
      term: t.term,
      season: t.season,
      isPostDegree: !!t.isPostDegree,
      courses: t.courses,
    });
  }

  const conflicts = [];

  function addConflicts(courses, targetKind, targetLabel) {
    for (const c of courses) {
      const existing = existingKeys.get(c.courseKey);
      if (!existing) continue;
      conflicts.push({
        id: `${c.courseKey}::${c.term}`,
        courseKey: c.courseKey,
        title: c.title,
        term: c.term,
        targetKind,
        targetLabel,
        existingLocation: existing.label,
        resolution: 'skip', // default: don't duplicate
      });
    }
  }

  for (const a of slotAssignments) {
    addConflicts(a.courses, 'slot', a.slotLabel);
  }
  for (const a of extraTermAssignments) {
    addConflicts(a.courses, 'extra', a.term);
  }

  return {
    slotAssignments,
    extraTermAssignments,
    conflicts,
    apCredits: parsed.apCredits || [],
    transferCredits: (parsed.transferCredits || []).map((t, i) => ({
      ...t,
      id: `tr-${i}`,
      courseKey: '',
      creditsEdit: t.credits,
    })),
    meta: parsed.meta || {},
  };
}

/**
 * Apply review resolutions and produce the merged plan payload.
 *
 * @param {object} preview - from buildImportPreview (with mutated resolutions / transfer edits)
 * @param {string[][]} existingSemesters
 * @param {Array} existingExtraTerms
 * @param {Array} existingExternalCredits
 */
export function applyImport(preview, existingSemesters, existingExtraTerms = [], existingExternalCredits = []) {
  const resolutionById = new Map(
    (preview.conflicts || []).map((c) => [c.id, c.resolution]),
  );

  const semesters = (existingSemesters || Array.from({ length: 8 }, () => [])).map(
    (s) => [...s],
  );

  // Start from existing extra terms (deep copy)
  const extraMap = new Map();
  for (const et of existingExtraTerms || []) {
    extraMap.set(et.term, {
      term: et.term,
      season: et.season,
      courseKeys: [...(et.courseKeys || [])],
      isPostDegree: !!et.isPostDegree,
    });
  }

  let coursesAdded = 0;
  let summerWinterAdded = 0;
  let skipped = 0;

  function resolveCourse(course, addFn) {
    const id = `${course.courseKey}::${course.term}`;
    const conflict = resolutionById.has(id);
    const resolution = resolutionById.get(id) || 'add';

    if (conflict && resolution === 'skip') {
      skipped += 1;
      return;
    }
    if (conflict && resolution === 'keep') {
      // Leave existing placement; do not add a duplicate
      skipped += 1;
      return;
    }
    if (conflict && resolution === 'replace') {
      // Remove the key from wherever it currently lives, then add at target
      for (const sem of semesters) {
        const idx = sem.indexOf(course.courseKey);
        if (idx !== -1) sem.splice(idx, 1);
      }
      for (const et of extraMap.values()) {
        et.courseKeys = et.courseKeys.filter((k) => k !== course.courseKey);
      }
    }

    // Avoid duplicate within target
    addFn(course.courseKey);
  }

  for (const a of preview.slotAssignments || []) {
    for (const course of a.courses) {
      resolveCourse(course, (key) => {
        if (!semesters[a.slotIndex].includes(key)) {
          semesters[a.slotIndex].push(key);
          coursesAdded += 1;
        }
      });
    }
  }

  for (const a of preview.extraTermAssignments || []) {
    if (!extraMap.has(a.term)) {
      extraMap.set(a.term, {
        term: a.term,
        season: a.season,
        courseKeys: [],
        isPostDegree: !!a.isPostDegree,
      });
    }
    const et = extraMap.get(a.term);
    et.isPostDegree = et.isPostDegree || !!a.isPostDegree;
    for (const course of a.courses) {
      resolveCourse(course, (key) => {
        if (!et.courseKeys.includes(key)) {
          et.courseKeys.push(key);
          coursesAdded += 1;
          if (a.season === 'summer' || a.season === 'winter') {
            summerWinterAdded += 1;
          }
        }
      });
    }
  }

  const extraTerms = [...extraMap.values()].filter((et) => et.courseKeys.length > 0);

  // External credits: keep existing + add AP + transfers (including rows the
  // student can map later in the Planner).
  const externalCredits = [...(existingExternalCredits || [])];
  let apAdded = 0;
  let transferAdded = 0;
  let transferIncomplete = 0;

  for (const ap of preview.apCredits || []) {
    if (!ap.courseKey) continue;
    const dup = externalCredits.some(
      (e) => e.type === 'ap' && e.courseKey === ap.courseKey,
    );
    if (dup) continue;
    externalCredits.push({
      type: 'ap',
      sourceTitle: ap.title || ap.testSubject,
      courseKey: ap.courseKey,
      credits: ap.credits,
      testSubject: ap.testSubject,
      score: ap.score ?? null,
    });
    apAdded += 1;
  }

  for (const tr of preview.transferCredits || []) {
    const key = (tr.courseKey || '').replace(/\s+/g, '').toUpperCase();
    const dup = externalCredits.some(
      (e) => e.type === 'transfer'
        && e.sourceTitle === tr.title
        && e.institution === tr.institution
        && (e.courseKey || '') === key,
    );
    if (dup) continue;
    externalCredits.push({
      type: 'transfer',
      sourceTitle: tr.title,
      courseKey: key || null,
      credits: Number(tr.creditsEdit ?? tr.credits) || 0,
      institution: tr.institution,
      status: key ? 'mapped' : 'needs_mapping',
    });
    if (key) transferAdded += 1;
    else transferIncomplete += 1;
  }

  const meta = preview.meta || {};

  return {
    semesters,
    extraTerms,
    externalCredits,
    cumulativeGpa: meta.cumulativeGpa ?? null,
    earnedCredits: meta.earnedCredits ?? null,
    gradePoints: meta.gradePoints ?? null,
    summary: {
      coursesAdded,
      summerWinterAdded,
      apAdded,
      transferAdded,
      transferIncomplete,
      skipped,
    },
  };
}
