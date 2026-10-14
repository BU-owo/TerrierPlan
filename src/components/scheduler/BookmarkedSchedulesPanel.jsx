import { useEffect, useRef, useState } from 'react';
import { describeSectionSet, totalCredits, overlapSummary, scheduleSummary, scheduleChipLabel, bookmarkStep } from '../../utils/scheduleCombos';
import FlagIcon from './FlagIcon';

// One numbered chip per bookmark, in a single horizontally scrolling row, so the
// shortlist can be flipped through without scrolling down to the list below.
// A chip does what a row click does (`onPreview`); the one matching the schedule
// on screen is highlighted and scrolled into view (inside the strip only). When
// the row overflows, a fade and ‹ › buttons mark the clipped edge(s).
export function BookmarkChipStrip({ bookmarks, states = {}, sectionsById, courseMap, activeKey, onPreview }) {
  const scrollRef = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const update = () => setEdge({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [bookmarks.length]);

  // Bring the active chip into view by scrolling the strip itself, never the page.
  useEffect(() => {
    const el = scrollRef.current;
    const chip = el?.querySelector('[aria-current="true"]');
    if (!el || !chip) return;
    const pad = 40;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < el.scrollLeft + pad) el.scrollTo({ left: Math.max(0, left - pad), behavior: 'smooth' });
    else if (right > el.scrollLeft + el.clientWidth - pad) el.scrollTo({ left: right - el.clientWidth + pad, behavior: 'smooth' });
  }, [activeKey]);

  if (bookmarks.length === 0) return null;
  // Prev / Next bookmark: through every bookmark in chip order (in the results or not).
  const step = bookmarkStep(bookmarks.map((b) => b.key), activeKey);
  const goTo = (key) => {
    const target = bookmarks.find((b) => b.key === key);
    if (target) onPreview(target.sectionIds);
  };
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!e.target.closest('button')) return;
    const key = e.key === 'ArrowLeft' ? step.prevKey : step.nextKey;
    e.preventDefault();
    if (key) goTo(key);
  };
  const scrollByPage = (dir) => scrollRef.current?.scrollBy({ left: dir * scrollRef.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <div className="sched-bookmark-browser" onKeyDown={onKeyDown}>
    <div className={`sched-bookmark-strip-wrap${edge.left ? ' has-left' : ''}${edge.right ? ' has-right' : ''}`}>
      {edge.left && (
        <button type="button" className="sched-bookmark-strip-arrow is-left" onClick={() => scrollByPage(-1)} aria-label="Scroll bookmarks left">
          ‹
        </button>
      )}
      <div className="sched-bookmark-strip" ref={scrollRef} role="group" aria-label="Bookmarked schedules">
        <span className="sched-bookmark-strip-icon"><FlagIcon filled /></span>
        {bookmarks.map(({ key, sectionIds }, i) => {
          const { compact, lines } = describeSectionSet(sectionIds, sectionsById, courseMap);
          const full = scheduleSummary(sectionIds, sectionsById) || 'No times';
          const active = activeKey === key;
          const state = states[key];
          // A marker only on chips that need one; the full wording goes to the label and tooltip.
          const tag = state?.stale ? state.staleReason : state && !state.inBatch ? 'not in results' : null;
          const tagNote = state?.stale
            ? `This bookmark is out of date (${state.staleReason}). It still previews.`
            : tag ? "Not in your current results, so it can't be stepped through with the results." : null;
          return (
            <button
              key={key}
              type="button"
              className={`sched-bookmark-chip${active ? ' is-active' : ''}`}
              aria-current={active ? 'true' : undefined}
              aria-label={`Bookmark ${i + 1}: ${compact || `${sectionIds.length} sections`}, ${full}${tagNote ? `. ${tagNote}` : ''}`}
              title={[full, ...(tagNote ? [tagNote] : []), ...lines].join('\n')}
              onClick={() => onPreview(sectionIds)}
            >
              {scheduleChipLabel(sectionIds, sectionsById, i + 1)}
              {tag && <span className="sched-bookmark-chip-tag">{tag}</span>}
            </button>
          );
        })}
      </div>
      {edge.right && (
        <button type="button" className="sched-bookmark-strip-arrow is-right" onClick={() => scrollByPage(1)} aria-label="Scroll bookmarks right">
          ›
        </button>
      )}
    </div>
    <div className="sched-bookmark-nav">
      <button type="button" className="sched-bookmark-nav-btn" disabled={!step.prevKey} onClick={() => goTo(step.prevKey)}>
        ‹ Prev bookmark
      </button>
      <span className="sched-bookmark-nav-count" aria-live="polite">
        {step.n > 0 ? `Bookmark ${step.n} of ${bookmarks.length}` : `${bookmarks.length} bookmark${bookmarks.length === 1 ? '' : 's'}`}
      </span>
      <button type="button" className="sched-bookmark-nav-btn" disabled={!step.nextKey} onClick={() => goTo(step.nextKey)}>
        Next bookmark ›
      </button>
    </div>
    </div>
  );
}

// The lightweight shortlist from the stepper's bookmark toggle — separate
// from SavedSchedulesPanel below it. Bookmarking is meant to be quick and
// disposable ("maybe this one") while browsing combinations; saving is the
// deliberate "keep this one" action. Bookmarks live in SchedulerPage state,
// mirrored to this browser's localStorage with the draft (see
// utils/draftStorage.js) — not to Firestore, so they never follow the
// student to another device — and persist across draft/search changes; only
// "Clear all" here wipes them, not touching a course or regenerating.
export default function BookmarkedSchedulesPanel({
  bookmarks, // [{ key, sectionIds }]
  sectionsById,
  courseMap,
  activeKey,
  onPreview,
  onPromote,
  onRemove,
  onClearAll,
  staleCount = 0,
  onRemoveStale = () => {},
  // Auto mode: the list sits behind a "Manage bookmarks" toggle, collapsed by
  // default (the chip strip above the grid is the everyday way in). Manual mode
  // keeps it open as before.
  collapsible = false,
}) {
  const [open, setOpen] = useState(false);
  if (bookmarks.length === 0) return null;
  const shown = !collapsible || open;

  return (
    <div className="sched-bookmarks-panel">
      {collapsible && (
        <button
          type="button"
          className="sched-save-toggle"
          aria-expanded={open}
          aria-controls="sched-bookmarks-list-region"
          onClick={() => setOpen((o) => !o)}
        >
          <span>Manage bookmarks ({bookmarks.length})</span>
        </button>
      )}
      {shown && (
        <div id="sched-bookmarks-list-region" className="sched-bookmarks-region">
      <div className="sched-bookmarks-header">
        <span className="sched-bookmarks-title">
          <FlagIcon filled /> Bookmarked ({bookmarks.length})
        </span>
        <span className="sched-bookmarks-actions">
          {staleCount > 0 && (
            <button
              type="button"
              className="sched-bookmarks-clear-btn"
              onClick={onRemoveStale}
              title="Remove bookmarks whose course or sections have changed"
            >
              Remove out-of-date ({staleCount})
            </button>
          )}
          <button type="button" className="sched-bookmarks-clear-btn" onClick={onClearAll}>
            Clear all
          </button>
        </span>
      </div>
      <div className="sched-bookmarks-note">
        A shortlist kept in this browser — it isn’t a saved schedule. Use Save to keep one.
      </div>
      <div className="sched-bookmarks-list">
        {bookmarks.map(({ key, sectionIds }) => {
          const { compact, lines } = describeSectionSet(sectionIds, sectionsById, courseMap);
          const credits = totalCredits(sectionIds, sectionsById);
          const overlaps = overlapSummary(sectionIds, sectionsById).pairs;
          const meta = scheduleSummary(sectionIds, sectionsById);
          return (
            <div key={key} className={`sched-bookmark-row${activeKey === key ? ' is-active' : ''}`}>
              <button
                type="button"
                className="sched-bookmark-row-main"
                onClick={() => onPreview(sectionIds)}
                title={lines.join('\n')}
              >
                <span className="sched-bookmark-row-text">
                  <span className="sched-bookmark-row-summary">{compact || `${sectionIds.length} sections`}</span>
                  {meta && <span className="sched-bookmark-row-meta">{meta}</span>}
                </span>
                {overlaps > 0 && (
                  <span className="sched-overlap-count">
                    <span className="sched-visually-hidden"> · </span>
                    {overlaps} overlap{overlaps === 1 ? '' : 's'}
                  </span>
                )}
                <span className="sched-bookmark-row-credits">{credits} cr</span>
              </button>
              <button
                type="button"
                className="sched-bookmark-save-btn"
                onClick={() => onPromote(key, sectionIds)}
                title="Save this as a schedule (listed under Saved schedules) and take it off the shortlist"
              >
                Save schedule
              </button>
              <button
                type="button"
                className="sched-bookmark-remove-btn"
                onClick={() => onRemove(key)}
                aria-label="Remove bookmark"
                title="Remove bookmark"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
        </div>
      )}
    </div>
  );
}
