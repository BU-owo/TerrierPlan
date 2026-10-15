import { useState } from 'react';
import { formatCourseLabel } from './treeHelpers';

// Waive/substitute form for one node, opened from that node's "⋯" menu
// (RequirementNodeMenu): mode 'waive' ("Mark as done") is a note only;
// mode 'substitute' ("Count a different course") picks from
// `substituteOptions` — plan courses no requirement has claimed, or for a
// SEQUENCE_GROUP that sequence's own courses (see RequirementTree). Never
// adds anything to the plan.
//
// Identical for both compact and full density — it's an overlay modal, so it
// doesn't need to know which panel opened it.
export default function ExceptionModal({
  node,
  mode,
  substituteOptions = [],
  courseMap,
  onSetOverride,
  onClose,
}) {
  // RequirementTree keys this modal by node id + mode, so the form starts
  // fresh each time it's opened.
  const [note, setNote] = useState('');
  const [substituteKey, setSubstituteKey] = useState('');

  if (!node) return null;

  const isSubstitute = mode === 'substitute';
  const isSequence = node.type === 'SEQUENCE_GROUP';

  function submit() {
    if (isSubstitute) {
      if (!substituteKey) return;
      onSetOverride(node.id, { type: 'substitute', courseKey: substituteKey, note: note.trim() || null });
    } else {
      onSetOverride(node.id, { type: 'waive', note: note.trim() || null });
    }
    onClose();
  }

  return (
    <div className="search-picker-overlay" onClick={onClose}>
      <div className="search-picker-modal req-exception-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-picker-header">
          <h3>{`Exception: ${node.label}`}</h3>
          <button type="button" className="search-picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="req-petition-form req-exception-form">
          {isSubstitute && substituteOptions.length === 0 && (
            <p className="req-node-detail">Add it to your plan first.</p>
          )}
          {isSubstitute && substituteOptions.length > 0 && (
            <label className="req-petition-field">
              <span>{isSequence ? 'Course from this sequence' : 'Course already in your plan'}</span>
              <select value={substituteKey} onChange={(e) => setSubstituteKey(e.target.value)}>
                <option value="">— none —</option>
                {substituteOptions.map((key) => (
                  <option key={key} value={key}>
                    {formatCourseLabel(key, courseMap)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(!isSubstitute || substituteOptions.length > 0) && (
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
            {(!isSubstitute || substituteOptions.length > 0) && (
              <button
                type="button"
                className="req-petition-save"
                onClick={submit}
                disabled={isSubstitute && !substituteKey}
              >
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
