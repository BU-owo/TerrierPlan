import { useState, useEffect } from 'react';
import { normalizeCourseKey } from '../../utils/courseKey';
import PetitionActiveDisplay from './PetitionActiveDisplay';

// The single entry point for reporting a waive/substitute exception,
// replacing what used to be a "Mark as waived"/"Mark as petitioned" trigger
// on every node. Opened either generically (initialNodeId null — the top
// "Report an exception" button, picker step first) or pre-targeted at one
// node (from the UNRESOLVED summary list, straight to the form). UNRESOLVED
// nodes get the substitute form (pick a course already in the plan, or add a
// new one); every other node type gets the waive form (note only).
//
// Identical for both compact and full density — it's an overlay modal, so it
// doesn't need to know which panel opened it.
export default function ExceptionModal({
  open,
  initialNodeId,
  flatNodes,
  requirementOverrides,
  planCourseKeySet,
  courseMap,
  onAddCourse,
  onSetOverride,
  onRemoveOverride,
  onClose,
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(initialNodeId ?? null);
  const [note, setNote] = useState('');
  const [substituteKey, setSubstituteKey] = useState('');
  const [customKey, setCustomKey] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedNodeId(initialNodeId ?? null);
    setNote('');
    setSubstituteKey('');
    setCustomKey('');
  }, [open, initialNodeId]);

  if (!open) return null;

  const selectedNode = flatNodes.find((n) => n.id === selectedNodeId) || null;
  const override = selectedNode ? requirementOverrides?.[selectedNode.id] : null;
  const isUnresolved = selectedNode?.type === 'UNRESOLVED';
  const planCourseOptions = Array.from(planCourseKeySet).sort();

  function submit() {
    if (!selectedNode) return;
    if (isUnresolved) {
      const trimmedCustom = customKey.trim();
      if (substituteKey) {
        onSetOverride(selectedNode.id, { type: 'substitute', courseKey: substituteKey, note: note.trim() || null });
      } else if (trimmedCustom) {
        const key = normalizeCourseKey(trimmedCustom);
        onAddCourse(key);
        onSetOverride(selectedNode.id, { type: 'substitute', courseKey: key, note: note.trim() || null });
      } else {
        return;
      }
    } else {
      onSetOverride(selectedNode.id, { type: 'waive', note: note.trim() || null });
    }
    onClose();
  }

  return (
    <div className="search-picker-overlay" onClick={onClose}>
      <div className="search-picker-modal req-exception-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-picker-header">
          <h3>{selectedNode ? `Exception: ${selectedNode.label}` : 'Report an exception'}</h3>
          <button type="button" className="search-picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!selectedNode && (
          <div className="search-picker-options">
            {flatNodes.map((n) => (
              <button
                key={n.id}
                type="button"
                className="search-picker-option"
                onClick={() => setSelectedNodeId(n.id)}
              >
                {n.label}
                {requirementOverrides?.[n.id] && <span className="req-exception-existing-tag"> (reported)</span>}
              </button>
            ))}
          </div>
        )}

        {selectedNode && override && (
          <div className="req-exception-body">
            <PetitionActiveDisplay
              node={selectedNode}
              override={override}
              courseMap={courseMap}
              onRemoveOverride={(id) => { onRemoveOverride(id); onClose(); }}
            />
            <div className="req-petition-form-actions">
              <button type="button" className="req-petition-cancel" onClick={() => setSelectedNodeId(null)}>
                Choose a different requirement
              </button>
            </div>
          </div>
        )}

        {selectedNode && !override && (
          <div className="req-petition-form req-exception-form">
            {isUnresolved && (
              <>
                <label className="req-petition-field">
                  <span>Course already in your plan</span>
                  <select
                    value={substituteKey}
                    onChange={(e) => { setSubstituteKey(e.target.value); setCustomKey(''); }}
                  >
                    <option value="">— none —</option>
                    {planCourseOptions.map((key) => (
                      <option key={key} value={key}>
                        {courseMap[key]?.courseNumber ?? key}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="req-petition-field">
                  <span>Or a course code not yet in your plan</span>
                  <input
                    type="text"
                    placeholder="e.g. CAS CS 599"
                    value={customKey}
                    onChange={(e) => { setCustomKey(e.target.value); setSubstituteKey(''); }}
                  />
                </label>
              </>
            )}
            <label className="req-petition-field">
              <span>Note (optional)</span>
              <input
                type="text"
                placeholder="e.g. Approved by advisor, 3/2026"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="req-petition-form-actions">
              <button type="button" className="req-petition-save" onClick={submit}>Save</button>
              <button type="button" className="req-petition-cancel" onClick={() => setSelectedNodeId(null)}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
