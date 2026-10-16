import { useEffect, useRef, useState } from 'react';

// Per-node "⋯" menu — the entry point for petitions. A petition replaces one
// required course with a different course ("Substitute a course…") on leaf
// nodes that have courses of their own (course lists, COUNT, REMAINDER,
// SEQUENCE_GROUP); each existing substitution gets its own "Undo
// substitution: …". UNRESOLVED nodes keep "Mark as done" / "Undo". Pure
// containers and ONE_OF have no courses of their own, so they only show
// "Undo" for an older whole-node waive, and hide the menu when there's
// nothing to offer. Reuses the header account dropdown's look
// (.tp-user-dropdown). Clicks inside never reach the node header, so
// opening the menu doesn't also collapse/expand the node.
//
// Escape is caught on window in the capture phase and stopped there, so it
// closes only this menu — not RequirementsFullView (or CourseInfoPanel),
// whose own Escape listeners sit on window in the bubble phase.
export default function RequirementNodeMenu({
  node,
  onMarkDone,
  onUndo,
  onSubstitute,
  onUndoSubstitution,
  courseLabel = (sub) => sub.courseKey ?? sub.label,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  // Older whole-node overrides (a waive, or a substitute on an UNRESOLVED
  // node): nothing creates them anymore, but they can still be undone.
  const isOverridden = Boolean(node.waived || node.substituted);
  const isUnresolved = node.type === 'UNRESOLVED';
  const hasCourses = node.type === 'COUNT' || node.type === 'REMAINDER' || node.type === 'SEQUENCE_GROUP'
    || (node.type === 'ALL' && !Array.isArray(node.children));
  const substitutions = node.substitutions ?? [];
  const canSubstitute = hasCourses && !isOverridden && (node.openSlots?.length ?? 0) > 0;
  const hasItems = isOverridden || isUnresolved || canSubstitute || (hasCourses && substitutions.length > 0);

  function choose(action) {
    setOpen(false);
    action(node);
  }

  if (!hasItems) return null;

  const item = (label, onClick, key) => (
    <button key={key ?? label} type="button" role="menuitem" className="tp-user-dropdown-item" onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="req-node-menu"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
    >
      <button
        type="button"
        className="req-node-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Options for ${node.label}`}
        title="Options"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="tp-user-dropdown req-node-menu-dropdown" role="menu">
          {isOverridden ? (
            item('Undo', () => choose(onUndo))
          ) : isUnresolved ? (
            item('Mark as done', () => choose(onMarkDone))
          ) : (
            <>
              {canSubstitute && item('Substitute a course…', () => choose(onSubstitute))}
              {substitutions.map((sub, index) => item(
                `Undo substitution: ${courseLabel(sub)}`,
                () => {
                  setOpen(false);
                  onUndoSubstitution(node, index);
                },
                `undo-${sub.courseKey ?? sub.label}`,
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
