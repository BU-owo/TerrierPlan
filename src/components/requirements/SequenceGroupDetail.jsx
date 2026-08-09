import { describeMissing, formatCourseLabel } from './treeHelpers';

// Replaces the flat "Needs: [every option]" line for an unsatisfied
// SEQUENCE_GROUP once the student has made progress toward one specific
// option (node.partialMatch) — highlights that option instead of listing
// every alternative with equal weight. The other options are still
// reachable, just tucked behind a toggle rather than shown inline. Falls
// back to the plain flat list when partialMatch is null (nothing to
// prioritize yet).
export default function SequenceGroupDetail({ node, courseMap, collapsedOverrides, onToggle, density = 'compact' }) {
  if (!node.partialMatch) {
    return (
      <span className="req-node-detail">
        {`Needs: ${node.missing.map((entry) => describeMissing(entry, courseMap, density)).join(', ')}`}
      </span>
    );
  }

  const { label, haveKeys, needKeys } = node.partialMatch;
  const otherOptions = node.missing.filter((optionLabel) => optionLabel !== label);
  const toggleKey = `seq-alt:${node.label}`;
  const expanded = Boolean(collapsedOverrides[toggleKey]);

  return (
    <div className="req-node-detail req-sequence-partial">
      <span className="req-sequence-ontrack-label">On track: {label}</span> —{' '}
      <span className="req-sequence-have">have {haveKeys.map((key) => formatCourseLabel(key, courseMap, density)).join(', ')}</span>
      {', '}
      <span className="req-sequence-need">still need {needKeys.map((key) => formatCourseLabel(key, courseMap, density)).join(', ')}</span>
      {otherOptions.length > 0 && (
        <div className="req-sequence-alt-wrap">
          <button
            type="button"
            className="req-node-pool-toggle req-sequence-alt-toggle"
            onClick={() => onToggle(toggleKey, expanded)}
          >
            {expanded ? 'Hide other sequences' : 'or complete a different sequence instead ▾'}
          </button>
          {expanded && <div className="req-sequence-alt-list">{otherOptions.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}
