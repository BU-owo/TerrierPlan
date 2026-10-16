import { shortCourseCode } from './treeHelpers';

// Why a substitution isn't counting right now (see applySlotSubstitutions).
const INERT_TEXT = {
  'real-course-completed': "You've taken the required course, so this isn't needed.",
  'no-open-slot': 'Nothing left to fill.',
  pending: 'Counts once the rest of this option is done.',
};

// Read-only display of an already-applied override — the node itself always
// shows this (plus its "Petitioned" badge for a whole-node override, see
// RequirementNodeView) once requirementOverrides has an entry for it.
// Creating one happens through each node's "⋯" menu (RequirementNodeMenu ->
// ExceptionModal). Substitutions list each petition with its own "Undo";
// older whole-node overrides keep the single "Remove".
export default function PetitionActiveDisplay({ node, override, onRemoveOverride, onUndoSubstitution, countedIn }) {
  if (!override) return null;
  const substitutions = override.type === 'substitute' ? node.substitutions ?? [] : [];
  const note = override.note ? `“${override.note}”` : null;

  if (substitutions.length > 0) {
    return (
      <div className="req-petition-active req-petition-active--list">
        {substitutions.map((sub, index) => (
          <div key={sub.courseKey ?? sub.label} className="req-petition-line">
            <span className="req-petition-detail">
              {sub.for ? `Substituted for ${shortCourseCode(sub.for)}: ` : 'Substituted: '}
              <strong>{sub.courseKey ? shortCourseCode(sub.courseKey) : sub.label}</strong>.
              {sub.status === 'already-counted'
                ? ` Already counted in ${countedIn?.(sub) ?? 'another requirement'}.`
                : INERT_TEXT[sub.status] ? ` ${INERT_TEXT[sub.status]}` : ''}
            </span>
            <button type="button" className="req-petition-remove" onClick={() => onUndoSubstitution(node, index)}>
              Undo
            </button>
          </div>
        ))}
        {note && <span className="req-petition-detail">{note}</span>}
      </div>
    );
  }

  const substitutedCourse = override.type === 'substitute' && override.courseKey
    ? shortCourseCode(override.courseKey)
    : null;
  return (
    <div className="req-petition-active">
      <span className="req-petition-detail">
        {substitutedCourse && <>Using <strong>{substitutedCourse}</strong>. </>}
        {note ?? 'No note provided.'}
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
