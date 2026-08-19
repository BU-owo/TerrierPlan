import { memo, useEffect, useRef, useState } from 'react';
import {
  AP_EXAM_SUBJECTS,
  AP_HUB_CREDIT,
  IB_EXAM_SUBJECTS,
  getApCourseInfo,
  getApCredits,
  getApHub,
  getIbCourseInfo,
  getIbCredits,
  getIbHub,
  isApScoreDependent,
} from '../../data/apIbHubCredit';
import { HUB_LABELS } from '../../utils/hubConstants';
import { normalizeExternalCredit } from '../../utils/externalCredits';
import { resolveApHubFromScore } from '../../utils/apScoreResolution';

const DEBUG_EXTERNAL_CREDITS = import.meta.env.DEV;

function debugExternalCredits(stage, payload) {
  if (!DEBUG_EXTERNAL_CREDITS) return;
  console.log(`[DEBUG ExternalCreditsPanel] ${stage}`, payload);
}

// The add form doesn't collect an IB score at all — BU only grants IB
// credit for HL scored 5-7, and credits/course are identical across that
// range (verified against the source chart), so any value in [5,7] would
// resolve identically. This fixed value is what getIbCredits/getIbCourseInfo
// /getIbHub are called with internally.
const IB_SCORE = 5;

// AP_EXAM_SUBJECTS / IB_EXAM_SUBJECTS keys are normalize()-safe lowercase
// word strings (e.g. "calculus ab"), not display text — title-case them for
// the dropdown, with a couple of exceptions normal title-casing gets wrong.
const KEEP_LOWERCASE_WORDS = new Set(['and', 'the', 'of']);
const KEEP_UPPERCASE_WORDS = new Set(['ab', 'bc']);

function formatSubjectLabel(key) {
  return key
    .split(' ')
    .map((word, i) => {
      if (KEEP_UPPERCASE_WORDS.has(word)) return word.toUpperCase();
      if (i > 0 && KEEP_LOWERCASE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

// courseKey convention throughout the app is school+dept+number with no
// spaces (e.g. "CASMA123") — shared by the display formatter below and by
// the manual-override input's format validation.
const COURSE_KEY_PATTERN = /^([A-Z]{3})([A-Z]{2})(\d+)$/;

function formatCourseKeyDisplay(courseKey) {
  const m = String(courseKey).match(COURSE_KEY_PATTERN);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : courseKey;
}

// Format-only check for a manually-entered courseKey override — this is an
// exception path for a student typing in what their advisor told them, so
// it deliberately doesn't check the key is a *real* BU course, only that it
// looks like one (three-letter school + two-letter dept + course number).
function isValidCourseKeyFormat(rawValue) {
  return COURSE_KEY_PATTERN.test(String(rawValue).replace(/\s+/g, '').toUpperCase());
}

function formatCreditsPreview(credits, courseInfo) {
  if (credits == null) return null;
  const creditsLabel = `${credits} credit${credits === 1 ? '' : 's'}`;
  if (!courseInfo) return creditsLabel;
  if (courseInfo.courseNote) return `${creditsLabel} · ${courseInfo.courseNote}`;
  if (Array.isArray(courseInfo.courses) && courseInfo.courses.length) {
    return `${creditsLabel} · ${courseInfo.courses.map(formatCourseKeyDisplay).join(', ')}`;
  }
  if (courseInfo.courseKey) return `${creditsLabel} · ${formatCourseKeyDisplay(courseInfo.courseKey)}`;
  return creditsLabel;
}

// The credit entry's single `courseKey` field only gets a value when we
// have something unambiguous to put there: one confident course, or (for
// exams like Calc BC that require a specific multi-course sequence) every
// course in that sequence joined together. Anything with a courseNote
// means BU's own guide can't name a single confident answer either — that
// row should land "Unmapped" like a transcript row nobody's mapped yet,
// not silently guess at one option from an "or" list.
function resolveCourseKeyForEntry(courseInfo) {
  if (!courseInfo || courseInfo.courseNote) return null;
  if (courseInfo.courseKey) return courseInfo.courseKey;
  if (Array.isArray(courseInfo.courses) && courseInfo.courses.length) {
    return courseInfo.courses.join('+');
  }
  return null;
}

// The advisor-override affordance is only for BU's own chart being
// genuinely ambiguous at this exam/score (an "or" list, no fixed course,
// etc — i.e. getApCourseInfo/getIbCourseInfo came back with a courseNote
// and nothing else) — never for an exam BU's chart already answers
// unambiguously. Deliberately checks the raw courseInfo shape (courseKey
// AND courseNote), not just "is there a `courses` array" or any stored/
// cached field, and never branches on exam name or type — a `courses`
// sequence (e.g. Calc BC's CAS MA 123 + 124) is just as unambiguous as a
// single courseKey and must not offer this override either.
function isCourseNoteOnlyInfo(courseInfo) {
  return Boolean(courseInfo) && courseInfo.courseKey == null && courseInfo.courseNote != null;
}

let rowIdSeq = 0;
function createEmptyExamRow() {
  rowIdSeq += 1;
  return {
    id: `add-exam-row-${rowIdSeq}`, examType: 'ap', subject: '', score: '', subscore: '',
    // Same advisor-override annotation as CourseMappingOverrideEditor offers
    // on an already-added row — collected up front here so a courseNote-only
    // exam doesn't have to be added first and then edited. If the planned
    // checklist-style add UI (check off several exams at once) replaces this
    // form later, carry this same manualCourseKey/advisorNote pair-per-row
    // over rather than re-deriving the pattern — the fields themselves are
    // already part of the external-credit shape (utils/externalCredits.js),
    // so only the UI wiring needs to move.
    manualCourseKey: '', advisorNote: '',
  };
}

// Any of College Board's 1-5 AB subscore values are valid — this doesn't
// vary per exam (unlike the main score range), so it's not derived from
// the data the way scoreOptions is.
const AB_SUBSCORE_OPTIONS = [1, 2, 3, 4, 5];

// Resolves one row's exam/score(/subscore) selection to its credit outcome,
// purely from AP_HUB_CREDIT/IB_HUB_CREDIT data — nothing here branches on
// the exam's name, so a new exam only needs a data entry, never a UI
// change. That includes `subscoreRule`: any AP entry that has one gets the
// second "AB Subscore" dropdown automatically, not just Calculus BC.
// IB is hardcoded to isHigherLevel=true throughout: BU only ever grants IB
// credit for HL exams, so SL isn't collected as a state at all.
function resolveExamRow(row) {
  const { examType, subject, score, subscore } = row;
  if (!subject) {
    return {
      scoreDependent: false, scoreOptions: [], scoreNote: null,
      needsSubscore: false, subscoreOptions: [],
      resolvedCredits: null, resolvedCourseInfo: null, previewText: null,
      isCourseNoteOnly: false,
    };
  }

  const scoreValue = score === '' ? null : Number(score);

  if (examType === 'ib') {
    // BU only ever grants IB credit for HL exams scored 5-7, and per the
    // source chart the credit outcome (hub/credits/course) is identical
    // across that whole range — there's nothing for the score to change,
    // so it's not collected at all. IB_SCORE, not a user selection, feeds
    // getIbCredits/getIbCourseInfo/getIbHub as a fixed representative
    // value; only "is this exam eligible" (i.e. does a mapping exist)
    // varies row to row.
    const resolvedCredits = getIbCredits(subject, IB_SCORE, true);
    const resolvedCourseInfo = getIbCourseInfo(subject, IB_SCORE, true);
    return {
      scoreDependent: false,
      scoreOptions: [],
      scoreNote: 'Only Higher Level (HL) exams scored 5-7 earn BU credit.',
      needsSubscore: false,
      subscoreOptions: [],
      resolvedCredits,
      resolvedCourseInfo,
      previewText: resolvedCredits == null ? null : formatCreditsPreview(resolvedCredits, resolvedCourseInfo),
      isCourseNoteOnly: resolvedCredits != null && isCourseNoteOnlyInfo(resolvedCourseInfo),
    };
  }

  const entry = AP_HUB_CREDIT[subject];
  const byScoreKeys = entry?.byScore
    ? Object.keys(entry.byScore).map(Number).sort((a, b) => a - b)
    : null;
  const subscoreRule = entry?.subscoreRule || null;
  const scoreDependent = Boolean(byScoreKeys) || Boolean(subscoreRule);
  // The dropdown offers every score that resolves to *something* — the
  // exam's ordinary byScore keys, plus (for an exam like Calc BC) the
  // scores gated behind a subscore. Union, not just byScore, so a
  // subscoreRule-only score (e.g. Calc BC's 1-3) still shows up.
  const scoreOptions = scoreDependent
    ? Array.from(new Set([...(byScoreKeys || []), ...(subscoreRule?.appliesWhenScore || [])])).sort((a, b) => a - b)
    : [];
  const needsSubscore = Boolean(subscoreRule) && scoreValue != null && subscoreRule.appliesWhenScore.includes(scoreValue);
  const subscoreValue = subscore === '' || subscore == null ? null : Number(subscore);

  const ready = !scoreDependent
    ? true
    : scoreValue == null
      ? false
      : (!needsSubscore || subscoreValue != null);

  const resolvedCredits = ready
    ? getApCredits(subject, scoreDependent ? scoreValue : undefined, needsSubscore ? subscoreValue : undefined)
    : null;
  const resolvedCourseInfo = ready
    ? getApCourseInfo(subject, scoreDependent ? scoreValue : undefined, needsSubscore ? subscoreValue : undefined)
    : null;

  // An exam with its own subscoreRule resolves scores below the ordinary
  // byScore range directly (via the AB Subscore field below) rather than
  // needing this caveat — the note is still available for any other exam
  // that models a restricted score range without a way to resolve the rest.
  const scoreNote = !scoreDependent || subscoreRule
    ? null
    : entry?.apSubscoreCaveat
      ? "Only scores of 4-5 are shown — credit for lower scores depends on your AB subscore; contact BU Academic Advising directly."
      : 'Only scores of 4-5 earn BU credit.';

  let previewText = null;
  if (ready) {
    previewText = resolvedCredits === 0
      ? "0 cr — this combination doesn't earn BU credit."
      : resolvedCredits == null
        ? 'Not eligible for BU credit at that score — contact BU Academic Advising.'
        : formatCreditsPreview(resolvedCredits, resolvedCourseInfo);
  }

  return {
    scoreDependent,
    scoreOptions,
    scoreNote,
    needsSubscore,
    subscoreOptions: needsSubscore ? AB_SUBSCORE_OPTIONS : [],
    resolvedCredits,
    resolvedCourseInfo,
    previewText,
    // Only a genuinely credit-earning, courseNote-only result offers the
    // advisor override below — the 0-credit dead end (e.g. Calc BC with a
    // non-qualifying subscore) has no course to map in the first place.
    isCourseNoteOnly: resolvedCredits != null && resolvedCredits > 0 && isCourseNoteOnlyInfo(resolvedCourseInfo),
  };
}

const AddExternalCreditForm = memo(function AddExternalCreditForm({ onAdd, onCancel }) {
  const [rows, setRows] = useState(() => [createEmptyExamRow()]);
  const [error, setError] = useState('');

  function updateRow(id, patch) {
    setError('');
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, createEmptyExamRow()]);
  }

  function removeRow(id) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  const resolvedRows = rows.map((row) => ({ row, resolution: resolveExamRow(row) }));
  // A resolved-but-zero outcome (e.g. Calc BC score 1-3 with a
  // non-qualifying AB subscore) is a real, correct answer — not a gap —
  // but there's nothing meaningful to add to the plan for it, so it
  // doesn't count toward "Add N credits" or get submitted.
  const readyRows = resolvedRows.filter(({ resolution }) => resolution.resolvedCredits != null && resolution.resolvedCredits > 0);

  function handleSubmit(e) {
    e.preventDefault();
    if (readyRows.length === 0) {
      setError('Add at least one exam with a resolved score.');
      return;
    }

    const entries = readyRows.map(({ row, resolution }) => {
      const isIb = row.examType === 'ib';
      const scoreValue = row.score === '' ? null : Number(row.score);
      const subscoreValue = resolution.needsSubscore && row.subscore !== '' ? Number(row.subscore) : undefined;
      const hubUnits = isIb
        ? getIbHub(row.subject, IB_SCORE, true)
        : (resolution.scoreDependent ? getApHub(row.subject, scoreValue, subscoreValue) : getApHub(row.subject));

      // Advisor override only applies where auto-resolution came back
      // courseNote-only, and only carries through when the typed courseKey
      // is either blank or syntactically valid — an invalid one is silently
      // dropped rather than blocking the whole batch (the field itself
      // shows a validation error live, see the row JSX below).
      const trimmedManualKey = resolution.isCourseNoteOnly ? row.manualCourseKey.trim() : '';
      const manualCourseKey = trimmedManualKey && isValidCourseKeyFormat(trimmedManualKey) ? trimmedManualKey : undefined;
      const advisorNote = resolution.isCourseNoteOnly ? row.advisorNote.trim() || undefined : undefined;

      return normalizeExternalCredit({
        type: row.examType,
        testSubject: row.subject,
        sourceTitle: `${row.examType.toUpperCase()} ${formatSubjectLabel(row.subject)}`,
        credits: resolution.resolvedCredits,
        courseKey: resolveCourseKeyForEntry(resolution.resolvedCourseInfo),
        manualCourseKey,
        advisorNote,
        // IB doesn't collect a score at all (see resolveExamRow) — only
        // AP entries carry one.
        ...(isIb ? { isHigherLevel: true } : { score: scoreValue }),
        manualHubUnits: Array.isArray(hubUnits) ? hubUnits : undefined,
        status: hubUnits === null ? 'needs_review' : 'auto_hub_resolved',
      });
    });

    onAdd(entries);
    setRows([createEmptyExamRow()]);
    setError('');
  }

  return (
    <form className="external-credit-add-form" onSubmit={handleSubmit}>
      {resolvedRows.map(({ row, resolution }, index) => {
        const subjectOptions = row.examType === 'ap' ? AP_EXAM_SUBJECTS : IB_EXAM_SUBJECTS;
        return (
          <div className="external-credit-exam-row-block" key={row.id}>
            {rows.length > 1 && (
              <button
                type="button"
                className="external-credit-remove external-credit-exam-row-remove"
                onClick={() => removeRow(row.id)}
                aria-label={`Remove exam ${index + 1}`}
              >
                ×
              </button>
            )}

            <div className="external-credit-add-row external-credit-type-toggle">
              <button
                type="button"
                className={`import-chip-btn ${row.examType === 'ap' ? 'active' : ''}`}
                onClick={() => updateRow(row.id, { examType: 'ap', subject: '', score: '', subscore: '' })}
              >
                AP
              </button>
              <button
                type="button"
                className={`import-chip-btn ${row.examType === 'ib' ? 'active' : ''}`}
                onClick={() => updateRow(row.id, { examType: 'ib', subject: '', score: '', subscore: '' })}
              >
                IB
              </button>
            </div>

            <div className="external-credit-add-row">
              <label>
                Exam
                <select value={row.subject} onChange={(e) => updateRow(row.id, { subject: e.target.value, score: '', subscore: '' })}>
                  <option value="">Select exam…</option>
                  {subjectOptions.map((key) => (
                    <option key={key} value={key}>{formatSubjectLabel(key)}</option>
                  ))}
                </select>
              </label>
            </div>

            {row.subject && (resolution.scoreDependent || resolution.scoreNote) && (
              <div className="external-credit-add-row external-credit-add-score-row">
                <div className="external-credit-add-row">
                  {resolution.scoreDependent && (
                    <label>
                      Score
                      <select value={row.score} onChange={(e) => updateRow(row.id, { score: e.target.value, subscore: '' })}>
                        <option value="">—</option>
                        {resolution.scoreOptions.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {resolution.needsSubscore && (
                    <label>
                      AB Subscore
                      <select value={row.subscore} onChange={(e) => updateRow(row.id, { subscore: e.target.value })}>
                        <option value="">—</option>
                        {resolution.subscoreOptions.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {resolution.scoreNote && (
                  <p className="external-credit-score-note">{resolution.scoreNote}</p>
                )}
              </div>
            )}

            {resolution.previewText && (
              <div className="external-credit-add-preview">{resolution.previewText}</div>
            )}

            {resolution.isCourseNoteOnly && (
              <div className="external-credit-override-editor">
                Advisor-confirmed mapping (optional) — doesn't change the credits/HUB above
                <div className="external-credit-add-row">
                  <label className="external-credit-override-field">
                    Course key
                    <input
                      type="text"
                      placeholder="e.g. CAS BI 108"
                      value={row.manualCourseKey}
                      onChange={(e) => updateRow(row.id, { manualCourseKey: e.target.value })}
                    />
                  </label>
                  <label className="external-credit-override-field">
                    Advisor note
                    <input
                      type="text"
                      placeholder="e.g. granted elective credit only, no HUB"
                      value={row.advisorNote}
                      onChange={(e) => updateRow(row.id, { advisorNote: e.target.value })}
                    />
                  </label>
                </div>
                {row.manualCourseKey.trim() && !isValidCourseKeyFormat(row.manualCourseKey.trim()) && (
                  <p className="external-credit-override-error">
                    Course key should look like "CAS MA 123" — won't be saved until fixed.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className="external-credit-add-btn" onClick={addRow}>
        + Add another exam
      </button>

      {error && <div className="external-credit-warning">{error}</div>}

      <div className="external-credit-add-actions">
        <button type="submit" className="import-primary-btn" disabled={readyRows.length === 0}>
          Add {readyRows.length} credit{readyRows.length === 1 ? '' : 's'}
        </button>
        <button type="button" className="import-secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
});

const TransferExternalCreditRow = memo(function TransferExternalCreditRow({
  credit,
  creditId,
  onUpdate,
}) {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  if (DEBUG_EXTERNAL_CREDITS) {
    console.log('[DEBUG TransferExternalCreditRow] render', {
      creditId,
      sourceTitle: credit.sourceTitle,
      renderCount: renderCountRef.current,
      propCourseKey: credit.courseKey || '',
    });
  }

  const [courseKeyDraft, setCourseKeyDraft] = useState(credit.courseKey || '');

  useEffect(() => {
    setCourseKeyDraft(credit.courseKey || '');
  }, [credit.courseKey, credit.sourceTitle]);

  function commitCourseKey(nextValue) {
    onUpdate?.(creditId, {
      courseKey: nextValue.replace(/\s+/g, '').toUpperCase() || null,
      status: nextValue.trim() ? 'mapped' : 'needs_mapping',
    });
  }

  return (
    <div className="external-credit-warning">
      Needs BU equivalent — check MyBU
      <input
        type="text"
        aria-label={`BU equivalent for ${credit.sourceTitle}`}
        placeholder="e.g. CASMA 225"
        value={courseKeyDraft}
        onChange={(e) => {
          const nextValue = e.target.value;
          if (DEBUG_EXTERNAL_CREDITS) {
            console.log('[DEBUG TransferExternalCreditRow] onChange', {
              creditId,
              sourceTitle: credit.sourceTitle,
              renderCount: renderCountRef.current,
              eventValue: nextValue,
              draftBeforeSet: courseKeyDraft,
              propBeforeCommit: credit.courseKey || '',
            });
          }
          setCourseKeyDraft(nextValue);
        }}
        onBlur={(e) => commitCourseKey(e.target.value)}
      />
    </div>
  );
});

// Manual course-mapping override for an AP/IB row whose auto-resolution
// came back courseNote-only ("Not mapped") — lets a student record what
// their advisor actually told them (a courseKey, a free-text note, or
// both) without this app pretending to know a single confident BU course.
// Persists through the same onUpdate path as every other row edit (score
// editing, transfer courseKey mapping, manual HUB confirmation) — no new
// write function. Purely an annotation: it never touches credits or
// manualHubUnits, which stay auto-resolved (see the header comment on
// normalizeExternalCredit in utils/externalCredits.js).
const CourseMappingOverrideEditor = memo(function CourseMappingOverrideEditor({ credit, creditId, onUpdate, onDone }) {
  const [courseKeyDraft, setCourseKeyDraft] = useState(credit.manualCourseKey || '');
  const [noteDraft, setNoteDraft] = useState(credit.advisorNote || '');
  const [formatError, setFormatError] = useState('');

  useEffect(() => {
    setCourseKeyDraft(credit.manualCourseKey || '');
    setNoteDraft(credit.advisorNote || '');
  }, [credit.manualCourseKey, credit.advisorNote]);

  function handleSave() {
    const trimmedKey = courseKeyDraft.trim();
    if (trimmedKey && !isValidCourseKeyFormat(trimmedKey)) {
      setFormatError('Course key should look like "CAS MA 123" — school, department, number.');
      return;
    }
    setFormatError('');
    onUpdate?.(creditId, {
      manualCourseKey: trimmedKey ? trimmedKey.replace(/\s+/g, '').toUpperCase() : null,
      advisorNote: noteDraft.trim() || null,
    });
    onDone?.();
  }

  function handleClear() {
    setCourseKeyDraft('');
    setNoteDraft('');
    setFormatError('');
    onUpdate?.(creditId, { manualCourseKey: null, advisorNote: null });
    onDone?.();
  }

  return (
    <div className="external-credit-override-editor">
      Advisor-confirmed mapping (optional) — doesn't change the auto-resolved credits or HUB units above
      <label className="external-credit-override-field">
        Course key
        <input
          type="text"
          aria-label={`Advisor-confirmed course for ${credit.sourceTitle}`}
          placeholder="e.g. CAS BI 108"
          value={courseKeyDraft}
          onChange={(e) => setCourseKeyDraft(e.target.value)}
        />
      </label>
      <label className="external-credit-override-field">
        Advisor note
        <input
          type="text"
          aria-label={`Advisor note for ${credit.sourceTitle}`}
          placeholder="e.g. granted elective credit only, no HUB"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
        />
      </label>
      {formatError && <p className="external-credit-override-error">{formatError}</p>}
      <div className="external-credit-score-actions">
        <button type="button" className="external-credit-score-btn" onClick={handleSave}>Save</button>
        {(credit.manualCourseKey || credit.advisorNote) && (
          <button type="button" className="external-credit-score-btn" onClick={handleClear}>Clear</button>
        )}
        <button type="button" className="external-credit-score-btn" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
});

export default function ExternalCreditsPanel({ externalCredits, onRemove, onUpdate, onAdd }) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingScoreCreditId, setEditingScoreCreditId] = useState(null);
  const [editingOverrideCreditId, setEditingOverrideCreditId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const credits = Array.isArray(externalCredits) ? externalCredits : [];
  debugExternalCredits('render-props', {
    collapsed,
    count: credits.length,
    transferCredits: credits.filter((c) => normalizeExternalCredit(c)?.type === 'transfer'),
    externalCredits: credits,
  });

  // Incoming students without a transcript yet are exactly who needs the
  // "Add External Credit" button, so the panel can't bail out just because
  // there's nothing imported to show — only skip it once collapsed.
  if (!credits.length && !onAdd) return null;

  if (collapsed) {
    return (
      <div className="plan-side-panel collapsed">
        <button type="button" className="plan-side-panel-expand" onClick={() => setCollapsed(false)}>
          External Credit · {credits.length} item{credits.length === 1 ? '' : 's'}
        </button>
      </div>
    );
  }

  return (
    <div className="plan-side-panel external-credits-panel">
      <div className="plan-side-panel-header">
        <div>
          <h3>External Credit</h3>
          <p className="plan-side-panel-sub">
            AP credit may count toward HUB; transfer credit never does
          </p>
        </div>
        <button
          type="button"
          className="plan-side-panel-collapse"
          onClick={() => setCollapsed(true)}
          title="Collapse"
        >
          −
        </button>
      </div>

      {onAdd && (
        showAddForm ? (
          <AddExternalCreditForm
            onAdd={(entry) => {
              onAdd(entry);
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <button
            type="button"
            className="external-credit-add-btn"
            onClick={() => setShowAddForm(true)}
          >
            + Add External Credit
          </button>
        )
      )}

      {credits.length === 0 && !showAddForm && (
        <p className="plan-side-panel-sub external-credit-empty">
          No AP or IB scores added yet — self-report one above, no transcript needed.
        </p>
      )}

      <ul className="external-credits-list">
        {credits.map((ec, i) => {
          const normalized = normalizeExternalCredit(ec) || ec;
          const creditId = normalized.id || `fallback-${i}`;
          const type = normalized.type;
          const apScoreDependent = type === 'ap' && isApScoreDependent(normalized.testSubject);
          const isTestCredit = type === 'ap' || type === 'ib';
          const testHub = isTestCredit
            ? (Array.isArray(normalized.manualHubUnits)
              ? normalized.manualHubUnits
              : type === 'ib'
                ? getIbHub(normalized.testSubject, normalized.score, normalized.isHigherLevel)
                : apScoreDependent
                  ? getApHub(normalized.testSubject, normalized.score)
                  : getApHub(normalized.testSubject))
            : null;
          const hasKnownApScorePath = apScoreDependent
            && testHub === null
            && normalized.score == null;
          const showScoreEditor = apScoreDependent && (hasKnownApScorePath || editingScoreCreditId === creditId);
          // Manual course-mapping override is only for genuine ambiguity in
          // BU's own chart (courseNote, no courseKey) — never for an exam
          // that already resolves to a confident course (e.g. AP French at
          // score 4 -> CASLF212, AP US Gov -> CASPO111). Recomputed fresh
          // via getApCourseInfo/getIbCourseInfo rather than trusting the
          // stored courseKey alone, and gated on the courseInfo shape
          // itself (see isCourseNoteOnlyInfo) — never on exam name or type.
          // IB doesn't store a score on rows this app creates (see IB_SCORE
          // above), so it falls back to that same fixed representative
          // score, which resolves identically to any real 5-7.
          const courseMappingInfo = isTestCredit
            ? (type === 'ib'
              ? getIbCourseInfo(normalized.testSubject, normalized.score ?? IB_SCORE, normalized.isHigherLevel ?? true)
              : getApCourseInfo(normalized.testSubject, normalized.score))
            : null;
          const canOverrideCourseMapping = isTestCredit && !normalized.courseKey && isCourseNoteOnlyInfo(courseMappingInfo);
          const showOverrideEditor = canOverrideCourseMapping && editingOverrideCreditId === creditId;
          const needsMapping = type === 'transfer' && (normalized.status === 'needs_mapping' || !normalized.courseKey);
          const needsApReview = (type === 'ib' && testHub === null) || (type === 'ap' && testHub === null && !apScoreDependent);
          const needsReview = needsMapping || needsApReview;
          return (
          <li
            key={creditId}
            className={`external-credit-row ${needsReview ? 'needs-review' : ''}`}
          >
            <div className="external-credit-main">
              <div className="external-credit-badges">
                <span className={`external-credit-type type-${type}`}>
                  {type === 'ap' ? 'AP' : type === 'ib' ? 'IB' : 'Transfer'}
                </span>
              </div>
              <div className="external-credit-body">
                <div className="external-credit-title">
                  {normalized.sourceTitle}
                  {normalized.courseKey ? (
                    <>
                      {' · '}
                      <span className="external-credit-course-code">{normalized.courseKey}</span>
                    </>
                  ) : normalized.manualCourseKey ? (
                    <>
                      {' · '}
                      <span className="external-credit-course-code">{normalized.manualCourseKey}</span>
                      <span className="external-credit-manual-tag">manual</span>
                    </>
                  ) : isTestCredit ? (
                    <>
                      {' · '}
                      <span className="external-credit-unmapped-tag">Not mapped</span>
                    </>
                  ) : null}
                  {canOverrideCourseMapping && (
                    <button
                      type="button"
                      className="external-credit-override-link"
                      onClick={() => setEditingOverrideCreditId((prev) => (prev === creditId ? null : creditId))}
                    >
                      {(normalized.manualCourseKey || normalized.advisorNote) ? 'Edit override' : 'Add advisor note / override'}
                    </button>
                  )}
                </div>
                <div className="external-credit-meta">
                  {normalized.score != null && <span>Score {normalized.score}</span>}
                  {normalized.institution && <span>{normalized.institution}</span>}
                  <span>{normalized.credits} cr</span>
                  {isTestCredit && Array.isArray(testHub) && (
                    <span className="external-credit-hub">
                      {testHub.length > 0 ? `HUB: ${testHub.join(' · ')}` : 'No HUB confirmed'}
                    </span>
                  )}
                  {normalized.advisorNote && (
                    <span className="external-credit-advisor-note">Note: {normalized.advisorNote}</span>
                  )}
                  {apScoreDependent && normalized.score != null && (
                    <button
                      type="button"
                      className="external-credit-score-edit-link"
                      onClick={() => setEditingScoreCreditId((prev) => (prev === creditId ? null : creditId))}
                    >
                      Edit score
                    </button>
                  )}
                </div>
                {needsMapping && (
                  <TransferExternalCreditRow
                    credit={normalized}
                    creditId={creditId}
                    onUpdate={onUpdate}
                  />
                )}
                {showOverrideEditor && (
                  <CourseMappingOverrideEditor
                    credit={normalized}
                    creditId={creditId}
                    onUpdate={onUpdate}
                    onDone={() => setEditingOverrideCreditId(null)}
                  />
                )}
                {showScoreEditor && (
                  <div className="external-credit-warning external-credit-score-picker">
                    Select AP score to resolve HUB units
                    <label className="external-credit-score-label">
                      Score
                      <select
                        className="external-credit-score-select"
                        value={normalized.score ?? ''}
                        onChange={(e) => {
                          const resolved = resolveApHubFromScore(normalized.testSubject, e.target.value);
                          onUpdate?.(creditId, {
                            score: resolved.score,
                            manualHubUnits: Array.isArray(resolved.hubUnits) ? resolved.hubUnits : undefined,
                            status: resolved.score == null ? 'needs_review' : 'auto_hub_resolved',
                          });
                        }}
                      >
                        <option value="">—</option>
                        {[1, 2, 3, 4, 5].map((scoreOption) => (
                          <option key={scoreOption} value={scoreOption}>{scoreOption}</option>
                        ))}
                      </select>
                    </label>
                    <div className="external-credit-score-actions">
                      <button
                        type="button"
                        className="external-credit-score-btn"
                        onClick={() => setEditingScoreCreditId(null)}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
                {needsApReview && (
                  <div className="external-credit-warning">
                    Needs manual HUB review — exam or score could not be resolved
                    <label className="external-credit-hub-picker">
                      HUB units that BU confirmed
                      <select
                        multiple
                        value={ec.manualHubUnits || []}
                        onChange={(e) => onUpdate?.(creditId, {
                          manualHubUnits: Array.from(e.target.selectedOptions, (option) => option.value),
                          status: 'manual_hub_confirmed',
                        })}
                      >
                        {Object.entries(HUB_LABELS).map(([code, label]) => (
                          <option key={code} value={code}>{code} — {label}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="external-credit-no-hub"
                      onClick={() => onUpdate?.(creditId, {
                        manualHubUnits: [],
                        status: 'no_hub_confirmed',
                      })}
                    >
                      Confirm no HUB
                    </button>
                  </div>
                )}
              </div>
            </div>
            {onRemove && (
              <div className="external-credit-row-actions">
                <button
                  type="button"
                  className="external-credit-remove"
                  onClick={() => onRemove(creditId)}
                  aria-label="Remove external credit"
                >
                  ×
                </button>
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
