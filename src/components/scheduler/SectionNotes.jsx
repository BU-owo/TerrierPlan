import { parseSectionNotes } from '../../utils/sectionNotes.js';

// A section's `notes` as plain text, with http(s) links as real links. No raw
// HTML is ever injected (see sectionNotes.js).
export default function SectionNotes({ notes }) {
  const parts = parseSectionNotes(notes);
  return parts.map((part, i) => (part.href ? (
    <a
      key={i}
      href={part.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {part.text}
    </a>
  ) : (
    <span key={i}>{part.text}</span>
  )));
}
