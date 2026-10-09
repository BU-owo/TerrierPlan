import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { parseTranscriptPdf } from '../../utils/transcriptParser';
import { buildImportPreview, applyImport } from '../../utils/transcriptMapping';
import { resolveApHubFromScore } from '../../utils/apScoreResolution';
import { getApHub, isApScoreDependent } from '../../data/apIbHubCredit';
import { resolveCourseKeys, loadAllCourses } from '../../utils/courseQuery';
import { readPlanAttachment, sanitizePlanBlob } from '../../utils/planImport';
import { BU_SCHOOLS, findProgramByUrl } from '../../data/bu-programs';
import { REQUIREMENT_PROGRAMS } from '../requirements/programs';
import { BuEquivalentField } from './ExternalCreditsPanel';
import { isValidCourseKeyFormat } from '../../utils/courseKey';

const STEPS = ['Upload', 'Review', 'Confirm'];
const DEBUG_IMPORT = import.meta.env.DEV;

function debugImportModal(stage, payload) {
  if (!DEBUG_IMPORT) return;
  console.log(`[DEBUG ImportTranscriptModal] ${stage}`, payload);
}

// Rewrites parsed transcript keys to their catalog form (CASWR151S →
// CASWR151 when only the latter exists) before buildImportPreview, so its
// duplicate check sees them as the same course as one already on the plan.
// Mutates `parsed` in place. A failed lookup leaves the keys as parsed
// rather than blocking the import.
async function resolveParsedCourseKeys(parsed) {
  const termCourses = (parsed?.terms || []).flatMap((t) => t.courses || []);
  const apCredits = parsed?.apCredits || [];
  const entries = [...termCourses, ...apCredits];
  let resolved;
  try {
    resolved = await resolveCourseKeys(entries.map((e) => e.courseKey));
  } catch (err) {
    console.error('Could not resolve transcript course keys; using them as parsed:', err);
    return;
  }
  for (const entry of entries) {
    if (entry.courseKey && resolved.has(entry.courseKey)) {
      entry.courseKey = resolved.get(entry.courseKey);
    }
  }
}

// What sanitizePlanBlob needs to know about programs: every bu-programs url,
// plus the requirement JSONs (for requirement-exception node ids).
const PLAN_IMPORT_PROGRAMS = {
  urls: new Set(BU_SCHOOLS.flatMap((school) => school.programs.map((p) => p.url))),
  requirements: REQUIREMENT_PROGRAMS,
};
const MAX_DROPPED_SHOWN = 40;

const TransferCreditReviewRow = memo(function TransferCreditReviewRow({ transferCredit, onUpdate }) {
  const [creditsDraft, setCreditsDraft] = useState(String(transferCredit.creditsEdit ?? transferCredit.credits ?? ''));
  const [courseKeyError, setCourseKeyError] = useState('');
  // The preview only ever holds a picked catalog key ('' = none, i.e. saved
  // as incomplete); the field looks the course name up from the catalog.
  const courseKey = (transferCredit.courseKey || '').trim();
  const picked = courseKey ? { id: courseKey, name: '' } : null;

  useEffect(() => {
    setCreditsDraft(String(transferCredit.creditsEdit ?? transferCredit.credits ?? ''));
  }, [transferCredit.id, transferCredit.creditsEdit, transferCredit.credits]);

  // Commits on pick, with the same format check as the planner's transfer form.
  function handlePick(course) {
    const key = String(course.id || course.courseNumber || '').replace(/\s+/g, '').toUpperCase();
    if (!isValidCourseKeyFormat(key)) {
      setCourseKeyError(`${course.courseNumber || course.id} can't be used as a BU equivalent — pick another course.`);
      return;
    }
    setCourseKeyError('');
    onUpdate(transferCredit.id, { courseKey: key });
  }

  function handleClear() {
    setCourseKeyError('');
    onUpdate(transferCredit.id, { courseKey: '' });
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
        <div className="import-transfer-equivalent">
          <span>Equivalent</span>
          <BuEquivalentField
            picked={picked}
            onPick={handlePick}
            onClear={handleClear}
            ariaLabel={`BU equivalent for ${transferCredit.title}`}
          />
          {courseKeyError && <span className="external-credit-override-error">{courseKeyError}</span>}
        </div>
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
  onImportPlan,
  currentUid = null,
  planImportBlockedReason = null,
  // Copy only: 'plan' (the "Import plan" button) or 'transcript'. Both accept
  // either file type and detect it automatically.
  variant = 'transcript',
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
  // Plan PDF branch: sanitizePlanBlob's result, who was signed in (null =
  // guest) when its Review step opened, and the created plan's name.
  const [planPreview, setPlanPreview] = useState(null);
  const [planReviewUid, setPlanReviewUid] = useState(null);
  const [planResult, setPlanResult] = useState(null);
  const inputRef = useRef(null);

  const resetReview = useCallback(() => {
    setPreview(null);
    setSummary(null);
    setPlanPreview(null);
    setPlanResult(null);
    setError('');
  }, []);

  function handleClose() {
    setStep(0);
    setParsing(false);
    setError('');
    setFileName('');
    setPreview(null);
    setPlanPreview(null);
    setPlanResult(null);
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
      // A TerrierPlan plan PDF carries its plan as an attachment; anything
      // else (null) is treated as a BU transcript, exactly as before.
      const planRead = await readPlanAttachment(file);
      if (planRead) {
        if (planRead.error) {
          setError(planRead.error.message);
          return;
        }
        let catalogIds;
        try {
          catalogIds = new Set((await loadAllCourses()).map((c) => c.id));
        } catch (err) {
          console.error(err);
          setError("Couldn't load the course list to check that plan. Try again.");
          return;
        }
        const result = sanitizePlanBlob(planRead.blob, { catalogIds, programs: PLAN_IMPORT_PROGRAMS });
        if (!result.summary) {
          setError(result.errors[0]?.message || 'Could not read that plan PDF.');
          return;
        }
        setPlanReviewUid(currentUid ?? null);
        setPlanPreview(result);
        setStep(1);
        return;
      }
      const parsed = await parseTranscriptPdf(file);
      debugImportModal('handleFile-parsed', {
        apCredits: parsed?.apCredits || [],
        transferCredits: parsed?.transferCredits || [],
      });
      await resolveParsedCourseKeys(parsed);
      const built = buildImportPreview(parsed, semesters, extraTerms);
      debugImportModal('handleFile-preview-built', {
        transferCredits: built?.transferCredits || [],
        apCredits: built?.apCredits || [],
      });
      setPreview(built);
      setStep(1);
    } catch (err) {
      console.error(err);
      setError('Could not parse that PDF. Make sure it is an unofficial BU transcript or a TerrierPlan plan PDF.');
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
          if (!isApScoreDependent(ap.testSubject)) {
            return {
              ...ap,
              resolvedHubUnits: getApHub(ap.testSubject),
            };
          }
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
      setError(err?.importApplied ? 'Import applied, and it will save automatically.' : 'Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirmPlanImport() {
    if (!planPreview?.plan || planImportBlockedReason || importing) return;
    setImporting(true);
    setError('');
    try {
      setPlanResult(await onImportPlan(planPreview.plan, planReviewUid));
      setStep(2);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  const planSignInChanged = planPreview != null && (currentUid ?? null) !== planReviewUid;
  const planBlockReason = planSignInChanged
    ? 'Your sign-in changed, so nothing can be imported. Close this and try again.'
    : planImportBlockedReason;
  const planMajor = findProgramByUrl(planPreview?.summary?.majorBulletinUrl);

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
          <h2 id="import-modal-title">{variant === 'plan' ? 'Import Plan PDF' : 'Import Transcript or Plan PDF'}</h2>
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
            <>
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
                    <svg className="import-dropzone-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                      <path d="M14 3v5h5" />
                      <path d="M12 17v-6" />
                      <path d="M9.5 13.5 12 11l2.5 2.5" />
                    </svg>
                    <p className="import-dropzone-title">
                      {variant === 'plan' ? 'Drop a TerrierPlan PDF here, or click to choose' : 'Drop your unofficial transcript or plan PDF here'}
                    </p>
                    {/* No handler of its own: the click bubbles to the dropzone, which opens the picker. */}
                    <button type="button" className="import-secondary-btn import-dropzone-btn">
                      Choose file
                    </button>
                    <p className="import-dropzone-hint">
                      {variant === 'plan'
                        ? 'Made with Download plan PDF. It imports as a new plan.'
                        : 'Get it from MyBU → Academics → View Unofficial Transcript → View PDF, then download it.'}
                    </p>
                    {fileName && <p className="import-filename">{fileName}</p>}
                  </>
                )}
              </div>
              <p className="import-dropzone-privacy">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                <span>
                  Your transcript is read in your browser and never uploaded. Only the courses, test/transfer credits, and GPA totals you confirm are saved.
                </span>
              </p>
            </>
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
                      {a.term} → {a.slotLabel}
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
                <p className="import-section-note">Only score-dependent AP exams ask for scores. Fixed-HUB AP exams are resolved automatically from the exam name.</p>
                {preview.apCredits.length === 0 && <p className="import-muted">None found.</p>}
                <ul className="import-list compact">
                  {preview.apCredits.map((ap, i) => {
                    const scoreDependent = isApScoreDependent(ap.testSubject);
                    const resolvedHubUnits = Array.isArray(ap.resolvedHubUnits)
                      ? ap.resolvedHubUnits
                      : scoreDependent
                        ? resolveApHubFromScore(ap.testSubject, ap.score).hubUnits
                        : getApHub(ap.testSubject);
                    return (
                    <li key={ap.id || `${ap.courseKey}-${i}`}>
                      <strong>{ap.courseKey}</strong>
                      <span className="import-muted">{ap.testSubject} — {ap.title}</span>
                      <span>{ap.credits} cr</span>
                      {scoreDependent && (
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
                      )}
                      {Array.isArray(resolvedHubUnits) && (
                        <span className="import-ap-hub-preview">
                          {resolvedHubUnits.length > 0 ? `HUB: ${resolvedHubUnits.join(' · ')}` : scoreDependent ? 'No HUB from this score' : 'No HUB for this exam'}
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

          {step === 1 && planPreview && (
            <div className="import-review">
              <div className="import-review-toolbar">
                <button
                  type="button"
                  className="import-secondary-btn"
                  onClick={() => { resetReview(); setStep(0); setFileName(''); }}
                >
                  ← Re-upload
                </button>
                <span className="import-review-counts">TerrierPlan plan PDF</span>
              </div>

              <section className="import-section">
                <h3>{planPreview.summary.name}</h3>
                {planMajor && <p className="import-muted">{planMajor.name} {planMajor.degree}</p>}
                <ul className="import-list compact">
                  <li>{planPreview.summary.years} year{planPreview.summary.years === 1 ? '' : 's'}</li>
                  <li>{planPreview.summary.courseCount} course{planPreview.summary.courseCount === 1 ? '' : 's'}</li>
                  <li>{planPreview.summary.placeholderCount} placeholder{planPreview.summary.placeholderCount === 1 ? '' : 's'}</li>
                  {planPreview.summary.stashCount > 0 && <li>{planPreview.summary.stashCount} saved for later</li>}
                  {planPreview.summary.extraTermCount > 0 && <li>{planPreview.summary.extraTermCount} Summer/Winter term{planPreview.summary.extraTermCount === 1 ? '' : 's'}</li>}
                  {planPreview.summary.overrideCount > 0 && <li>{planPreview.summary.overrideCount} requirement exception{planPreview.summary.overrideCount === 1 ? '' : 's'}</li>}
                </ul>
                <p className="import-section-note">
                  This becomes a new plan; your other plans aren&apos;t touched. Credits fill in after import.
                  Completed, AP and transfer credit isn&apos;t imported.
                </p>
              </section>

              {planPreview.errors.length > 0 && (
                <p className="import-error">{planPreview.errors[0].message}</p>
              )}
              {planBlockReason && <p className="import-error">{planBlockReason}</p>}

              {planPreview.dropped.length > 0 && (
                <section className="import-section">
                  <h3>Left out ({planPreview.dropped.length})</h3>
                  <p className="import-section-note">These weren&apos;t valid or aren&apos;t in the course catalog, so they won&apos;t be imported.</p>
                  <ul className="import-list compact">
                    {planPreview.dropped.slice(0, MAX_DROPPED_SHOWN).map((d, i) => (
                      <li key={`${d.where}-${d.what}-${i}`}>
                        <strong>{d.what}</strong>
                        <span className="import-muted">{d.where} · {d.reason}</span>
                      </li>
                    ))}
                    {planPreview.dropped.length > MAX_DROPPED_SHOWN && (
                      <li className="import-muted">and {planPreview.dropped.length - MAX_DROPPED_SHOWN} more</li>
                    )}
                  </ul>
                </section>
              )}
            </div>
          )}

          {step === 2 && planResult && (
            <div className="import-success">
              <p className="import-success-title">Plan imported</p>
              <ul className="import-list compact">
                <li>&ldquo;{planResult.name}&rdquo; is now open.</li>
                <li>Course names and credits load in a moment.</li>
              </ul>
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
          {step === 1 && planPreview?.plan && !planBlockReason && (
            <button
              type="button"
              className="import-primary-btn"
              onClick={handleConfirmPlanImport}
              disabled={importing}
            >
              {importing ? 'Importing…' : 'Create new plan'}
            </button>
          )}
          {step === 1 && preview && (
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
