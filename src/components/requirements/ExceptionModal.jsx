import { useState } from 'react';
import { formatCourseLabel } from './treeHelpers';
import { cleanSubstituteLabel, normalizeCourseKey } from '../../utils/courseKey';
import { loadAllCourses } from '../../utils/courseQuery';

// Petition form for one node, opened from that node's "⋯" menu
// (RequirementNodeMenu). Mode 'substitute' ("Substitute a course…") replaces
// ONE required course with a different one: step 1 picks which requirement
// is being replaced (skipped when only one is open), step 2 says which course
// counts instead — a course in the plan that nothing else is counting, or a
// course from somewhere else (transfer, study abroad, ...) typed in as text.
// The department approves petitions; any course can be chosen. Mode 'waive'
// ("Mark as done", UNRESOLVED nodes only) is a note only. One note per node:
// it isn't asked for again once the node already has one. Never adds anything
// to the plan or to external credit.
//
// Identical for both compact and full density — it's an overlay modal, so it
// doesn't need to know which panel opened it.
export default function ExceptionModal({
  node,
  mode,
  substituteOptions = [],
  hasNote = false,
  courseMap,
  onSubstitute,
  onSetOverride,
  onClose,
}) {
  // RequirementTree keys this modal by node id + mode, so the form starts
  // fresh each time it's opened.
  const [note, setNote] = useState('');
  const [slotIndex, setSlotIndex] = useState(null);
  // Step 2: 'plan' (a course in the plan) or 'outside' (somewhere else).
  const [source, setSource] = useState(null);
  const [pickedKey, setPickedKey] = useState('');
  const [outsideCourse, setOutsideCourse] = useState('');
  const [outsideSchool, setOutsideSchool] = useState('');

  if (!node) return null;

  const isSubstitute = mode === 'substitute';
  const slots = node.openSlots ?? [];
  // A single open choice needs no question.
  const slot = slots.length === 1 ? slots[0] : slots[slotIndex] ?? null;
  const outsideReady = Boolean(cleanSubstituteLabel(outsideCourse));
  const courseChosen = source === 'plan' ? Boolean(pickedKey) : source === 'outside' ? outsideReady : false;
  const canSave = isSubstitute ? Boolean(slot && courseChosen) : true;

  function slotLabel(candidate) {
    if (candidate.label) return candidate.label;
    return (candidate.keys ?? []).map((key) => formatCourseLabel(key, courseMap)).join(' or ');
  }

  async function submit() {
    if (!canSave) return;
    const trimmed = note.trim();
    if (isSubstitute) {
      const base = { replaces: slot.for ?? undefined, note: hasNote ? undefined : trimmed || undefined };
      if (source === 'plan') {
        onSubstitute(node, { ...base, courseKey: pickedKey });
      } else {
        // Typed text that is exactly a catalog course (and has no school) is
        // stored as that course, so it shows its catalog name; anything else
        // is kept as a plain-text label.
        const key = normalizeCourseKey(outsideCourse);
        const school = cleanSubstituteLabel(outsideSchool);
        const catalog = school ? [] : await loadAllCourses().catch(() => []);
        if (catalog.some((course) => course.id === key)) {
          onSubstitute(node, { ...base, courseKey: key });
        } else {
          onSubstitute(node, { ...base, label: cleanSubstituteLabel(school ? `${outsideCourse} — ${school}` : outsideCourse) });
        }
      }
    } else {
      onSetOverride(node.id, { type: 'waive', note: trimmed || null });
    }
    onClose();
  }

  return (
    <div className="search-picker-overlay" onClick={onClose}>
      <div className="search-picker-modal req-exception-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-picker-header">
          <h3>{`${isSubstitute ? 'Substitute a course' : 'Exception'}: ${node.label}`}</h3>
          <button type="button" className="search-picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="req-petition-form req-exception-form">
          {isSubstitute && slots.length === 0 && (
            <p className="req-node-detail">Nothing left to substitute.</p>
          )}
          {isSubstitute && slots.length > 1 && (
            <fieldset className="req-petition-field req-petition-choices">
              <legend>Which requirement are you replacing?</legend>
              {slots.map((candidate, i) => (
                <label key={candidate.for ?? i} className="req-petition-choice">
                  <input
                    type="radio"
                    name="req-substitute-slot"
                    checked={slotIndex === i}
                    onChange={() => setSlotIndex(i)}
                  />
                  <span>{slotLabel(candidate)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {isSubstitute && slots.length > 0 && (
            <fieldset className="req-petition-field req-petition-choices">
              <legend>Which course counts instead?</legend>
              <label className="req-petition-choice">
                <input type="radio" name="req-substitute-source" checked={source === 'plan'} onChange={() => setSource('plan')} />
                <span>A course in my plan</span>
              </label>
              {source === 'plan' && (
                <select value={pickedKey} onChange={(e) => setPickedKey(e.target.value)}>
                  <option value="">{substituteOptions.length > 0 ? '— pick a course —' : '— no free courses in your plan —'}</option>
                  {substituteOptions.map((key) => (
                    <option key={key} value={key}>
                      {formatCourseLabel(key, courseMap)}
                    </option>
                  ))}
                </select>
              )}
              <label className="req-petition-choice">
                <input type="radio" name="req-substitute-source" checked={source === 'outside'} onChange={() => setSource('outside')} />
                <span>A course from somewhere else (transfer, study abroad, etc.)</span>
              </label>
              {source === 'outside' && (
                <>
                  <label className="req-petition-field">
                    <span>Course (code or name)</span>
                    <input
                      type="text"
                      maxLength={80}
                      placeholder="e.g. ECON 1115"
                      value={outsideCourse}
                      onChange={(e) => setOutsideCourse(e.target.value)}
                    />
                  </label>
                  <label className="req-petition-field">
                    <span>School or program (optional)</span>
                    <input
                      type="text"
                      maxLength={60}
                      placeholder="e.g. Northeastern"
                      value={outsideSchool}
                      onChange={(e) => setOutsideSchool(e.target.value)}
                    />
                  </label>
                  <span className="req-node-detail">
                    Transfer credit is added separately under External Credit. This only fills the requirement.
                  </span>
                </>
              )}
            </fieldset>
          )}
          {(!isSubstitute || slots.length > 0) && !(isSubstitute && hasNote) && (
            <label className="req-petition-field">
              <span>Note (optional)</span>
              <input
                type="text"
                placeholder="e.g. Approved by advisor, 3/2026"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <div className="req-petition-form-actions">
            {(!isSubstitute || slots.length > 0) && (
              <button type="button" className="req-petition-save" onClick={submit} disabled={!canSave}>
                Save
              </button>
            )}
            <button type="button" className="req-petition-cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
