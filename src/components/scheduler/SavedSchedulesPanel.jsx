import { useState } from 'react';
import { CURRENT_TERM_LABEL } from '../../utils/term';
import { describeSectionSet } from '../../utils/scheduleCombos';

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
}) {
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const canSave = previewSectionIds.length > 0;

  function handleSave(e) {
    e.preventDefault();
    if (!canSave) return;
    onSave(name.trim() || `Schedule ${savedSchedules.length + 1}`);
    setName('');
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

  // Favorited first, then most recently updated within each group.
  const sorted = [...savedSchedules].sort((a, b) => {
    if (Boolean(b.favorited) !== Boolean(a.favorited)) return b.favorited ? 1 : -1;
    return 0;
  });

  return (
    <div className="sched-saved-panel">
      {/* Save is the one action in this box that actually preserves
          something — the name field is just optional labeling for it, so
          it's styled as the loud, primary control with the input visually
          secondary (see .sched-save-btn / .sched-save-name-input below). */}
      <div className="sched-save-section">
        <div className="sched-save-heading">Save the schedule you’re previewing as a contender</div>
        <form className="sched-save-form" onSubmit={handleSave}>
          <button type="submit" className="sched-save-btn" disabled={!canSave}>
            {canSave ? `Save this schedule${creditsLabel ? ` · ${creditsLabel}` : ''}` : 'Preview a schedule to save it'}
          </button>
          <input
            type="text"
            className="sched-save-name-input"
            placeholder="Optional name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canSave}
          />
        </form>
      </div>

      <div className="sched-saved-list">
        {sorted.length === 0 && (
          <div className="search-empty sched-saved-empty">
            No saved schedules yet for {CURRENT_TERM_LABEL}.
          </div>
        )}
        {sorted.map((schedule) => {
          const { compact, lines } = describeSectionSet(schedule.selectedSectionIds || [], sectionsById, courseMap);
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
        })}
      </div>
    </div>
  );
}
