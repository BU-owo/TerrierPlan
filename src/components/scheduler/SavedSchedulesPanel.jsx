import { useState } from 'react';
import { CURRENT_TERM_LABEL } from '../../utils/term';

export default function SavedSchedulesPanel({
  previewSectionIds,
  creditsLabel,
  savedSchedules,
  activeSavedId,
  onSave,
  onToggleFavorite,
  onDelete,
  onLoad,
}) {
  const [name, setName] = useState('');
  const canSave = previewSectionIds.length > 0;

  function handleSave(e) {
    e.preventDefault();
    if (!canSave) return;
    onSave(name.trim() || `Schedule ${savedSchedules.length + 1}`);
    setName('');
  }

  // Favorited first, then most recently updated within each group.
  const sorted = [...savedSchedules].sort((a, b) => {
    if (Boolean(b.favorited) !== Boolean(a.favorited)) return b.favorited ? 1 : -1;
    return 0;
  });

  return (
    <div className="sched-saved-panel">
      <form className="sched-save-form" onSubmit={handleSave}>
        <input
          type="text"
          className="sched-save-name-input"
          placeholder={canSave ? 'Name this schedule…' : 'Preview a schedule to save it'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canSave}
        />
        <button type="submit" className="sched-save-btn" disabled={!canSave}>
          Save{creditsLabel ? ` (${creditsLabel})` : ''}
        </button>
      </form>

      <div className="sched-saved-list">
        {sorted.length === 0 && (
          <div className="search-empty sched-saved-empty">
            No saved schedules yet for {CURRENT_TERM_LABEL}.
          </div>
        )}
        {sorted.map((schedule) => (
          <div
            key={schedule.id}
            className={`sched-saved-row${activeSavedId === schedule.id ? ' is-active' : ''}`}
          >
            <button
              type="button"
              className="sched-saved-row-main"
              onClick={() => onLoad(schedule)}
              title="Load into the grid"
            >
              <span className="sched-saved-row-name">{schedule.name}</span>
              {/* "sections", not "courses" — a course with a companion piece
                  (discussion/lab) contributes more than one section id. */}
              <span className="sched-saved-row-count">{schedule.selectedSectionIds.length} sections</span>
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
        ))}
      </div>
    </div>
  );
}
