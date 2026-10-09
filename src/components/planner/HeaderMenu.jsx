import { useEffect, useId, useRef, useState } from 'react';

// A small dropdown button for the planner toolbar. Same open/close behavior
// as UserMenu (outside click, Escape, focus into the menu, arrow keys) and
// the same .tp-user-dropdown look, so it follows the theme like the account
// menu. `items` is [{ key, label, hint?, disabled?, dividerBefore?, onSelect }];
// `hint` is state text shown under the label.
export default function HeaderMenu({ label, items, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Move focus into the menu on open so keyboard users land on an action.
  useEffect(() => {
    if (open) menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  function handleMenuKeyDown(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const enabled = [...menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    if (enabled.length === 0) return;
    const i = enabled.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % enabled.length : (i - 1 + enabled.length) % enabled.length;
    enabled[next]?.focus();
  }

  function select(item) {
    setOpen(false);
    item.onSelect();
  }

  return (
    <div className={`pdf-menu ${className}`.trim()} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="pdf-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <svg className="pdf-menu-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div id={menuId} className="tp-user-dropdown" role="menu" ref={menuRef} onKeyDown={handleMenuKeyDown}>
          {items.map((item) => (
            <div key={item.key} className="pdf-menu-entry">
              {item.dividerBefore && <div className="pdf-menu-divider" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className="tp-user-dropdown-item"
                disabled={item.disabled}
                onClick={() => select(item)}
              >
                {item.label}
                {item.hint && <span className="pdf-menu-hint">{item.hint}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
