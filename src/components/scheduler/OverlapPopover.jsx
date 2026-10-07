import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A small popover anchored to an "overlap" chip, listing the sections that
// overlap there with two actions each. Rendered through a portal at fixed
// coordinates so the grid's scroll area can't clip it, and so it works the same
// for a tap as for a click. `anchorEl` is the chip; `rows` is [{ id, label, time }].
//
// It stays put through scrolling and resizing: it just follows its chip. It
// closes only when the chip leaves the viewport (scrolled out of the page or out
// of the grid's own scroll area), on Esc, or on a press outside.
export default function OverlapPopover({ anchorEl, rows, onFindAnotherTime, onRemove, onClose }) {
  const ref = useRef(null);
  const frame = useRef(0);
  const [pos, setPos] = useState(() => {
    const r = anchorEl.getBoundingClientRect();
    return { left: r.left, top: r.bottom + 6 };
  });

  // Below the chip, or above it when there's no room, kept inside the window.
  function place() {
    const el = ref.current;
    if (!el || !anchorEl.isConnected) return;
    const margin = 8;
    const r = anchorEl.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    const below = r.bottom + 6;
    const top = below + height > window.innerHeight - margin ? Math.max(margin, r.top - height - 6) : below;
    setPos((cur) => (cur.left === left && cur.top === top ? cur : { left, top }));
  }

  useLayoutEffect(place, [anchorEl, rows.length]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    function onPointerDown(e) {
      if (ref.current?.contains(e.target)) return;
      // The chip toggles the popover itself; don't close-then-reopen it.
      if (e.target.closest?.('.sched-grid-block-chip.is-overlap')) return;
      onClose();
    }
    function onMove() {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(place);
    }
    // Fully out of view (page or an ancestor's scroll area): nothing to point at.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) onClose();
    });
    observer.observe(anchorEl);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      cancelAnimationFrame(frame.current);
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [anchorEl, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div
      ref={ref}
      className="sched-overlap-popover"
      role="dialog"
      aria-label="Overlapping sections"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="sched-overlap-popover-title">These overlap</div>
      {rows.map((row) => (
        <div className="sched-overlap-popover-row" key={row.id}>
          <div className="sched-overlap-popover-label">
            {row.label}{row.time && <span className="sched-overlap-popover-time"> · {row.time}</span>}
          </div>
          <div className="sched-overlap-popover-actions">
            <button type="button" onClick={() => onFindAnotherTime(row.id)}>Find another time</button>
            <button type="button" className="is-remove" onClick={() => onRemove(row.id)}>Remove</button>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
