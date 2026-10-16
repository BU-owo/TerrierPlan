import { Fragment } from 'react';
import { normalizeCourseKey } from '../../utils/courseKey';
import RequirementCourseRow from './RequirementCourseRow';
import { shortCourseCode } from './treeHelpers';

// Sequence options as cards — one compact card per option, its courses side
// by side joined by "+" (stacked under 640px), a small "OR" divider between
// cards. Each course is a compact row (paw + code + title + (i), no tags);
// courses already in the plan show a ✓ instead of the paw. `progress`
// ({ label, text }) puts a hint ("1 of 2 taken") on that option's card and
// highlights it. Used for SEQUENCE_GROUP nodes (below) and SEQUENCE_GROUP
// pool entries (CoursePool).
export function SequenceOptionCards({
  options,
  progress,
  // Petitions: { replacedKey: { courseKey?, label? } } shown in place of the
  // course they stand in for, on the option labelled `substitutedOption` only.
  substitutedFor,
  substitutedOption,
  courseMap,
  planCourseKeySet,
  stashSet,
  onToggleStash,
  onShowCourseInfo,
  onRowClick,
  inactiveKeys = new Set(),
}) {
  // Hide an option that has a long-unoffered course, unless one of its
  // courses is already in the plan. If that hides them all, show them all
  // greyed with "Not offered recently".
  const live = options.filter(
    (option) => !option.courses.some((key) => inactiveKeys.has(key))
      || option.courses.some((key) => planCourseKeySet.has(key))
  );
  const dimmed = live.length === 0 && options.length > 0;
  const shown = dimmed ? options : live;
  return (
    <div className="req-seq-cards">
      {dimmed && <span className="req-either-caption">Not offered recently</span>}
      {shown.map((option, i) => {
        const isProgress = progress?.label === option.label;
        return (
          <Fragment key={option.label}>
            {i > 0 && <div className="req-seq-or" aria-hidden="true">OR</div>}
            <div className={`req-seq-card${isProgress ? ' is-partial' : ''}`}>
              {isProgress && <span className="req-seq-progress">{progress.text}</span>}
              <div className="req-seq-courses">
                {option.courses.map((replacedKey, j) => {
                  const sub = substitutedOption === option.label ? substitutedFor?.[replacedKey] : undefined;
                  const subKey = sub?.courseKey;
                  const key = subKey ?? replacedKey;
                  return (
                  <Fragment key={replacedKey}>
                    {j > 0 && <span className="req-seq-plus" aria-hidden="true">+</span>}
                    <RequirementCourseRow
                      courseKey={key}
                      course={courseMap[key]}
                      substituted={Boolean(sub)}
                      substituteLabel={sub && !subKey ? sub.label : undefined}
                      replacesLabel={sub ? shortCourseCode(replacedKey) : undefined}
                      inPlan={planCourseKeySet.has(key)}
                      isStashed={stashSet.has(key)}
                      onToggleStash={onToggleStash}
                      onShowCourseInfo={onShowCourseInfo}
                      onRowClick={onRowClick}
                      compact
                      dimmed={dimmed}
                    />
                  </Fragment>
                  );
                })}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// A SEQUENCE_GROUP node: every option as a card, with node.partialMatch's
// option carrying an "N of M taken" hint. A satisfied one shows just the
// matched option.
export default function SequenceGroupDetail({ node, ...rest }) {
  const satisfied = node.status === 'satisfied';
  const options = (satisfied
    ? node.options.filter((option) => option.label === node.matchedOption)
    : node.options
  ).map((option) => ({ label: option.label, courses: option.courses.map(normalizeCourseKey) }));
  const partial = !satisfied ? node.partialMatch : null;
  const progress = partial
    ? {
      label: partial.label,
      text: `${partial.haveKeys.length} of ${partial.haveKeys.length + partial.needKeys.length} taken`,
    }
    : null;
  const substitutedFor = Object.fromEntries(
    (node.substitutions || [])
      .filter((sub) => sub.replaces && (sub.status === 'applied' || sub.status === 'pending'))
      .map((sub) => [sub.replaces, { courseKey: sub.courseKey, label: sub.label }])
  );
  return (
    <SequenceOptionCards
      options={options}
      progress={progress}
      substitutedFor={substitutedFor}
      substitutedOption={satisfied ? node.matchedOption : partial?.label ?? node.options[0]?.label}
      {...rest}
    />
  );
}
