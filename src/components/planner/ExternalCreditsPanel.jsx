import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import OneTimeHint from '../OneTimeHint';
import useOneTimeHint from '../../hooks/useOneTimeHint';
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
  normalize,
} from '../../data/apIbHubCredit';
import { HUB_LABELS } from '../../utils/hubConstants';
import { normalizeExternalCredit } from '../../utils/externalCredits';
import { resolveApHubFromScore } from '../../utils/apScoreResolution';
import { loadAllCourses } from '../../utils/courseQuery';
import { COURSE_KEY_PATTERN, isValidCourseKeyFormat } from '../../utils/courseKey';

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

// Same source documents cited in the AP_HUB_CREDIT/IB_HUB_CREDIT header
// comment (apIbHubCredit.js) — linked directly in the checklist UI so a
// confused student can check BU's own chart, not just this app's summary.
const BU_AP_GUIDE_URL = 'https://www.bu.edu/admissions/files/2025/03/FINAL_AP-Guide-2025-2026.pdf';
const BU_IB_GUIDE_URL = 'https://www.bu.edu/admissions/files/2025/03/FINAL_IB_course-equivalence-2025-2026.pdf';

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

function formatCourseKeyDisplay(courseKey) {
  const m = String(courseKey).match(COURSE_KEY_PATTERN);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : courseKey;
}

const MANUAL_COURSE_FORMAT_ERROR = 'Course key should look like "CAS MA 123" — won\'t be saved until fixed.';

// A manual override is either a single typed/picked courseKey or a picked
// multi-course combo (manualCourses) — never both, mirroring the
// mutual-exclusivity normalizeExternalCredit enforces. Validate whichever
// one is actually present: a single key against the usual format, or every
// course in a combo individually against that same format (a combo only
// ever comes from a trusted courseNoteOptions pick today, so this branch is
// mostly defensive, but it's the correct check regardless of how it got
// set — see the task note on not force-fitting multi-course picks into the
// single-key validator).
function getManualCourseFormatError(manualCourseKey, manualCourses) {
  if (Array.isArray(manualCourses) && manualCourses.length) {
    return manualCourses.every((course) => isValidCourseKeyFormat(course)) ? null : MANUAL_COURSE_FORMAT_ERROR;
  }
  const trimmed = (manualCourseKey || '').trim();
  if (trimmed && !isValidCourseKeyFormat(trimmed)) return MANUAL_COURSE_FORMAT_ERROR;
  return null;
}

// A courseNoteOptions entry is either a single courseKey string or an array
// of courseKeys (an "A & B" combo option, e.g. Biology score 5's paired
// courses) — normalize either shape into the {value, label, courses} a
// <select> needs. value stays in the app's unspaced storage convention
// (joining a combo with '+', same as resolveCourseKeyForEntry does
// elsewhere) so the <select> can round-trip it; label is the student-facing
// spaced-out display form. `courses` is the raw array for a multi-course
// option (null for a single one) — the discriminator ManualCourseKeyField
// uses to decide manualCourseKey vs manualCourses on selection, mirroring
// the courseKey-vs-courses split apIbHubCredit.js already draws for
// auto-resolved entries (see externalCredits.js's manualCourses comment).
function normalizeCourseNoteOption(option) {
  if (Array.isArray(option)) {
    return { value: option.join('+'), label: option.map(formatCourseKeyDisplay).join(' + '), courses: option };
  }
  return { value: option, label: formatCourseKeyDisplay(option), courses: null };
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

// Same '+' join used above for an auto-resolved `courses` array, applied to
// a manual override — manualCourseKey/manualCourses are mutually exclusive
// (see externalCredits.js), so this is just "whichever one is set,
// formatted the same way an auto-resolved multi-course entry already is."
function manualCourseDisplayValue(credit) {
  if (credit.manualCourseKey) return credit.manualCourseKey;
  if (Array.isArray(credit.manualCourses) && credit.manualCourses.length) {
    return credit.manualCourses.join('+');
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

// Checked-exam state is keyed by "examType:subject" (subject keys are plain
// lowercase words/spaces, never containing ':', so a single split is safe)
// rather than a Map, so it plays nicely with useState's plain-object
// updater pattern used everywhere else in this file.
function makeChecklistKey(examType, subject) {
  return `${examType}:${subject}`;
}
function parseChecklistKey(key) {
  const sep = key.indexOf(':');
  return { examType: key.slice(0, sep), subject: key.slice(sep + 1) };
}

// The same exam (AP or IB) shouldn't be addable twice — a second entry
// wouldn't earn extra credit, it'd just double-count HUB/requirement
// satisfaction from one real score. `testSubject` is stored in canonical
// AP_EXAM_SUBJECTS/IB_EXAM_SUBJECTS form for entries this checklist itself
// created, but transcript-imported rows may store it as printed on the
// transcript (e.g. "AP Biology") — normalize() (the same one fuzzyMatchKey
// uses internally) puts both into the same comparable form, so either
// source is recognized as "already added" here.
function buildAlreadyAddedKeys(existingCredits) {
  const keys = new Set();
  for (const raw of existingCredits || []) {
    const credit = normalizeExternalCredit(raw) || raw;
    if ((credit?.type !== 'ap' && credit?.type !== 'ib') || !credit.testSubject) continue;
    keys.add(makeChecklistKey(credit.type, normalize(credit.testSubject)));
  }
  return keys;
}

// A freshly-checked exam's state — same advisor-override fields
// (manualCourseKey/manualCourses/advisorNote) CourseMappingOverrideEditor
// offers on an already-added row, collected up front here so a
// courseNote-only exam doesn't have to be added first and then edited.
function createCheckedExamState() {
  return { score: '', subscore: '', manualCourseKey: '', manualCourses: null, advisorNote: '' };
}

// Subject keys are already display-cased via formatSubjectLabel for the
// checklist, then alphabetized by that display label (not the raw
// normalize()-form key) so the list reads alphabetically the way a student
// sees it. Computed once at module scope — AP_EXAM_SUBJECTS/IB_EXAM_SUBJECTS
// don't change at runtime.
const AP_SUBJECTS_SORTED = [...AP_EXAM_SUBJECTS].sort((a, b) => formatSubjectLabel(a).localeCompare(formatSubjectLabel(b)));
const IB_SUBJECTS_SORTED = [...IB_EXAM_SUBJECTS].sort((a, b) => formatSubjectLabel(a).localeCompare(formatSubjectLabel(b)));

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
      resolvedCredits: null, resolvedCourseInfo: null, resolvedHub: null, previewText: null,
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
    const resolvedHub = getIbHub(subject, IB_SCORE, true);
    return {
      scoreDependent: false,
      scoreOptions: [],
      scoreNote: 'Only Higher Level (HL) exams scored 5-7 earn BU credit.',
      needsSubscore: false,
      subscoreOptions: [],
      resolvedCredits,
      resolvedCourseInfo,
      resolvedHub,
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
  const resolvedHub = ready
    ? getApHub(subject, scoreDependent ? scoreValue : undefined, needsSubscore ? subscoreValue : undefined)
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
    resolvedHub,
    previewText,
    // Only a genuinely credit-earning, courseNote-only result offers the
    // advisor override below — the 0-credit dead end (e.g. Calc BC with a
    // non-qualifying subscore) has no course to map in the first place.
    isCourseNoteOnly: resolvedCredits != null && resolvedCredits > 0 && isCourseNoteOnlyInfo(resolvedCourseInfo),
  };
}

// The manual-override "course key" input, shared by ChecklistExamRow and
// CourseMappingOverrideEditor below. When BU's chart gives a finite, fully-
// specific "or" list (courseNoteOptions — see AP_HUB_CREDIT's header
// comment), this shows an actual picker instead of a bare text box, with an
// "Other / not listed" escape hatch that reveals free text for anything
// outside that list. When there's no such finite list (e.g. an advisor-
// approved "3xx" placeholder with no fixed number), it's just the text box,
// same as before.
//
// A picked option may itself represent one course or several (e.g. Biology
// score 5's "CAS BI 105 + CAS BI 107" combo) — this reports that back as
// manualCourseKey (single, or the free-text value) XOR manualCourses
// (array), never trying to cram a combo into the single-key shape/
// validation. Presentational only — the manualCourseKey/manualCourses
// props plus onChange is the only contract, so it works the same whether
// the caller persists on every keystroke (the checklist) or via an
// explicit Save (CourseMappingOverrideEditor).
function ManualCourseKeyField({ courseNoteOptions, manualCourseKey, manualCourses, onChange, ariaLabel }) {
  const options = Array.isArray(courseNoteOptions) && courseNoteOptions.length
    ? courseNoteOptions.map(normalizeCourseNoteOption)
    : null;

  // The <select>'s value has to be a single string either way — a picked
  // combo is represented the same joined form its option.value uses, so
  // re-rendering with an already-picked combo shows the right option
  // selected instead of falling into "Other".
  const currentValue = Array.isArray(manualCourses) && manualCourses.length
    ? manualCourses.join('+')
    : (manualCourseKey || '');

  const optionValues = options ? options.map((opt) => opt.value) : [];
  const [otherMode, setOtherMode] = useState(() => Boolean(options && currentValue && !optionValues.includes(currentValue)));

  if (!options) {
    // No finite option set for this exam — plain free text, always a
    // single courseKey (never a combo; there's no picker to derive one from).
    return (
      <input
        type="text"
        aria-label={ariaLabel}
        placeholder="e.g. CAS BI 108"
        value={manualCourseKey || ''}
        onChange={(e) => onChange({ manualCourseKey: e.target.value, manualCourses: null })}
      />
    );
  }

  const isOther = otherMode || (currentValue && !optionValues.includes(currentValue));
  const selectValue = isOther ? '__other__' : currentValue;

  return (
    <>
      <select
        aria-label={ariaLabel}
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '__other__') {
            setOtherMode(true);
            onChange({ manualCourseKey: '', manualCourses: null });
            return;
          }
          setOtherMode(false);
          const picked = options.find((opt) => opt.value === next);
          if (picked && picked.courses) {
            onChange({ manualCourseKey: '', manualCourses: picked.courses });
          } else {
            onChange({ manualCourseKey: next, manualCourses: null });
          }
        }}
      >
        <option value="">Choose one</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
        <option value="__other__">Other / not listed</option>
      </select>
      {isOther && (
        <input
          type="text"
          aria-label={`${ariaLabel} (custom)`}
          placeholder="e.g. CAS BI 108"
          value={manualCourseKey || ''}
          onChange={(e) => onChange({ manualCourseKey: e.target.value, manualCourses: null })}
        />
      )}
    </>
  );
}

// One checkbox row in the exam checklist. Mirrors the same title-leads
// (exam name, then course code/"Not mapped") + separate credit/HUB meta
// line used by the already-added rows further down this file, reusing the
// exact same classes (external-credit-row/-badges/-body/-title/-meta/
// -course-code/-hub) so a checked-and-resolved row looks like a preview of
// what it'll become once added, at the same fixed-width-badge alignment.
// `state` is undefined when unchecked.
const ChecklistExamRow = memo(function ChecklistExamRow({ examType, subjectKey, state, alreadyAdded, onToggle, onUpdate }) {
  const isChecked = Boolean(state);
  const resolution = resolveExamRow({
    examType,
    subject: subjectKey,
    score: state?.score ?? '',
    subscore: state?.subscore ?? '',
  });
  // Only a positive, resolved credit amount gets the full title+meta
  // treatment — a 0-credit dead end (Calc BC, non-qualifying subscore) has
  // no course to show and shouldn't look like a normal resolved row.
  const hasPositiveResult = isChecked && resolution.resolvedCredits != null && resolution.resolvedCredits > 0;
  const resolvedCourseKeyDisplay = hasPositiveResult ? resolveCourseKeyForEntry(resolution.resolvedCourseInfo) : null;
  const overrideVisible = hasPositiveResult && resolution.isCourseNoteOnly;

  // The AP/IB list itself scrolls (max-height + overflow-y: auto — see
  // planner.css) so ~30-70 checkboxes fit in a reasonable space, but that
  // means a row's newly-revealed content (score picker, then the
  // advisor-override dropdown once a score resolves) can end up below the
  // visible edge of that small box the moment it appears, looking "cut
  // off" rather than just needing a scroll the student doesn't know to
  // make. Nudge the row into view within its own scroll container each
  // time it's checked, and again when the override section appears.
  const itemRef = useRef(null);
  useEffect(() => {
    if ((isChecked || overrideVisible) && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isChecked, overrideVisible]);

  return (
    <li ref={itemRef} className={`external-credit-row external-credit-checklist-item ${isChecked ? 'checked' : ''} ${alreadyAdded ? 'already-added' : ''}`}>
      <div className="external-credit-main">
        <div className="external-credit-badges">
          <input
            type="checkbox"
            className="external-credit-checklist-checkbox"
            checked={isChecked}
            disabled={alreadyAdded}
            onChange={onToggle}
            aria-label={formatSubjectLabel(subjectKey)}
          />
        </div>
        <div className="external-credit-body">
          <div className="external-credit-title">
            {formatSubjectLabel(subjectKey)}
            {alreadyAdded && (
              <>
                {' · '}
                <span className="external-credit-unmapped-tag">Already added</span>
              </>
            )}
            {hasPositiveResult && resolvedCourseKeyDisplay && (
              <>
                {' · '}
                <span className="external-credit-course-code">{resolvedCourseKeyDisplay}</span>
              </>
            )}
            {hasPositiveResult && !resolvedCourseKeyDisplay && resolution.isCourseNoteOnly && (
              <>
                {' · '}
                <span className="external-credit-unmapped-tag">Not mapped</span>
              </>
            )}
          </div>

          {hasPositiveResult && (
            <div className="external-credit-meta">
              <span>{resolution.resolvedCredits} cr</span>
              {Array.isArray(resolution.resolvedHub) && (
                <span className="external-credit-hub">
                  {resolution.resolvedHub.length > 0 ? `HUB: ${resolution.resolvedHub.join(' · ')}` : 'No HUB confirmed'}
                </span>
              )}
            </div>
          )}

          {isChecked && resolution.resolvedCredits === 0 && (
            <p className="external-credit-score-note">{resolution.previewText}</p>
          )}

          {isChecked && resolution.scoreDependent && (
            <div className="external-credit-add-row external-credit-add-score-row">
              <div className="external-credit-add-row">
                <label>
                  Score
                  <select
                    value={state.score}
                    onChange={(e) => onUpdate({ score: e.target.value, subscore: '' })}
                  >
                    <option value="">—</option>
                    {resolution.scoreOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                {resolution.needsSubscore && (
                  <label>
                    AB Subscore
                    <select
                      value={state.subscore}
                      onChange={(e) => onUpdate({ subscore: e.target.value })}
                    >
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

          {hasPositiveResult && resolution.isCourseNoteOnly && (
            <div className="external-credit-override-editor">
              Advisor-confirmed mapping (optional) — doesn't change the credits/HUB above
              <label className="external-credit-override-field">
                Course key
                <ManualCourseKeyField
                  courseNoteOptions={resolution.resolvedCourseInfo?.courseNoteOptions}
                  manualCourseKey={state.manualCourseKey}
                  manualCourses={state.manualCourses}
                  onChange={(patch) => onUpdate(patch)}
                  ariaLabel={`Advisor-confirmed course for ${formatSubjectLabel(subjectKey)}`}
                />
              </label>
              <label className="external-credit-override-field">
                Advisor note
                <input
                  type="text"
                  placeholder="e.g. granted elective credit only, no HUB"
                  value={state.advisorNote}
                  onChange={(e) => onUpdate({ advisorNote: e.target.value })}
                />
              </label>
              {getManualCourseFormatError(state.manualCourseKey, state.manualCourses) && (
                <p className="external-credit-override-error">
                  {getManualCourseFormatError(state.manualCourseKey, state.manualCourses)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
});

const ExternalCreditChecklistForm = memo(function ExternalCreditChecklistForm({ existingCredits, onAdd, onCancel }) {
  const [checkedExams, setCheckedExams] = useState({});
  const [filterText, setFilterText] = useState('');
  const [error, setError] = useState('');

  const alreadyAddedKeys = useMemo(() => buildAlreadyAddedKeys(existingCredits), [existingCredits]);

  function toggleExam(examType, subject) {
    setError('');
    const key = makeChecklistKey(examType, subject);
    setCheckedExams((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: createCheckedExamState() };
    });
  }

  function updateCheckedExam(examType, subject, patch) {
    setError('');
    const key = makeChecklistKey(examType, subject);
    setCheckedExams((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }

  const resolvedChecked = Object.entries(checkedExams).map(([key, state]) => {
    const { examType, subject } = parseChecklistKey(key);
    return { key, examType, subject, state, resolution: resolveExamRow({ examType, subject, score: state.score, subscore: state.subscore }) };
  });
  // Same "resolved-but-zero doesn't count" rule as the old multi-row form —
  // a Calc BC score 1-3 with a non-qualifying subscore is a real, correct
  // answer, just not one with anything meaningful to add to the plan.
  const readyChecked = resolvedChecked.filter(({ resolution }) => resolution.resolvedCredits != null && resolution.resolvedCredits > 0);

  function handleSubmit(e) {
    e.preventDefault();
    if (readyChecked.length === 0) {
      setError('Check at least one exam with a resolved score.');
      return;
    }

    const entries = readyChecked.map(({ examType, subject, state, resolution }) => {
      const isIb = examType === 'ib';
      const scoreValue = state.score === '' ? null : Number(state.score);
      const subscoreValue = resolution.needsSubscore && state.subscore !== '' ? Number(state.subscore) : undefined;
      const hubUnits = isIb
        ? getIbHub(subject, IB_SCORE, true)
        : (resolution.scoreDependent ? getApHub(subject, scoreValue, subscoreValue) : getApHub(subject));

      // Advisor override only applies where auto-resolution came back
      // courseNote-only, and only carries through when it's valid — either
      // a single courseKey (typed or picked) that's syntactically valid, or
      // a picked multi-course combo where every course in it is. Whichever
      // of manualCourseKey/manualCourses is invalid or unset is silently
      // dropped rather than blocking the whole batch (the field itself
      // shows a validation error live, see ChecklistExamRow above).
      const isCourseNoteOnly = resolution.isCourseNoteOnly;
      const validManualCourses = isCourseNoteOnly && Array.isArray(state.manualCourses) && state.manualCourses.length
        && state.manualCourses.every((course) => isValidCourseKeyFormat(course))
        ? state.manualCourses
        : undefined;
      const trimmedManualKey = isCourseNoteOnly && !validManualCourses ? (state.manualCourseKey || '').trim() : '';
      const manualCourseKey = trimmedManualKey && isValidCourseKeyFormat(trimmedManualKey) ? trimmedManualKey : undefined;
      const advisorNote = isCourseNoteOnly ? (state.advisorNote || '').trim() || undefined : undefined;

      return normalizeExternalCredit({
        type: examType,
        testSubject: subject,
        sourceTitle: `${examType.toUpperCase()} ${formatSubjectLabel(subject)}`,
        credits: resolution.resolvedCredits,
        courseKey: resolveCourseKeyForEntry(resolution.resolvedCourseInfo),
        manualCourseKey,
        manualCourses: validManualCourses,
        advisorNote,
        // IB doesn't collect a score at all (see resolveExamRow) — only
        // AP entries carry one.
        ...(isIb ? { isHigherLevel: true } : { score: scoreValue }),
        manualHubUnits: Array.isArray(hubUnits) ? hubUnits : undefined,
        status: hubUnits === null ? 'needs_review' : 'auto_hub_resolved',
      });
    });

    onAdd(entries);
    setCheckedExams({});
    setFilterText('');
    setError('');
  }

  const normalizedFilter = normalize(filterText);
  const visibleApSubjects = normalizedFilter
    ? AP_SUBJECTS_SORTED.filter((key) => normalize(key).includes(normalizedFilter))
    : AP_SUBJECTS_SORTED;
  const visibleIbSubjects = normalizedFilter
    ? IB_SUBJECTS_SORTED.filter((key) => normalize(key).includes(normalizedFilter))
    : IB_SUBJECTS_SORTED;

  return (
    <form className="external-credit-add-form external-credit-checklist" onSubmit={handleSubmit}>
      <input
        type="text"
        className="external-credit-checklist-search"
        placeholder="Search exams…"
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        aria-label="Filter AP/IB exams"
      />
      <p className="external-credit-checklist-guides">
        Not sure which exam or score applies to you? See BU's official{' '}
        <a href={BU_AP_GUIDE_URL} target="_blank" rel="noopener noreferrer">AP Guide</a>
        {' '}or{' '}
        <a href={BU_IB_GUIDE_URL} target="_blank" rel="noopener noreferrer">IB Guide</a>.
      </p>

      <div className="external-credit-checklist-section">
        <h4 className="external-credit-checklist-heading">AP Exams</h4>
        <ul className="external-credit-checklist-list">
          {visibleApSubjects.map((subjectKey) => (
            <ChecklistExamRow
              key={subjectKey}
              examType="ap"
              subjectKey={subjectKey}
              state={checkedExams[makeChecklistKey('ap', subjectKey)]}
              alreadyAdded={alreadyAddedKeys.has(makeChecklistKey('ap', subjectKey))}
              onToggle={() => toggleExam('ap', subjectKey)}
              onUpdate={(patch) => updateCheckedExam('ap', subjectKey, patch)}
            />
          ))}
          {visibleApSubjects.length === 0 && (
            <li className="external-credit-checklist-empty">No AP exams match that search.</li>
          )}
        </ul>
      </div>

      <div className="external-credit-checklist-section">
        <h4 className="external-credit-checklist-heading">IB Exams</h4>
        <p className="external-credit-score-note">Only Higher Level (HL) exams scored 5-7 earn BU credit.</p>
        <ul className="external-credit-checklist-list">
          {visibleIbSubjects.map((subjectKey) => (
            <ChecklistExamRow
              key={subjectKey}
              examType="ib"
              subjectKey={subjectKey}
              state={checkedExams[makeChecklistKey('ib', subjectKey)]}
              alreadyAdded={alreadyAddedKeys.has(makeChecklistKey('ib', subjectKey))}
              onToggle={() => toggleExam('ib', subjectKey)}
              onUpdate={(patch) => updateCheckedExam('ib', subjectKey, patch)}
            />
          ))}
          {visibleIbSubjects.length === 0 && (
            <li className="external-credit-checklist-empty">No IB exams match that search.</li>
          )}
        </ul>
      </div>

      {error && <div className="external-credit-warning">{error}</div>}

      <div className="external-credit-add-actions external-credit-checklist-footer">
        <button type="submit" className="import-primary-btn" disabled={readyChecked.length === 0}>
          Add {readyChecked.length} exam{readyChecked.length === 1 ? '' : 's'}
        </button>
        <button type="button" className="import-secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
});

const TRANSFER_MIN_CREDITS = 0.5;
const TRANSFER_MAX_CREDITS = 16;
const TRANSFER_MAX_SUGGESTIONS = 8;
const TRANSFER_NOTE_MAX_LENGTH = 200;

// Same trim / collapse-whitespace / lowercase comparison for the duplicate
// check, so "Boston  College" and "boston college" are the same school.
function normalizeTransferText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Standalone BU-equivalent autocomplete over the shared course catalog
// (loadAllCourses is a module-level cached promise, so this doesn't add a
// second fetch). Deliberately not CourseSearch — that one is wired to
// planner state (semester targets, stash, info panel). A student must pick
// a result or leave the field blank; free text is never saved as a key.
export function BuEquivalentField({ picked, onPick, onClear, ariaLabel }) {
  const listId = useId();
  const [courses, setCourses] = useState([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadAllCourses()
      .then((all) => { if (!cancelled) setCourses(Array.isArray(all) ? all : []); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    const qNoSpace = q.replace(/\s+/g, '');
    const out = [];
    for (const course of courses) {
      const number = String(course.courseNumber || course.id || '');
      if (
        number.toUpperCase().replace(/\s+/g, '').includes(qNoSpace)
        || String(course.name || '').toUpperCase().includes(q)
      ) {
        out.push(course);
        if (out.length >= TRANSFER_MAX_SUGGESTIONS) break;
      }
    }
    return out;
  }, [courses, query]);

  function choose(course) {
    onPick(course);
    setQuery('');
    setOpen(false);
  }

  if (picked) {
    // An edit prefills from a bare courseKey (no name) — fill the name in
    // from the catalog once it has loaded.
    const shown = picked.name ? picked : (courses.find((c) => c.id === picked.id) ?? picked);
    return (
      <div className="external-credit-bu-picked">
        <span className="external-credit-course-code">{shown.courseNumber || shown.id}</span>
        <span className="external-credit-bu-picked-name">{shown.name}</span>
        <button
          type="button"
          className="external-credit-remove"
          onClick={onClear}
          aria-label="Clear BU equivalent"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="external-credit-bu-field">
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={loadFailed ? 'Course list unavailable' : 'Search by course number or name'}
        disabled={loadFailed}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIndex(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open && suggestions[activeIndex]) {
            e.preventDefault();
            choose(suggestions[activeIndex]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && suggestions.length > 0 && (
        <ul className="external-credit-bu-list" id={listId} role="listbox">
          {suggestions.map((course, i) => (
            <li
              key={course.id}
              role="option"
              aria-selected={i === activeIndex}
              className={`external-credit-bu-option${i === activeIndex ? ' active' : ''}`}
              // mousedown (not click) so it fires before the input's blur closes the list
              onMouseDown={(e) => { e.preventDefault(); choose(course); }}
            >
              <span className="external-credit-course-code">{course.courseNumber || course.id}</span>
              <span className="external-credit-bu-option-name">{course.name}</span>
            </li>
          ))}
        </ul>
      )}
      {query.trim() !== '' && (
        <p className="external-credit-score-note">Pick a course from the list, or clear this field to leave it blank.</p>
      )}
    </div>
  );
}

// Add mode (onAdd/onClose) builds a new entry; edit mode (initial/onSave/
// onCancel) prefills from an existing transfer entry and hands back an
// onUpdate patch instead — same fields and validation either way.
const TransferCreditForm = memo(function TransferCreditForm({
  existingCredits,
  coursesInPlan,
  onAdd,
  onClose,
  initial = null,
  onSave,
  onCancel,
}) {
  const isEdit = Boolean(initial);
  const initialKey = initial?.courseKey ? String(initial.courseKey).replace(/\s+/g, '').toUpperCase() : '';
  const [school, setSchool] = useState(initial?.institution ?? '');
  const [title, setTitle] = useState(initial?.sourceTitle ?? '');
  const [credits, setCredits] = useState(initial?.credits != null ? String(initial.credits) : '');
  const [picked, setPicked] = useState(
    initialKey ? { id: initialKey, courseNumber: formatCourseKeyDisplay(initialKey), name: '' } : null,
  );
  const [noEquivalent, setNoEquivalent] = useState(!initialKey && initial?.status === 'no_equivalent');
  const [note, setNote] = useState(initial?.advisorNote ?? '');
  // Bumped to remount BuEquivalentField, clearing a half-typed query when
  // "No BU equivalent" is checked.
  const [buFieldKey, setBuFieldKey] = useState(0);
  const [errors, setErrors] = useState({});
  const [addedLabel, setAddedLabel] = useState('');

  const pickedKey = picked ? String(picked.id || picked.courseNumber || '').replace(/\s+/g, '').toUpperCase() : '';
  const alreadyInPlan = Boolean(pickedKey) && coursesInPlan instanceof Set && coursesInPlan.has(pickedKey);

  function edit(setter) {
    return (e) => {
      setter(e.target.value);
      setErrors({});
      setAddedLabel('');
    };
  }

  function handleSubmit(e) {
    e.preventDefault();
    const nextErrors = {};
    const trimmedSchool = school.trim();
    const trimmedTitle = title.trim();

    if (!trimmedSchool) nextErrors.school = 'Enter the school name.';
    if (!trimmedTitle) nextErrors.title = 'Enter the course title.';

    const creditsNumber = Number(credits);
    if (
      credits.trim() === ''
      || !Number.isFinite(creditsNumber)
      || creditsNumber < TRANSFER_MIN_CREDITS
      || creditsNumber > TRANSFER_MAX_CREDITS
      || !Number.isInteger(creditsNumber * 2)
    ) {
      nextErrors.credits = `Credits must be between ${TRANSFER_MIN_CREDITS} and ${TRANSFER_MAX_CREDITS}, in steps of 0.5.`;
    }

    // An unchanged key on an edit is kept as-is (e.g. a suffixed key an
    // import already stored) — the format check only gates a new pick.
    if (picked && pickedKey !== initialKey && !isValidCourseKeyFormat(pickedKey)) {
      nextErrors.course = `${picked.courseNumber || picked.id} can't be used as a BU equivalent — clear it, or leave it blank and map it later.`;
    }

    if (!nextErrors.school && !nextErrors.title) {
      const wantSchool = normalizeTransferText(trimmedSchool);
      const wantTitle = normalizeTransferText(trimmedTitle);
      const isDuplicate = (existingCredits || []).some((raw) => {
        if (isEdit && raw?.id === initial.id) return false;
        const credit = normalizeExternalCredit(raw) || raw;
        return credit?.type === 'transfer'
          && normalizeTransferText(credit.institution) === wantSchool
          && normalizeTransferText(credit.sourceTitle) === wantTitle;
      });
      if (isDuplicate) nextErrors.title = 'You already added this course from this school.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setAddedLabel('');
      return;
    }

    const courseKey = picked ? pickedKey : null;
    const status = courseKey ? 'mapped' : noEquivalent ? 'no_equivalent' : 'needs_mapping';
    const advisorNote = note.trim().slice(0, TRANSFER_NOTE_MAX_LENGTH) || null;
    if (isEdit) {
      onSave({
        institution: trimmedSchool,
        sourceTitle: trimmedTitle,
        credits: creditsNumber,
        courseKey,
        status,
        advisorNote,
      });
      return;
    }
    onAdd([normalizeExternalCredit({
      type: 'transfer',
      sourceTitle: trimmedTitle,
      institution: trimmedSchool,
      credits: creditsNumber,
      courseKey,
      status,
      advisorNote,
    })]);

    setAddedLabel(`Added ${trimmedTitle}`);
    setSchool('');
    setTitle('');
    setCredits('');
    setPicked(null);
    setNoEquivalent(false);
    setNote('');
    setBuFieldKey((k) => k + 1);
    setErrors({});
  }

  return (
    <form className="external-credit-add-form external-credit-transfer-form" onSubmit={handleSubmit} noValidate>
      <label className="external-credit-transfer-field">
        School
        <input type="text" value={school} onChange={edit(setSchool)} placeholder="e.g. Northeastern University" aria-invalid={Boolean(errors.school)} />
        {errors.school && <span className="external-credit-override-error">{errors.school}</span>}
      </label>
      <label className="external-credit-transfer-field">
        Course title at that school
        <input type="text" value={title} onChange={edit(setTitle)} placeholder="e.g. Introduction to Psychology" aria-invalid={Boolean(errors.title)} />
        {errors.title && <span className="external-credit-override-error">{errors.title}</span>}
      </label>
      <label className="external-credit-transfer-field">
        Credits
        <input
          type="number"
          inputMode="decimal"
          min={TRANSFER_MIN_CREDITS}
          max={TRANSFER_MAX_CREDITS}
          step="0.5"
          value={credits}
          onChange={edit(setCredits)}
          aria-invalid={Boolean(errors.credits)}
        />
        {errors.credits && <span className="external-credit-override-error">{errors.credits}</span>}
      </label>
      <div className="external-credit-transfer-field">
        <span>BU equivalent (optional)</span>
        <BuEquivalentField
          key={buFieldKey}
          picked={picked}
          onPick={(course) => { setPicked(course); setNoEquivalent(false); setErrors({}); setAddedLabel(''); }}
          onClear={() => { setPicked(null); setErrors({}); }}
        />
        <label className="external-credit-no-equiv-toggle">
          <input
            type="checkbox"
            checked={noEquivalent}
            onChange={(e) => {
              const checked = e.target.checked;
              setNoEquivalent(checked);
              if (checked) {
                setPicked(null);
                setBuFieldKey((k) => k + 1);
              }
              setErrors({});
              setAddedLabel('');
            }}
          />
          No BU equivalent
        </label>
        {errors.course && <span className="external-credit-override-error">{errors.course}</span>}
        {alreadyInPlan && (
          <span className="external-credit-score-note">
            This course is already in your plan; its credits may be counted twice.
          </span>
        )}
      </div>

      <label className="external-credit-transfer-field">
        Note (optional)
        <input
          type="text"
          value={note}
          maxLength={TRANSFER_NOTE_MAX_LENGTH}
          onChange={edit(setNote)}
          placeholder="e.g. Advisor said this may count as an elective"
        />
      </label>

      <p className="external-credit-score-note">
        Credits count toward your total once a BU course is chosen. Transfer credit never counts toward HUB.
      </p>

      {addedLabel && <div className="external-credit-transfer-added" role="status">✓ {addedLabel}</div>}

      <div className="external-credit-add-actions">
        <button type="submit" className="import-primary-btn">{isEdit ? 'Save' : 'Add transfer credit'}</button>
        <button type="button" className="import-secondary-btn" onClick={isEdit ? onCancel : onClose}>{isEdit ? 'Cancel' : 'Close'}</button>
      </div>
    </form>
  );
});

const TransferExternalCreditRow = memo(function TransferExternalCreditRow({
  creditId,
  onUpdate,
}) {
  const [error, setError] = useState('');

  // Commits on pick (not blur) with the same format check as the add form.
  function handlePick(course) {
    const key = String(course.id || course.courseNumber || '').replace(/\s+/g, '').toUpperCase();
    if (!isValidCourseKeyFormat(key)) {
      setError(`${course.courseNumber || course.id} can't be used as a BU equivalent — pick another course.`);
      return;
    }
    setError('');
    onUpdate?.(creditId, { courseKey: key, status: 'mapped' });
  }

  return (
    <div className="external-credit-warning">
      Needs BU equivalent — check MyBU
      <BuEquivalentField picked={null} onPick={handlePick} onClear={() => {}} />
      {error && <span className="external-credit-override-error">{error}</span>}
      <label className="external-credit-no-equiv-toggle">
        <input
          type="checkbox"
          checked={false}
          onChange={() => onUpdate?.(creditId, { courseKey: null, status: 'no_equivalent' })}
        />
        No BU equivalent
      </label>
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
const CourseMappingOverrideEditor = memo(function CourseMappingOverrideEditor({ credit, creditId, courseNoteOptions, onUpdate, onDone }) {
  const [courseKeyDraft, setCourseKeyDraft] = useState(credit.manualCourseKey || '');
  const [coursesDraft, setCoursesDraft] = useState(Array.isArray(credit.manualCourses) ? credit.manualCourses : null);
  const [noteDraft, setNoteDraft] = useState(credit.advisorNote || '');
  const [formatError, setFormatError] = useState('');

  useEffect(() => {
    setCourseKeyDraft(credit.manualCourseKey || '');
    setCoursesDraft(Array.isArray(credit.manualCourses) ? credit.manualCourses : null);
    setNoteDraft(credit.advisorNote || '');
  }, [credit.manualCourseKey, credit.manualCourses, credit.advisorNote]);

  function handleSave() {
    const error = getManualCourseFormatError(courseKeyDraft, coursesDraft);
    if (error) {
      setFormatError(error);
      return;
    }
    setFormatError('');
    const hasCourses = Array.isArray(coursesDraft) && coursesDraft.length > 0;
    const trimmedKey = courseKeyDraft.trim();
    onUpdate?.(creditId, {
      manualCourseKey: !hasCourses && trimmedKey ? trimmedKey.replace(/\s+/g, '').toUpperCase() : null,
      manualCourses: hasCourses ? coursesDraft : null,
      advisorNote: noteDraft.trim() || null,
    });
    onDone?.();
  }

  function handleClear() {
    setCourseKeyDraft('');
    setCoursesDraft(null);
    setNoteDraft('');
    setFormatError('');
    onUpdate?.(creditId, { manualCourseKey: null, manualCourses: null, advisorNote: null });
    onDone?.();
  }

  return (
    <div className="external-credit-override-editor">
      Advisor-confirmed mapping (optional) — doesn't change the auto-resolved credits or HUB units above
      <label className="external-credit-override-field">
        Course key
        <ManualCourseKeyField
          courseNoteOptions={courseNoteOptions}
          manualCourseKey={courseKeyDraft}
          manualCourses={coursesDraft}
          onChange={({ manualCourseKey, manualCourses }) => {
            setCourseKeyDraft(manualCourseKey);
            setCoursesDraft(manualCourses);
          }}
          ariaLabel={`Advisor-confirmed course for ${credit.sourceTitle}`}
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
        {(credit.manualCourseKey || (credit.manualCourses && credit.manualCourses.length) || credit.advisorNote) && (
          <button type="button" className="external-credit-score-btn" onClick={handleClear}>Clear</button>
        )}
        <button type="button" className="external-credit-score-btn" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
});

export default function ExternalCreditsPanel({ externalCredits, coursesInPlan, onRemove, onUpdate, onAdd, hintsEnabled = true }) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingScoreCreditId, setEditingScoreCreditId] = useState(null);
  const [editingOverrideCreditId, setEditingOverrideCreditId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addType, setAddType] = useState('apib');
  const [editingTransferId, setEditingTransferId] = useState(null);
  const credits = Array.isArray(externalCredits) ? externalCredits : [];
  const hasTransfer = credits.some((c) => normalizeExternalCredit(c)?.type === 'transfer');
  const [transferHintVisible, dismissTransferHint, markTransferSeen] = useOneTimeHint('ec_transfer', {
    priority: 14,
    when: hintsEnabled && !collapsed && hasTransfer,
  });
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
            AP/IB credit may count toward HUB; transfer credit never does
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
          <>
            <div className="external-credit-add-row external-credit-type-toggle" role="group" aria-label="Credit type">
              <button
                type="button"
                className={`external-credit-score-btn${addType === 'apib' ? ' active' : ''}`}
                aria-pressed={addType === 'apib'}
                onClick={() => setAddType('apib')}
              >
                AP / IB
              </button>
              <button
                type="button"
                className={`external-credit-score-btn${addType === 'transfer' ? ' active' : ''}`}
                aria-pressed={addType === 'transfer'}
                onClick={() => setAddType('transfer')}
              >
                Transfer
              </button>
            </div>
            {addType === 'transfer' ? (
              <TransferCreditForm
                existingCredits={credits}
                coursesInPlan={coursesInPlan}
                onAdd={onAdd}
                onClose={() => setShowAddForm(false)}
              />
            ) : (
              <ExternalCreditChecklistForm
                existingCredits={credits}
                onAdd={(entry) => {
                  onAdd(entry);
                  setShowAddForm(false);
                }}
                onCancel={() => setShowAddForm(false)}
              />
            )}
          </>
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
          No AP, IB, or transfer credit added yet — self-report it above, no transcript needed.
        </p>
      )}

      {transferHintVisible && (
        <OneTimeHint onDismiss={dismissTransferHint} onSeen={markTransferSeen}>
          Transfer credit counts toward total credits, not HUB units.
        </OneTimeHint>
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
          const isNoEquivalent = type === 'transfer' && !normalized.courseKey && normalized.status === 'no_equivalent';
          const needsMapping = type === 'transfer' && !normalized.courseKey && !isNoEquivalent;
          const needsApReview = (type === 'ib' && testHub === null) || (type === 'ap' && testHub === null && !apScoreDependent);
          const needsReview = needsMapping || needsApReview;
          if (type === 'transfer' && editingTransferId === creditId) {
            return (
              <li key={creditId} className="external-credit-row external-credit-row-editing">
                <TransferCreditForm
                  initial={normalized}
                  existingCredits={credits}
                  coursesInPlan={coursesInPlan}
                  onSave={(patch) => {
                    onUpdate?.(creditId, patch);
                    setEditingTransferId(null);
                  }}
                  onCancel={() => setEditingTransferId(null)}
                />
              </li>
            );
          }
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
                  ) : manualCourseDisplayValue(normalized) ? (
                    <>
                      {' · '}
                      <span className="external-credit-course-code">{manualCourseDisplayValue(normalized)}</span>
                      <span className="external-credit-manual-tag">manual</span>
                    </>
                  ) : isTestCredit ? (
                    <>
                      {' · '}
                      <span className="external-credit-unmapped-tag">Not mapped</span>
                    </>
                  ) : null}
                  {type === 'transfer' && onUpdate && (
                    <button
                      type="button"
                      className="external-credit-override-link"
                      onClick={() => setEditingTransferId(creditId)}
                    >
                      Edit
                    </button>
                  )}
                  {canOverrideCourseMapping && (
                    <button
                      type="button"
                      className="external-credit-override-link"
                      onClick={() => setEditingOverrideCreditId((prev) => (prev === creditId ? null : creditId))}
                    >
                      {(manualCourseDisplayValue(normalized) || normalized.advisorNote) ? 'Edit override' : 'Add advisor note / override'}
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
                {isNoEquivalent && (
                  <label className="external-credit-no-equiv-label">
                    <input
                      type="checkbox"
                      checked
                      aria-label={`No BU equivalent for ${normalized.sourceTitle}`}
                      onChange={() => onUpdate?.(creditId, { courseKey: null, status: 'needs_mapping' })}
                    />
                    No BU equivalent — counts as general credit; confirm with BU
                  </label>
                )}
                {needsMapping && (
                  <TransferExternalCreditRow
                    creditId={creditId}
                    onUpdate={onUpdate}
                  />
                )}
                {showOverrideEditor && (
                  <CourseMappingOverrideEditor
                    credit={normalized}
                    creditId={creditId}
                    courseNoteOptions={courseMappingInfo?.courseNoteOptions}
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
