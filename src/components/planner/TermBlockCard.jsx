import { blockEntryLabel, isBlockEntry } from '../../utils/courseEntry';

// Read-only card for a semester entry that isn't a course or a typed
// placeholder: a block (a note with a blockType — see isBlockEntry in
// courseEntry.js; 'marine' is the Marine Semester) or an entry with a kind
// this version doesn't know. No drag, no lock, no remove, no editing.
// Reuses the placeholder card's look.
export default function TermBlockCard({ entry, compact = false }) {
  const name = blockEntryLabel(entry);
  const label = isBlockEntry(entry) && entry.blockType === 'marine'
    ? `${name} · ${entry.credits} credits`
    : name;
  return (
    <div
      className={`note-card${compact ? ' is-compact' : ''}`}
      title={compact ? label : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="note-card-text">{label}</span>
    </div>
  );
}
