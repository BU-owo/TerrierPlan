import { useEffect, useId, useRef, useState } from 'react';

// Dropdown for a `selection: "student"` ONE_OF (BSBA concentration): a
// full-width button showing the pick (or the placeholder), opening a
// single-column list. While something is picked, the first row clears it (the
// only way to); picking the current one again just closes the list. Mouse,
// arrow keys + Enter/Space, Home/End; Esc, Tab or a click outside closes.
// `options` are labels in order; `picked` is an index or null;
// `onPick(index | null)`.
export default function PickDropdown({ label, options, picked, onPick, placeholder, clearLabel }) {
  const [open, setOpen] = useState(false);
  // The clear row is shown only while something is picked.
  const hasClear = picked != null;
  const offset = hasClear ? 1 : 0;
  // Highlighted row: with the clear row, 0 = clear and i + 1 = options[i];
  // without it, i = options[i].
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const baseId = useId();
  const rowId = (row) => `${baseId}-row-${row}`;
  const rowCount = options.length + offset;

  function openList() {
    setActive(picked == null ? 0 : picked + offset);
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function choose(row) {
    const index = hasClear && row === 0 ? null : row - offset;
    // Re-picking the current option keeps it (nothing to save).
    if (index !== picked) onPick(index);
    close();
  }

  useEffect(() => {
    if (!open) return undefined;
    listRef.current?.focus();
    function handlePointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key !== 'Escape') return;
      // Don't let Esc also close the full view behind it.
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  // Keep the highlighted row in view while arrowing through a scrolled list.
  useEffect(() => {
    if (open) document.getElementById(`${baseId}-row-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, baseId]);

  function handleButtonKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    }
  }

  function handleListKeyDown(e) {
    if (e.key === 'ArrowDown') setActive((row) => Math.min(rowCount - 1, row + 1));
    else if (e.key === 'ArrowUp') setActive((row) => Math.max(0, row - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(rowCount - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Tab') { setOpen(false); return; }
    else return;
    e.preventDefault();
  }

  const pickedLabel = picked == null ? null : options[picked];

  return (
    <div className="req-pick" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`req-pick-button${pickedLabel ? ' has-pick' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={pickedLabel ? `${label}: ${pickedLabel}` : label}
        onClick={() => (open ? close() : openList())}
        onKeyDown={handleButtonKeyDown}
      >
        <span className="req-pick-button-text">{pickedLabel ?? placeholder}</span>
        <span className="req-pick-chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul
          ref={listRef}
          className="req-pick-list"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={rowId(active)}
          onKeyDown={handleListKeyDown}
        >
          {(hasClear ? [clearLabel, ...options] : options).map((text, row) => {
            const isClear = hasClear && row === 0;
            const isPicked = !isClear && row - offset === picked;
            return (
              <li
                key={row}
                id={rowId(row)}
                role="option"
                aria-selected={isPicked}
                className={`req-pick-option${row === active ? ' is-active' : ''}${isPicked ? ' is-picked' : ''}${isClear ? ' is-clear' : ''}`}
                onMouseEnter={() => setActive(row)}
                onClick={() => choose(row)}
              >
                <span className="req-pick-check" aria-hidden="true">{isPicked ? '✓' : ''}</span>
                {text}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
