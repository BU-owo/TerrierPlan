// Read-only display of an already-applied override — the node itself always
// shows this (plus its "Petitioned" badge, see RequirementNodeView) once
// requirementOverrides has an entry for it. Creating/removing the override
// itself only happens through the single top-level ExceptionModal; this
// component is display-only except for "Remove", which is reporting the
// *absence* of an exception rather than a new entry point of its own.
export default function PetitionActiveDisplay({ node, override, courseMap, onRemoveOverride }) {
  if (!override) return null;
  const substitutedCourse = override.type === 'substitute' && override.courseKey
    ? (courseMap[override.courseKey]?.courseNumber ?? override.courseKey)
    : null;
  return (
    <div className="req-petition-active">
      <span className="req-petition-detail">
        {substitutedCourse && <>Using <strong>{substitutedCourse}</strong>. </>}
        {override.note ? `“${override.note}”` : 'No note provided.'}
      </span>
      <button
        type="button"
        className="req-petition-remove"
        onClick={() => onRemoveOverride(node.id)}
      >
        Remove
      </button>
    </div>
  );
}
