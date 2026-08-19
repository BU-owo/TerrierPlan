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

// BU never grants IB credit below a 5, regardless of exam — fixed and
// small enough for a dropdown. AP's equivalent range is per-exam (most
// exams aren't score-dependent at all) and is derived from AP_HUB_CREDIT's
// byScore keys below rather than hardcoded here.
const IB_SCORE_OPTIONS = [5, 6, 7];

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
// spaces (e.g. "CASMA123") — this is display-only, purely cosmetic.
function formatCourseKeyDisplay(courseKey) {
  const m = String(courseKey).match(/^([A-Z]{3})([A-Z]{2})(\d+)$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : courseKey;
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

const AddExternalCreditForm = memo(function AddExternalCreditForm({ onAdd, onCancel }) {
  const [examType, setExamType] = useState('ap');
  const [subject, setSubject] = useState('');
  const [level, setLevel] = useState('');
  const [score, setScore] = useState('');
  const [error, setError] = useState('');

  const subjectOptions = examType === 'ap' ? AP_EXAM_SUBJECTS : IB_EXAM_SUBJECTS;
  // IB HUB resolution always needs a score (getIbHub requires one to return
  // anything but null), so IB never skips the score field the way most AP
  // exams do — only Biology, Latin, and Calculus BC vary by AP score.
  const scoreDependent = examType === 'ib' ? true : Boolean(subject && isApScoreDependent(subject));
  // Derived straight from the data (never a hardcoded 1-5/4-5 range): for
  // AP this is exactly the score keys the exam's byScore object models —
  // e.g. Calc BC only lists 4 and 5, so that's all that's offered here.
  const apByScoreKeys = examType === 'ap' && subject && AP_HUB_CREDIT[subject]?.byScore
    ? Object.keys(AP_HUB_CREDIT[subject].byScore).map(Number).sort((a, b) => a - b)
    : null;
  const scoreOptions = examType === 'ib' ? IB_SCORE_OPTIONS : (apByScoreKeys || []);
  const restrictedApScoreRange = examType === 'ap' && apByScoreKeys && Math.min(...apByScoreKeys) > 1;

  const scoreValue = score === '' ? null : Number(score);
  const isHigherLevel = examType === 'ib' ? level === 'hl' : undefined;

  const ibReady = examType === 'ib' && level === 'hl' && scoreValue != null;
  const apReady = examType === 'ap' && subject && (!scoreDependent || scoreValue != null);

  // Same resolution the panel already uses to render imported AP/IB rows
  // (see testHub in the main component below) — reused here so a
  // manually-added row lands in exactly the same auto-resolved /
  // needs-review state, and shows exactly the same credits/course, as an
  // imported one would.
  const resolvedCredits = examType === 'ib'
    ? (ibReady ? getIbCredits(subject, scoreValue, isHigherLevel) : null)
    : (apReady ? getApCredits(subject, scoreDependent ? scoreValue : undefined) : null);
  const resolvedCourseInfo = examType === 'ib'
    ? (ibReady ? getIbCourseInfo(subject, scoreValue, isHigherLevel) : null)
    : (apReady ? getApCourseInfo(subject, scoreDependent ? scoreValue : undefined) : null);

  let previewText = null;
  if (subject) {
    if (examType === 'ib' && !level) {
      previewText = 'Select HL or SL to see credit details.';
    } else if (examType === 'ib' && level === 'sl') {
      previewText = "IB Standard Level exams don't earn BU credit.";
    } else if (scoreDependent && scoreValue == null) {
      previewText = 'Select a score to see credit details.';
    } else if (resolvedCredits == null) {
      previewText = 'Not eligible for BU credit at that score — contact BU Academic Advising.';
    } else {
      previewText = formatCreditsPreview(resolvedCredits, resolvedCourseInfo);
    }
  }

  function handleTypeChange(nextType) {
    setExamType(nextType);
    setSubject('');
    setLevel('');
    setScore('');
    setError('');
  }

  function handleSubjectChange(nextSubject) {
    setSubject(nextSubject);
    setScore('');
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!subject) {
      setError('Choose an exam.');
      return;
    }
    if (examType === 'ib' && !level) {
      setError('Choose HL or SL.');
      return;
    }
    if (resolvedCredits == null) {
      setError('This exam/score combination isn’t resolved to BU credit yet.');
      return;
    }

    const hubUnits = examType === 'ib'
      ? getIbHub(subject, scoreValue, isHigherLevel)
      : (scoreDependent ? getApHub(subject, scoreValue) : getApHub(subject));

    const entry = normalizeExternalCredit({
      type: examType,
      testSubject: subject,
      sourceTitle: `${examType.toUpperCase()} ${formatSubjectLabel(subject)}`,
      credits: resolvedCredits,
      courseKey: resolveCourseKeyForEntry(resolvedCourseInfo),
      score: scoreValue,
      ...(examType === 'ib' ? { isHigherLevel } : {}),
      manualHubUnits: Array.isArray(hubUnits) ? hubUnits : undefined,
      status: hubUnits === null ? 'needs_review' : 'auto_hub_resolved',
    });

    onAdd(entry);
  }

  return (
    <form className="external-credit-add-form" onSubmit={handleSubmit}>
      <div className="external-credit-add-row external-credit-type-toggle">
        <button
          type="button"
          className={`import-chip-btn ${examType === 'ap' ? 'active' : ''}`}
          onClick={() => handleTypeChange('ap')}
        >
          AP
        </button>
        <button
          type="button"
          className={`import-chip-btn ${examType === 'ib' ? 'active' : ''}`}
          onClick={() => handleTypeChange('ib')}
        >
          IB
        </button>
      </div>

      <div className="external-credit-add-row">
        <label>
          Exam
          <select value={subject} onChange={(e) => handleSubjectChange(e.target.value)}>
            <option value="">Select exam…</option>
            {subjectOptions.map((key) => (
              <option key={key} value={key}>{formatSubjectLabel(key)}</option>
            ))}
          </select>
        </label>
      </div>

      {examType === 'ib' && (
        <div className="external-credit-add-row">
          <label>
            Level
            <select value={level} onChange={(e) => { setLevel(e.target.value); setScore(''); }}>
              <option value="">Select level…</option>
              <option value="hl">Higher Level (HL)</option>
              <option value="sl">Standard Level (SL)</option>
            </select>
          </label>
        </div>
      )}

      {/* SL never earns BU credit, so there's no score to ask for until HL is chosen. */}
      {subject && scoreDependent && (examType === 'ap' || level === 'hl') && (
        <div className="external-credit-add-row external-credit-add-score-row">
          <label>
            Score
            <select value={score} onChange={(e) => setScore(e.target.value)}>
              <option value="">—</option>
              {scoreOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          {restrictedApScoreRange && (
            <p className="external-credit-score-note">
              Scored below what's listed? Credit may depend on additional factors — contact BU Academic Advising directly.
            </p>
          )}
        </div>
      )}

      {previewText && (
        <div className="external-credit-add-preview">{previewText}</div>
      )}

      {error && <div className="external-credit-warning">{error}</div>}

      <div className="external-credit-add-actions">
        <button type="submit" className="import-primary-btn" disabled={resolvedCredits == null}>
          Add credit
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

export default function ExternalCreditsPanel({ externalCredits, onRemove, onUpdate, onAdd }) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingScoreCreditId, setEditingScoreCreditId] = useState(null);
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
          const needsMapping = type === 'transfer' && (normalized.status === 'needs_mapping' || !normalized.courseKey);
          const needsApReview = (type === 'ib' && testHub === null) || (type === 'ap' && testHub === null && !apScoreDependent);
          const needsReview = needsMapping || needsApReview;
          return (
          <li
            key={creditId}
            className={`external-credit-row ${needsReview ? 'needs-review' : ''}`}
          >
            <div className="external-credit-main">
              <span className={`external-credit-type type-${type}`}>
                {type === 'ap' ? 'AP' : type === 'ib' ? 'IB' : 'Transfer'}
              </span>
              <div>
                <div className="external-credit-title">
                  {normalized.courseKey || 'Unmapped'} · {normalized.sourceTitle}
                </div>
                <div className="external-credit-meta">
                  {normalized.testSubject && <span>{normalized.testSubject}</span>}
                  {normalized.score != null && <span>Score {normalized.score}</span>}
                  {normalized.institution && <span>{normalized.institution}</span>}
                  <span>{normalized.credits} cr</span>
                  {apScoreDependent && normalized.score != null && (
                    <button
                      type="button"
                      className="external-credit-score-edit-btn"
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
                {isTestCredit && Array.isArray(testHub) && (
                  <div className="external-credit-hub">
                    {testHub.length > 0 ? `HUB: ${testHub.join(' · ')}` : 'No HUB confirmed'}
                  </div>
                )}
              </div>
            </div>
            {onRemove && (
              <button
                type="button"
                className="external-credit-remove"
                onClick={() => onRemove(creditId)}
                aria-label="Remove external credit"
              >
                ×
              </button>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
