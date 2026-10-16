import CourseList from './CourseList';
import RequirementCourseRow from './RequirementCourseRow';
import RangeCourseList from './RangeCourseList';
import { SequenceOptionCards } from './SequenceGroupDetail';
import { shortCourseCode, describeLockStatus, hideInactive } from './treeHelpers';

// Pool view for one leaf node: atLeast subset legend lines ("✱ At least 1
// calculus or statistics course ✓ — MA 123"), then one group per pool entry
// in pool order (see collectPoolGroups): its title, its claimed courses as
// green-tinted ✓ rows, then what it can still offer — a grid of course rows (CourseList),
// range include rows plus the inline catalog browse list (RangeCourseList,
// the same in the sidebar and the full view), or sequence option cards — then
// the additionalPool note.
export default function CoursePool({
  pool,
  subsets = [],
  subsetLabels,
  fallbackNote,
  courseMap,
  lockStatusMap,
  planCourseKeySet,
  stashSet,
  onToggleStash,
  onShowCourseInfo,
  onRowClick,
  inactiveKeys = new Set(),
}) {
  const { groups } = pool;
  if (groups.length === 0 && subsets.length === 0 && !fallbackNote && !pool.substituted?.length) return null;

  const listProps = { stashSet, onToggleStash, onShowCourseInfo, subsetLabels, onRowClick };
  const toCourses = (keys) => keys.map((key) => ({ id: key, ...(courseMap[key] || {}) }));
  // Choices only: inactive courses hide unless in the plan or stash (see hideInactive).
  const keep = (key) => stashSet.has(key) || planCourseKeySet.has(key);
  function choiceList(keys, extra = {}) {
    const { keys: shown, dimmed } = hideInactive(keys, inactiveKeys, keep);
    return <CourseList courses={toCourses(shown)} dimmed={dimmed} {...extra} {...listProps} />;
  }

  // Petitioned (substituted) courses render as muted ✎ rows, in the slot they fill.
  function substitutedRows(list = []) {
    if (list.length === 0) return null;
    return (
      <div className="req-course-grid">
        {list.map(({ courseKey, label, replaces }) => (
          <RequirementCourseRow
            key={courseKey ?? label}
            courseKey={courseKey}
            course={courseKey ? courseMap[courseKey] : undefined}
            substituted
            substituteLabel={courseKey ? undefined : label}
            replacesLabel={replaces ? shortCourseCode(replaces) : undefined}
            onShowCourseInfo={onShowCourseInfo}
          />
        ))}
      </div>
    );
  }

  function claimedRow(key, optionTags) {
    return (
      <RequirementCourseRow
        key={key}
        courseKey={key}
        course={courseMap[key]}
        inPlan
        statusLabel={describeLockStatus(lockStatusMap?.[key]).label}
        onShowCourseInfo={onShowCourseInfo}
        subsetLabel={subsetLabels?.get(key)}
        tag={optionTags?.[key]}
      />
    );
  }

  function renderOffer(group) {
    if (group.kind === 'range') {
      if (!group.showRange) return null;
      return (
        <>
          {group.includeOptions.length > 0 && choiceList(group.includeOptions)}
          <RangeCourseList
            range={group.range}
            planCourseKeySet={planCourseKeySet}
            {...listProps}
          />
        </>
      );
    }
    if (group.kind === 'sequence') {
      if (group.sequenceOptions.length === 0) return null;
      return (
        <SequenceOptionCards
          options={group.sequenceOptions}
          courseMap={courseMap}
          planCourseKeySet={planCourseKeySet}
          stashSet={stashSet}
          onToggleStash={onToggleStash}
          onShowCourseInfo={onShowCourseInfo}
          onRowClick={onRowClick}
          inactiveKeys={inactiveKeys}
        />
      );
    }
    if (group.options.length === 0) return null;
    // Required courses (ALL leaf) are never hidden — they aren't choices.
    if (group.required) return <CourseList courses={toCourses(group.options)} {...listProps} />;
    return choiceList(group.options, { equivalent: group.equivalent, optionTags: group.optionTags });
  }

  return (
    <div className="req-pool">
      {substitutedRows(pool.substituted)}
      {subsets.map((subset, i) => {
        const keys = subset.matched.flatMap((entry) => entry.courseKeys || []);
        const done = subset.status === 'satisfied';
        return (
          // Legend for the ✱ marker on this subset's course rows. Authored
          // labels are the whole line; ✓ (plus what met it) once satisfied.
          <div key={i} className={`req-subset-line${done ? ' is-satisfied' : ''}`}>
            <span className="req-subset-marker" aria-hidden="true">✱</span>{' '}
            {subset.label ?? `At least ${subset.min} of these`}
            {done && <span className="req-subset-done"> ✓</span>}
            {keys.length > 0 && ` — ${keys.map(shortCourseCode).join(', ')}`}
          </div>
        );
      })}
      {groups.map((group) => {
        const offer = renderOffer(group);
        const substituted = group.substituted?.length > 0;
        // A slot filled by a petition shows only its ✎ row (a label-only
        // substitute has no claimed course, so it would otherwise look empty).
        const empty = group.claimed.length === 0 && !substituted && !offer && !group.title;
        return (
          <div key={group.key} className={`req-slot${group.open || substituted ? ' req-slot--open' : ''}`}>
            {group.title && <span className="req-slot-title">{group.title}</span>}
            {group.note && <span className="req-slot-note">{group.note}</span>}
            {group.claimed.filter((key) => !group.substituted?.some((sub) => sub.courseKey === key)).length > 0 && (
              <div className="req-course-grid">
                {group.claimed
                  .filter((key) => !group.substituted?.some((sub) => sub.courseKey === key))
                  .map((key) => claimedRow(key, group.optionTags))}
              </div>
            )}
            {substitutedRows(group.substituted)}
            {offer}
            {empty && <span className="req-slot-text">{group.textIfEmpty}</span>}
          </div>
        );
      })}
      {fallbackNote && <span className="req-node-detail req-fallback-note">{fallbackNote}</span>}
    </div>
  );
}
