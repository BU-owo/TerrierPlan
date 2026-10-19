import { useEffect, useRef } from 'react';

// Shared dialog behavior: focus moves into the dialog (to `[data-autofocus]`,
// else the first control), Tab stays inside it, Esc cancels, and focus goes
// back to where it was when it closes.
function useDialog(onCancel) {
  const ref = useRef(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const previous = document.activeElement;
    const root = ref.current;
    const focusable = () => [...root.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled);
    (root.querySelector('[data-autofocus]') ?? focusable()[0])?.focus();
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus?.();
    };
  }, []);
  return ref;
}

// "Remove Marine Semester" for a term that holds real courses: they go to
// Paw-tential Courses (the default) or are deleted. onMove / onDelete / onCancel.
export function MarineRemoveDialog({ count, allMarine, onMove, onDelete, onCancel }) {
  const ref = useDialog(onCancel);
  const noun = allMarine ? 'Marine Semester course' : 'course';
  return (
    <div className="beta-overlay" onClick={onCancel}>
      <div
        ref={ref}
        className="beta-modal marine-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="marine-remove-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="marine-remove-title">Remove Marine Semester</h2>
        <p>This term has {count} {noun}{count === 1 ? '' : 's'}.</p>
        <div className="unsaved-modal-actions marine-dialog-actions">
          <button type="button" className="beta-dismiss-btn unsaved-modal-leave" data-autofocus onClick={onMove}>
            Move them to Paw-tential Courses
          </button>
          <button type="button" className="unsaved-modal-stay" onClick={onDelete}>Delete them</button>
          <button type="button" className="unsaved-modal-stay" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
