import { useState } from 'react';
import { DEFAULT_NOTE_CREDITS } from '../../utils/courseEntry';

// Free-text planning placeholder in a semester column (e.g. "Economics
// Elective", "MA123 or MA121") — see isNoteEntry in courseEntry.js. NOT a
// course: no drag, no lock, no HUB chips or offering warning. Its credits
// count toward the column/plan credit totals only. Text and credits are
// edited inline; `initiallyEditing` opens a freshly added note straight
// into the text field. `compact` ("All semesters" view): one line like a
// compact course card, with "Placeholder" moved into the tooltip.
export default function NoteCard({ note, initiallyEditing = false, onUpdate, onRemove, compact = false }) {
  const [isEditingText, setIsEditingText] = useState(initiallyEditing);
  const [textDraft, setTextDraft] = useState(note.text);
  const [isEditingCredits, setIsEditingCredits] = useState(false);
  const [creditsDraft, setCreditsDraft] = useState(String(note.credits));

  function startTextEdit() {
    setTextDraft(note.text);
    setIsEditingText(true);
  }

  function commitText() {
    setIsEditingText(false);
    const next = textDraft.trim();
    if (next !== note.text) onUpdate({ text: next });
  }

  function startCreditsEdit() {
    setCreditsDraft(String(note.credits));
    setIsEditingCredits(true);
  }

  function commitCredits() {
    setIsEditingCredits(false);
    const value = Number(creditsDraft);
    const next = creditsDraft.trim() !== '' && Number.isFinite(value) && value >= 0
      ? value
      : DEFAULT_NOTE_CREDITS;
    if (next !== note.credits) onUpdate({ credits: next });
  }

  const label = note.text || 'Untitled placeholder';

  return (
    <div
      className={`note-card${compact ? ' is-compact' : ''}`}
      title={compact ? `Placeholder: ${label} · ${note.credits} cr` : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="note-card-remove"
        onClick={onRemove}
        aria-label={`Remove placeholder ${label}`}
        title="Remove placeholder"
      >
        ×
      </button>
      {isEditingText ? (
        <input
          type="text"
          className="note-card-text-input"
          value={textDraft}
          placeholder="e.g. Economics Elective"
          aria-label="Placeholder text"
          autoFocus
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setTextDraft(note.text);
              setIsEditingText(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={`note-card-text${note.text ? '' : ' is-empty'}`}
          onClick={startTextEdit}
          title={compact ? undefined : 'Click to edit placeholder'}
        >
          {label}
        </button>
      )}
      <div className="note-card-footer">
        {isEditingCredits ? (
          <input
            type="number"
            className="note-card-credits-input"
            min="0"
            step="1"
            value={creditsDraft}
            aria-label="Placeholder credits"
            autoFocus
            onChange={(e) => setCreditsDraft(e.target.value)}
            onBlur={commitCredits}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setCreditsDraft(String(note.credits));
                setIsEditingCredits(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="note-card-credits"
            onClick={startCreditsEdit}
            title="Click to edit credits"
          >
            {note.credits} cr
          </button>
        )}
        {!compact && <span className="note-card-tag">Placeholder</span>}
      </div>
    </div>
  );
}
