import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { parseTranscriptPdf } from '../../utils/transcriptParser';
import { buildImportPreview, applyImport } from '../../utils/transcriptMapping';
import { SEMESTER_LABELS } from '../../utils/hubConstants';
import { resolveApHubFromScore } from '../../utils/apScoreResolution';

const STEPS = ['Upload', 'Review', 'Confirm'];
const DEBUG_IMPORT = true;

function debugImportModal(stage, payload) {
  if (!DEBUG_IMPORT) return;
  console.log(`[DEBUG ImportTranscriptModal] ${stage}`, payload);
}

const TransferCreditReviewRow = memo(function TransferCreditReviewRow({ transferCredit, onUpdate }) {
  const [courseKeyDraft, setCourseKeyDraft] = useState(transferCredit.courseKey || '');
  const [creditsDraft, setCreditsDraft] = useState(String(transferCredit.creditsEdit ?? transferCredit.credits ?? ''));

  useEffect(() => {
    setCourseKeyDraft(transferCredit.courseKey || '');
  }, [transferCredit.id, transferCredit.courseKey]);

  useEffect(() => {
    setCreditsDraft(String(transferCredit.creditsEdit ?? transferCredit.credits ?? ''));
  }, [transferCredit.id, transferCredit.creditsEdit, transferCredit.credits]);

  function handleCourseKeyChange(nextValue) {
    setCourseKeyDraft(nextValue);
    onUpdate(transferCredit.id, { courseKey: nextValue });
  }

  function handleCreditsChange(nextValue) {
    setCreditsDraft(nextValue);
    onUpdate(transferCredit.id, { creditsEdit: nextValue });
  }

  return (
    <li className="import-transfer-row">
      <div className="import-row-main">
        <strong>{transferCredit.title}</strong>
        <span className="import-muted">{transferCredit.institution}</span>
      </div>
      <div className="import-transfer-fields">
        <label>
          Equivalent
          <input
            type="text"
            placeholder="e.g. CASMA 225"
            value={courseKeyDraft}
            onChange={(e) => handleCourseKeyChange(e.target.value)}
          />
        </label>
        <label>
          Credits
          <input
            type="number"
            min="0"
            step="0.5"
            value={creditsDraft}
            onChange={(e) => handleCreditsChange(e.target.value)}
          />
        </label>
      </div>
    </li>
  );
});

export default function ImportTranscriptModal({
  open,
  onClose,
  semesters,
  extraTerms,
  externalCredits,
  onImport,
}) {
  const [step, setStep] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showIncompleteTransferWarning, setShowIncompleteTransferWarning] = useState(false);
  const inputRef = useRef(null);

  const resetReview = useCallback(() => {
    setPreview(null);
    setSummary(null);
    setError('');
  }, []);

  function handleClose() {
    setStep(0);
    setParsing(false);
    setError('');
    setFileName('');
    setPreview(null);
    setImporting(false);
    setSummary(null);
    setDragOver(false);
    setShowIncompleteTransferWarning(false);
    onClose();
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF transcript.');
      return;
    }
    resetReview();
    setFileName(file.name);
    setParsing(true);
    setError('');
    try {
      const parsed = await parseTranscriptPdf(file);
      debugImportModal('handleFile-parsed', {
        apCredits: parsed?.apCredits || [],
        transferCredits: parsed?.transferCredits || [],
      });
      const built = buildImportPreview(parsed, semesters, extraTerms);
      debugImportModal('handleFile-preview-built', {
        transferCredits: built?.transferCredits || [],
        apCredits: built?.apCredits || [],
      });
      setPreview(built);
      setStep(1);
    } catch (err) {
      console.error(err);
      setError('Could not parse that PDF. Make sure it is an unofficial BU transcript.');
      setPreview(null);
    } finally {
      setParsing(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function setConflictResolution(id, resolution) {
    setPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        conflicts: prev.conflicts.map((c) =>
          c.id === id ? { ...c, resolution } : c,
        ),
      };
    });
  }

  function updateTransfer(id, patch) {
    setShowIncompleteTransferWarning(false);
    setPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        transferCredits: prev.transferCredits.map((t) =>
          t.id === id ? { ...t, ...patch } : t,
        ),
      };
    });
  }

  function updateApScore(id, scoreValue) {
    setPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        apCredits: prev.apCredits.map((ap) => {
          if (ap.id !== id) return ap;
          const resolved = resolveApHubFromScore(ap.testSubject, scoreValue);
          return {
            ...ap,
            score: resolved.score,
            resolvedHubUnits: resolved.hubUnits,
          };
        }),
      };
    });
  }

  async function handleImport() {
    if (!preview) return;
    debugImportModal('handleImport-preview-before-confirm', {
      transferCredits: preview.transferCredits,
      apCredits: preview.apCredits,
    });
    const incompleteTransferCount = preview.transferCredits.filter(
      (credit) => !(credit.courseKey || '').trim(),
    ).length;
    if (incompleteTransferCount > 0 && !showIncompleteTransferWarning) {
      setShowIncompleteTransferWarning(true);
      return;
    }
    setImporting(true);
    setError('');
    try {
      const result = applyImport(preview, semesters, extraTerms, externalCredits);
      debugImportModal('handleImport-applyImport-result', {
        transferCredits: result.externalCredits.filter((c) => c?.type === 'transfer'),
        externalCredits: result.externalCredits,
        summary: result.summary,
      });
      await onImport(result);
      setSummary(result.summary);
      setStep(2);
    } catch (err) {
      console.error(err);
      setError('Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  const regularCount = (preview?.slotAssignments || []).reduce(
    (n, a) => n + a.courses.length,
    0,
  );
  const extraCount = (preview?.extraTermAssignments || []).reduce(
    (n, a) => n + a.courses.length,
    0,
  );

  return (
    <div className="import-overlay" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
      <div className="import-modal">
        <div className="import-modal-header">
          <h2 id="import-modal-title">Import Transcript</h2>
          <button type="button" className="import-close-btn" onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="import-steps" aria-hidden="true">
          {STEPS.map((label, i) => (
            <div key={label} className={`import-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
              <span className="import-step-num">{i + 1}</span>
              <span className="import-step-label">{label}</span>
            </div>
          ))}
        </div>

        <div className="import-modal-body">
          {error && <p className="import-error">{error}</p>}

          {step === 0 && (
            <div
              className={`import-dropzone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {parsing ? (
                <p>Parsing transcript…</p>
              ) : (
                <>
                  <p className="import-dropzone-title">Drop your unofficial transcript PDF here</p>
                  <p className="import-dropzone-hint">or click to choose a file</p>
                  <p className="import-dropzone-hint">
                    Get it from MyBU → Academics → View Unofficial Transcript → View PDF, then download it.
                  </p>
                  {fileName && <p className="import-filename">{fileName}</p>}
                </>
              )}
            </div>
          )}

          {step === 1 && preview && (
            <div className="import-review">
              <div className="import-review-toolbar">
                <button
                  type="button"
                  className="import-secondary-btn"
                  onClick={() => { resetReview(); setStep(0); setFileName(''); }}
                >
                  ← Re-upload
                </button>
                <span className="import-review-counts">
                  {regularCount} Fall/Spring · {extraCount} Summer/Winter · {preview.apCredits.length} AP · {preview.transferCredits.length} transfer
                </span>
              </div>

              {preview.conflicts.length > 0 && (
                <section className="import-section">
                  <h3>Conflicts</h3>
                  <p className="import-section-note">
                    These courses are already in your plan. Choose skip, replace (move to transcript term), or keep both locations.
                  </p>
                  <ul className="import-list">
                    {preview.conflicts.map((c) => (
                      <li key={c.id} className="import-conflict-row">
                        <div className="import-row-main">
                          <strong>{c.courseKey}</strong>
                          <span className="import-muted">{c.title}</span>
                          <span className="import-muted">
                            {c.term} → {c.targetLabel} (now in {c.existingLocation})
                          </span>
                        </div>
                        <div className="import-conflict-actions">
                          {['skip', 'replace', 'keep'].map((r) => (
                            <button
                              key={r}
                              type="button"
                              className={`import-chip-btn ${c.resolution === r ? 'active' : ''}`}
                              onClick={() => setConflictResolution(c.id, r)}
                            >
                              {r === 'keep' ? 'keep both' : r}
                            </button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="import-section">
                <h3>Fall &amp; Spring (grid)</h3>
                {preview.slotAssignments.length === 0 && (
                  <p className="import-muted">No Fall/Spring courses with letter grades found.</p>
                )}
                {preview.slotAssignments.map((a) => (
                  <div key={a.term} className="import-term-block">
                    <div className="import-term-heading">
                      {a.term} → {a.slotLabel || SEMESTER_LABELS[a.slotIndex]}
                    </div>
                    <ul className="import-list compact">
                      {a.courses.map((c) => (
                        <li key={`${c.courseKey}-${c.term}`}>
                          <strong>{c.courseKey}</strong>
                          <span className="import-muted">{c.title}</span>
                          <span>{c.units} cr · {c.grade}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>

              <section className="import-section">
                <h3>Summer &amp; Winter (separate list)</h3>
                <p className="import-section-note">
                  These count toward HUB and credits but stay out of the 8-semester grid.
                </p>
                {preview.extraTermAssignments.length === 0 && (
                  <p className="import-muted">None found.</p>
                )}
                {preview.extraTermAssignments.map((a) => (
                  <div key={a.term} className="import-term-block">
                    <div className="import-term-heading">
                      {a.term}
                      {a.isPostDegree && <span className="import-badge">Post-degree</span>}
                    </div>
                    <ul className="import-list compact">
                      {a.courses.map((c) => (
                        <li key={`${c.courseKey}-${c.term}`}>
                          <strong>{c.courseKey}</strong>
                          <span className="import-muted">{c.title}</span>
                          <span>{c.units} cr · {c.grade}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>

              <section className="import-section">
                <h3>AP / Test Credit</h3>
                <p className="import-section-note">Set AP scores here (1-5). Eligible AP exams are evaluated against BU&apos;s AP HUB policy as you edit.</p>
                {preview.apCredits.length === 0 && <p className="import-muted">None found.</p>}
                <ul className="import-list compact">
                  {preview.apCredits.map((ap, i) => {
                    const resolvedHubUnits = Array.isArray(ap.resolvedHubUnits)
                      ? ap.resolvedHubUnits
                      : resolveApHubFromScore(ap.testSubject, ap.score).hubUnits;
                    return (
                    <li key={ap.id || `${ap.courseKey}-${i}`}>
                      <strong>{ap.courseKey}</strong>
                      <span className="import-muted">{ap.testSubject} — {ap.title}</span>
                      <span>{ap.credits} cr</span>
                      <label className="import-ap-score-field">
                        Score
                        <select
                          value={ap.score ?? ''}
                          onChange={(e) => updateApScore(ap.id, e.target.value)}
                          aria-label={`AP score for ${ap.testSubject}`}
                        >
                          <option value="">—</option>
                          {[1, 2, 3, 4, 5].map((scoreOption) => (
                            <option key={scoreOption} value={scoreOption}>{scoreOption}</option>
                          ))}
                        </select>
                      </label>
                      {Array.isArray(resolvedHubUnits) && (
                        <span className="import-ap-hub-preview">
                          {resolvedHubUnits.length > 0 ? `HUB: ${resolvedHubUnits.join(' · ')}` : 'No HUB from this score'}
                        </span>
                      )}
                    </li>
                    );
                  })}
                </ul>
              </section>

              <section className="import-section">
                <h3>Transfer Credit</h3>
                <p className="import-section-note">
                  Go to MyBU → Academics → Transfer Credit → Course Credits for the BU-equivalent course code.
                  {' '}<a href="https://www.bu.edu/mybu/" target="_blank" rel="noreferrer">Open MyBU</a>.
                </p>
                <p className="import-section-note">
                  Rows without a code will be saved as incomplete so you can finish mapping them from the Planner later.
                </p>
                {preview.transferCredits.length === 0 && <p className="import-muted">None found.</p>}
                <ul className="import-list">
                  {preview.transferCredits.map((tr) => (
                    <TransferCreditReviewRow
                      key={tr.id}
                      transferCredit={tr}
                      onUpdate={updateTransfer}
                    />
                  ))}
                </ul>
              </section>

              {showIncompleteTransferWarning && (
                <p className="import-incomplete-warning">
                  {preview.transferCredits.filter((credit) => !(credit.courseKey || '').trim()).length} transfer credit{preview.transferCredits.filter((credit) => !(credit.courseKey || '').trim()).length === 1 ? '' : 's'} don&apos;t have a BU equivalent yet. Import again to save them as incomplete; you can fill them in later from the Planner.
                </p>
              )}

              {(preview.meta?.cumulativeGpa != null || preview.meta?.earnedCredits != null) && (
                <section className="import-section">
                  <h3>Transcript totals (saved on plan)</h3>
                  <p className="import-muted">
                    {preview.meta.cumulativeGpa != null && <>Cum GPA {preview.meta.cumulativeGpa} · </>}
                    {preview.meta.earnedCredits != null && <>Earned {preview.meta.earnedCredits} · </>}
                    {preview.meta.gradePoints != null && <>Points {preview.meta.gradePoints}</>}
                  </p>
                </section>
              )}
            </div>
          )}

          {step === 2 && summary && (
            <div className="import-success">
              <p className="import-success-title">Import complete</p>
              <ul className="import-list compact">
                <li>{summary.coursesAdded} courses added to your plan</li>
                {summary.summerWinterAdded > 0 && (
                  <li>{summary.summerWinterAdded} Summer/Winter courses</li>
                )}
                {summary.apAdded > 0 && <li>{summary.apAdded} AP / test credits saved</li>}
                {summary.transferAdded > 0 && <li>{summary.transferAdded} transfer credits saved</li>}
                {summary.transferIncomplete > 0 && (
                  <li>
                    {summary.transferIncomplete} transfer credit{summary.transferIncomplete === 1 ? '' : 's'} saved as incomplete and ready for a MyBU lookup
                  </li>
                )}
                {summary.skipped > 0 && <li>{summary.skipped} conflict(s) skipped / kept</li>}
              </ul>
            </div>
          )}
        </div>

        <div className="import-modal-footer">
          <button type="button" className="import-secondary-btn" onClick={handleClose}>
            {step === 2 ? 'Close' : 'Cancel'}
          </button>
          {step === 1 && (
            <button
              type="button"
              className="import-primary-btn"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? 'Importing…' : showIncompleteTransferWarning ? 'Import and save incomplete rows' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
