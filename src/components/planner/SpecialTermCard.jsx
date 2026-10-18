// A special-term block (see src/data/specialTerms.js — e.g. the Marine
// Semester) in a semester column: one large tinted card filling the term,
// everything read from the registry entry `term`. Not draggable, no lock;
// the × removes the block (no confirmation). `compact` ("All semesters"
// view): one line, label and credits.
export default function SpecialTermCard({ term, onRemove, compact = false }) {
  const summary = `${term.credits} credits · ${term.courseCount} courses`;
  return (
    <div
      className={`special-term-card${compact ? ' is-compact' : ''}`}
      title={compact ? `${term.label} · ${summary}` : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {onRemove && (
        <button
          type="button"
          className="special-term-card-remove"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label={`Remove ${term.label}`}
          title={`Remove ${term.label}`}
        >
          ×
        </button>
      )}
      <span className="special-term-card-label">{term.label}</span>
      {compact ? (
        <span className="special-term-card-credits">{term.credits} cr</span>
      ) : (
        <>
          <span className="special-term-card-summary">{summary}</span>
          <span className="special-term-card-help">{term.helperText}</span>
          <span className="special-term-card-help">{term.admissionNote}</span>
        </>
      )}
    </div>
  );
}
