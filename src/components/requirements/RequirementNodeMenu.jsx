import { useEffect, useRef, useState } from 'react';

// Per-node "⋯" menu — the entry point for waive/substitute exceptions
// (replaces the old global "Report an exception" button). Reuses the header
// account dropdown's look (.tp-user-dropdown). Clicks inside never reach the
// node header, so opening the menu doesn't also collapse/expand the node.
//
// Escape is caught on window in the capture phase and stopped there, so it
// closes only this menu — not RequirementsFullView (or CourseInfoPanel),
// whose own Escape listeners sit on window in the bubble phase.
export default function RequirementNodeMenu({ node, onMarkDone, onCountDifferent, onUndo }) {
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

  const isOverridden = Boolean(node.waived || node.substituted);
  // ALL / ONE_OF nodes have no slot a substitute could fill — the engine
  // ignores substitute overrides on them (see evaluateSubstituted).
  const canSubstitute = node.type !== 'ALL' && node.type !== 'ONE_OF';

  function choose(action) {
    setOpen(false);
    action(node);
  }

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
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="tp-user-dropdown req-node-menu-dropdown" role="menu">
          {isOverridden ? (
            <button type="button" role="menuitem" className="tp-user-dropdown-item" onClick={() => choose(onUndo)}>
              Undo
            </button>
          ) : (
            <>
              <button type="button" role="menuitem" className="tp-user-dropdown-item" onClick={() => choose(onMarkDone)}>
                Mark as done
              </button>
              {canSubstitute && (
                <button
                  type="button"
                  role="menuitem"
                  className="tp-user-dropdown-item"
                  onClick={() => choose(onCountDifferent)}
                >
                  Count a different course
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
