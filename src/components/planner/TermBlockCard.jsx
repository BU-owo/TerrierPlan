import { blockEntryLabel } from '../../utils/courseEntry';

// Read-only card for a semester entry that isn't a course or a typed
// placeholder: a note with an unknown blockType (see isBlockEntry in
// courseEntry.js) or an entry with a kind this version doesn't know. No
// drag, no lock, no remove, no editing. Reuses the placeholder card's look.
// (The Marine Semester marker isn't drawn at all; see SemesterColumn.)
export default function TermBlockCard({ entry, compact = false }) {
  const label = blockEntryLabel(entry);
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
