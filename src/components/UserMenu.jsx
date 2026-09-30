import { useEffect, useId, useRef, useState } from 'react';

function firstName(user) {
  return user?.displayName?.trim().split(/\s+/)[0] || user?.email?.split('@')[0] || '';
}

// Avatar button in AppHeader's first row. Opens a small dropdown holding
// the user's first name and Sign out, or Sign in for guests. The actual
// sign-in/out behavior comes from the page (see AppHeader's defaults) so
// PlannerPage can route both through its unsaved-changes guard.
export default function UserMenu({ user, loading, onSignOut, onSignIn }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const name = firstName(user);
  const initial = name.charAt(0).toUpperCase();

  // Outside click / Escape only need listening to while the menu is open.
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

  // Move focus into the menu on open so keyboard users land on the action.
  useEffect(() => {
    if (open) menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [open]);

  function handleMenuKeyDown(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  function runAndClose(action) {
    setOpen(false);
    action();
  }

  return (
    <div className="tp-user-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tp-avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={user ? `Account menu for ${name}` : 'Account menu'}
        title={user ? name : 'Sign in'}
        onClick={() => setOpen((v) => !v)}
        // Auth resolves a tick after mount — keep the space but don't flash
        // the guest icon at a signed-in user.
        style={loading ? { visibility: 'hidden' } : undefined}
      >
        {user?.photoURL ? (
          <img className="tp-avatar-img" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
        ) : user ? (
          <span className="tp-avatar-initial" aria-hidden="true">{initial || '?'}</span>
        ) : (
          <svg className="tp-avatar-guest" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="8" cy="5.5" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M2.75 13.5c.6-2.6 2.7-4 5.25-4s4.65 1.4 5.25 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {open && (
        <div id={menuId} className="tp-user-dropdown" role="menu" ref={menuRef} onKeyDown={handleMenuKeyDown}>
          {user ? (
            <>
              <div className="tp-user-dropdown-name">{name}</div>
              <button type="button" role="menuitem" className="tp-user-dropdown-item" onClick={() => runAndClose(onSignOut)}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" role="menuitem" className="tp-user-dropdown-item" onClick={() => runAndClose(onSignIn)}>
              Sign in
            </button>
          )}
        </div>
      )}
    </div>
  );
}
