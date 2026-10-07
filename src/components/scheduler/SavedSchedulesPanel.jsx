import { useState } from 'react';
import { CURRENT_TERM, CURRENT_TERM_LABEL, scheduleTerm, termLabel } from '../../utils/term';
import { describeSectionSet, scheduleKey, overlapSummary } from '../../utils/scheduleCombos';
import GuestSignInButton from '../GuestSignInButton';

// Small inline pencil glyph for the rename affordance — a real icon asset
// rather than a text/emoji dingbat, matching CourseSearch's PawIcon and
// ScheduleStepper's FlagIcon.
function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.5 4.5l5 5L8 21H3v-5z" />
    </svg>
  );
}

export default function SavedSchedulesPanel({
  previewSectionIds,
  creditsLabel,
  savedSchedules,
  activeSavedId,
  sectionsById,
  courseMap,
  onSave,
  onRename,
  onToggleFavorite,
  onDelete,
  onLoad,
  actionError = null,
  onDismissError = () => {},
  isGuest = false,
  saveNote = null,
}) {
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  // scheduleKey of the combination this panel last saved successfully, so the
  // button can read "Saved ✓" until the displayed combination changes.
  const [justSavedKey, setJustSavedKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const canSave = previewSectionIds.length > 0;
  const previewKey = canSave ? scheduleKey(previewSectionIds) : null;
  // Already saved = a saved schedule with the same set of sections
  // (order-independent), whatever its term — section ids carry their term, so
  // this also stops a previewed other-term schedule from being re-saved as a
  // current-term one. Also what keeps "Saved ✓" honest: if that schedule is
  // later deleted, the button re-enables.
  const alreadySaved = canSave && savedSchedules.some(
    (s) => scheduleKey(s.selectedSectionIds || []) === previewKey,
  );
  const justSaved = alreadySaved && justSavedKey === previewKey;
  const saveBlocked = !canSave || alreadySaved || saving;

  async function handleSave(e) {
    e.preventDefault();
    if (saveBlocked) return;
    setSaving(true);
    try {
      // "Schedule N" counts only this term's schedules.
      const currentCount = savedSchedules.filter((s) => scheduleTerm(s) === CURRENT_TERM).length;
      // onSave reports its own failure (actionError) and resolves false.
      const saved = await onSave(name.trim() || `Schedule ${currentCount + 1}`);
      if (saved) {
        setJustSavedKey(previewKey);
        setName('');
      }
    } finally {
      setSaving(false);
    }
  }

  function startEditing(schedule) {
    setEditingId(schedule.id);
    setEditValue(schedule.name);
  }

  function commitEdit(schedule) {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== schedule.name) onRename(schedule, trimmed);
    setEditingId(null);
  }

  // Every saved schedule is listed: the current term first, then each other
  // term (newest first) under its own heading. Grouping is display-only —
  // the parent's list, and guests' localStorage copy of it, is untouched.
  // Within a group: favorited first, then the order they arrived in (most
  // recently updated).
  const byTerm = new Map();
  for (const schedule of savedSchedules) {
    const term = scheduleTerm(schedule);
    if (!byTerm.has(term)) byTerm.set(term, []);
    byTerm.get(term).push(schedule);
  }
  const byFavorite = (a, b) => (Boolean(b.favorited) === Boolean(a.favorited) ? 0 : b.favorited ? 1 : -1);
  const termGroups = [
    { term: CURRENT_TERM, schedules: [...(byTerm.get(CURRENT_TERM) || [])].sort(byFavorite) },
    ...[...byTerm.keys()]
      .filter((term) => term !== CURRENT_TERM)
      .sort()
      .reverse()
      .map((term) => ({ term, schedules: [...byTerm.get(term)].sort(byFavorite) })),
  ];
  const showTermHeadings = termGroups.length > 1;

  function renderRow(schedule) {
    const { compact, lines } = describeSectionSet(schedule.selectedSectionIds || [], sectionsById, courseMap);
    // Only counts sections whose data is loaded (0 otherwise, so nothing shows).
    const overlaps = overlapSummary(schedule.selectedSectionIds || [], sectionsById).pairs;
    const isEditing = editingId === schedule.id;
    return (
      <div
        key={schedule.id}
        className={`sched-saved-row${activeSavedId === schedule.id ? ' is-active' : ''}`}
      >
        {isEditing ? (
          <div className="sched-saved-row-main is-editing">
            <input
              type="text"
              autoFocus
              className="sched-saved-row-name-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => commitEdit(schedule)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEdit(schedule);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingId(null);
                }
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="sched-saved-row-main"
            onClick={() => onLoad(schedule)}
            title={lines.join('\n')}
          >
            <span className="sched-saved-row-text">
              <span className="sched-saved-row-name">{schedule.name}</span>
              {/* "sections", not "courses" — a course with a companion
                  piece (discussion/lab) contributes more than one
                  section id. */}
              {compact && <span className="sched-saved-row-contents">{compact}</span>}
            </span>
            {overlaps > 0 && (
              <span className="sched-overlap-count">
                <span className="sched-visually-hidden"> · </span>
                {overlaps} overlap{overlaps === 1 ? '' : 's'}
              </span>
            )}
            <span className="sched-saved-row-count">{(schedule.selectedSectionIds || []).length} sections</span>
          </button>
        )}
        <button
          type="button"
          className="sched-rename-btn"
          onClick={() => startEditing(schedule)}
          aria-label={`Rename ${schedule.name}`}
          title="Rename"
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          className={`sched-favorite-btn${schedule.favorited ? ' is-favorited' : ''}`}
          onClick={() => onToggleFavorite(schedule)}
          aria-label={schedule.favorited ? 'Unfavorite' : 'Favorite'}
          title={schedule.favorited ? 'Unfavorite' : 'Favorite'}
        >
          {schedule.favorited ? '★' : '☆'}
        </button>
        <button
          type="button"
          className="sched-delete-btn"
          onClick={() => onDelete(schedule)}
          aria-label={`Delete ${schedule.name}`}
          title="Delete"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="sched-saved-panel">
      {/* Save is the one action in this box that actually preserves
          something — the name field is just optional labeling for it, so
          it's styled as the loud, primary control with the input visually
          secondary (see .sched-save-btn / .sched-save-name-input below). */}
      <div className="sched-save-section">
        <div className="sched-save-heading">Save the schedule you’re previewing as a contender</div>
        <form className="sched-save-form" onSubmit={handleSave}>
          <button type="submit" className={`sched-save-btn${alreadySaved ? ' is-saved' : ''}`} disabled={saveBlocked} title={canSave && saveNote ? saveNote : undefined}>
            {!canSave
              ? 'Preview a schedule to save it'
              : justSaved
                ? 'Saved ✓'
                : alreadySaved
                  ? 'Already saved'
                  : `Save this schedule${creditsLabel ? ` · ${creditsLabel}` : ''}`}
          </button>
          <input
            type="text"
            className="sched-save-name-input"
            placeholder="Optional name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saveBlocked}
          />
        </form>
        {actionError && (
          <div className="sched-saved-error" role="alert">
            <span>{actionError}</span>
            <button type="button" className="sched-saved-error-dismiss" onClick={onDismissError} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
      </div>

      <div className="sched-saved-list">
        {termGroups.map(({ term, schedules }) => (
          <div key={term} className="sched-saved-term-group">
            {showTermHeadings && (
              <div className="sched-saved-term-heading">
                {termLabel(term)}{term === CURRENT_TERM ? ' · current' : ''}
              </div>
            )}
            {schedules.length === 0 && (
              <div className="search-empty sched-saved-empty">
                No saved schedules yet for {CURRENT_TERM_LABEL}.
              </div>
            )}
            {schedules.map(renderRow)}
          </div>
        ))}
      </div>
      {/* Guests only, while the combination they just saved is still on
          screen: saved schedules sit in this browser until they sign in. */}
      {isGuest && justSaved && (
        <div className="sched-guest-save-note" role="status">
          <span className="guest-notice-text">
            <strong>Saved in this browser only.</strong> Sign in to keep it.
          </span>
          <GuestSignInButton className="guest-signin-btn" />
        </div>
      )}
    </div>
  );
}
