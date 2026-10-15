import { useEffect, useRef, useState } from 'react';

const KEY_STEP = 16;

// Thin vertical drag handle on a panel's LEFT edge (dragging left widens
// the panel). Pointer events with capture, so the drag keeps going even
// when the cursor crosses the board; text selection is off while dragging.
// Focusable: Left/Right arrows resize by 16px. Double-click resets to the
// CSS default. `panelRef` is the panel being resized (its live width is the
// drag's starting point).
export default function PanelResizeHandle({
  panelRef,
  width,
  min,
  max,
  onResize,
  onReset,
  onDraggingChange,
  label = 'Resize panel',
}) {
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef(null);
  const keyBase = useRef(null);

  function currentWidth() {
    return width ?? panelRef.current?.getBoundingClientRect().width ?? min;
  }

  function setDragState(next) {
    setDragging(next);
    onDraggingChange?.(next);
    document.body.style.userSelect = next ? 'none' : '';
    document.body.style.cursor = next ? 'col-resize' : '';
  }

  function handlePointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, width: currentWidth() };
    setDragState(true);
  }

  function handlePointerMove(e) {
    if (!dragStart.current) return;
    onResize(dragStart.current.width + (dragStart.current.x - e.clientX));
  }

  function endDrag(e) {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragState(false);
  }

  // Rapid key presses land before the new width renders, so step from the
  // last width we asked for (cleared once a new width arrives).
  useEffect(() => {
    keyBase.current = null;
  }, [width]);

  function handleKeyDown(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const base = keyBase.current ?? currentWidth();
    const next = Math.min(Math.max(base + (e.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP), min), max);
    keyBase.current = next;
    onResize(next);
  }

  return (
    <div
      className={`panel-resize-handle${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width ?? min)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  );
}
