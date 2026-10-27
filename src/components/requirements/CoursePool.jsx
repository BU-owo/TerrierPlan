import { Fragment, useState } from 'react';
import CourseList from './CourseList';
import RequirementCourseRow from './RequirementCourseRow';
import RangeCourseList from './RangeCourseList';
import { SequenceOptionCards } from './SequenceGroupDetail';
import { shortCourseCode, describeLockStatus, hideInactive } from './treeHelpers';
import { lockStatusVariant } from '../../utils/completion';

// Pool view for one leaf node: atLeast subset legend lines ("✱ At least 1
// calculus or statistics course ✓ — MA 123"), then one group per pool entry
// in pool order (see collectPoolGroups): its title, its claimed courses as
// green-tinted ✓ rows, then what it can still offer — a grid of course rows (CourseList),
// range include rows plus the inline catalog browse list (RangeCourseList,
// the same in the sidebar and the full view), or sequence option cards — then
// the additionalPool note.

// One collapsed, labeled row in a headed box (an entry with nothing left to
// offer shows its label as plain text). Claimed rows stay visible under the
// label; `body` (the usual CourseList) shows when expanded.
function LabeledRow({ label, held, body }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      {body ? (
        <button type="button" className="req-node-pool-toggle req-node-pool-toggle--row" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {label} {expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="req-node-pool-toggle req-node-pool-toggle--row req-labeled-row-text">{label}</span>
      )}
      {held}
      {expanded && body}
    </>
  );
}

const itemKey = (item) => item.key ?? item.sub?.courseKey ?? item.sub?.label;

// A slot note without its "X also counts." sentences (the footer's "Also
// counts here: X" line already says that), or null when nothing is left.
function noteBeyondAlsoCounts(note) {
  if (!note) return null;
  const rest = note.split(/(?<=\.)\s+/).filter((sentence) => !/\balso counts?\b/i.test(sentence)).join(' ');
  return rest || null;
}

// One either/or slot of a `slotLayout: "rows"` card, always one visual group.
// Not filled yet: every option as a row in authored order ("or" pill +
// "Either one counts" for a pair) in one shared box, the slot note at its
// bottom. Filled: only the counted row; inside its own box, under a divider,
// "Also counts here: QM 221 · Show"; Show reveals the other options (and what
// the note adds) in that same box. One-option slots, and a slot filled with
// nothing else to list (a petition), are just the row.
function RowsSlot({ group, renderItem }) {
  const [open, setOpen] = useState(false);
  const counted = group.items.filter((item) => item.type !== 'offer');
  const alternates = group.items.filter((item) => item.type === 'offer');

  if (counted.length === 0) {
    const pair = group.items.length === 2;
    const rows = (
      <div className={`req-course-grid${pair ? ' req-course-grid--pair' : ''}`}>
        {group.items.map((item, i) => (
          <Fragment key={itemKey(item)}>
            {pair && i === 1 && <span className="req-or-pill">or</span>}
            {renderItem(item, group.optionTags)}
          </Fragment>
        ))}
      </div>
    );
    const note = group.note && <span className="req-slot-note">{group.note}</span>;
    if (group.items.length < 2) return <>{rows}{note}</>;
    return (
      <div className="req-rows-group">
        {pair && <span className="req-either-caption">Either one counts</span>}
        {rows}
        {note}
      </div>
    );
  }

  if (alternates.length === 0) {
    return (
      <div className="req-course-grid">
        {counted.map((item) => <Fragment key={itemKey(item)}>{renderItem(item, group.optionTags)}</Fragment>)}
      </div>
    );
  }

  const extraNote = noteBeyondAlsoCounts(group.note);
  const footer = (
    <>
      <span className="req-also-counts">
        Also counts here: {alternates.map((item) => shortCourseCode(item.key)).join(', ')} ·{' '}
        <button type="button" className="req-inline-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </span>
      {open && (
        <div className="req-rows-alternates">
          <span className="req-or-pill">or</span>
          <div className="req-course-grid">
            {alternates.map((item) => <Fragment key={itemKey(item)}>{renderItem(item, group.optionTags)}</Fragment>)}
          </div>
          {extraNote && <span className="req-slot-note">{extraNote}</span>}
        </div>
      )}
    </>
  );
  return (
    <div className="req-rows-slot">
      {counted.map((item, i) => (
        <Fragment key={itemKey(item)}>{renderItem(item, group.optionTags, i === counted.length - 1 ? footer : undefined)}</Fragment>
      ))}
    </div>
  );
}

export default function CoursePool({
  pool,
  subsets = [],
  subsetLabels,
  fallbackNote,
  courseMap,
  lockStatusMap,
  // Set when the done-vs-planned split applies: claimed rows then show
  // completed / current / planned instead of one green "in plan" look.
  splitStatusMap,
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
  function substitutedRow({ courseKey, label, replaces }) {
    return (
      <RequirementCourseRow
        key={courseKey ?? label}
        courseKey={courseKey}
        course={courseKey ? courseMap[courseKey] : undefined}
        substituted
        substituteLabel={courseKey ? undefined : label}
        replacesLabel={replaces ? shortCourseCode(replaces) : undefined}
        onShowCourseInfo={onShowCourseInfo}
      />
    );
  }

  function substitutedRows(list = []) {
    if (list.length === 0) return null;
    return <div className="req-course-grid">{list.map(substitutedRow)}</div>;
  }

  function claimedRow(key, optionTags, footer) {
    return (
      <RequirementCourseRow
        key={key}
        courseKey={key}
        course={courseMap[key]}
        inPlan
        statusLabel={describeLockStatus(lockStatusMap?.[key]).label}
        planStatus={splitStatusMap ? lockStatusVariant(splitStatusMap[key]) : null}
        planSlotLabel={splitStatusMap?.[key]?.slotLabel}
        onShowCourseInfo={onShowCourseInfo}
        subsetLabel={subsetLabels?.get(key)}
        tag={optionTags?.[key]}
        footer={footer}
      />
    );
  }

  // A pool entry flagged `continues` is drawn inside the previous entry's box
  // (one visible area made of an either/or slot plus a plain list). Only a box
  // with the same heading takes it, so headed boxes never merge.
  function foldContinuing(list) {
    const folded = [];
    for (const group of list) {
      const prev = folded[folded.length - 1];
      if (group.continues && prev && (prev.heading ?? null) === (group.heading ?? null)) prev.continued.push(group);
      else folded.push({ ...group, continued: [] });
    }
    return folded;
  }

  // Headed box: each entry is a collapsed row titled with its label, the same
  // for range and list entries; its claimed rows sit under the label.
  function renderLabeledRow(part) {
    const claimedKeys = part.claimed.filter((key) => !part.substituted?.some((sub) => sub.courseKey === key));
    const held = (
      <>
        {part.note && <span className="req-slot-note">{part.note}</span>}
        {claimedKeys.length > 0 && (
          <div className="req-course-grid">{claimedKeys.map((key) => claimedRow(key, part.optionTags))}</div>
        )}
        {substitutedRows(part.substituted)}
      </>
    );
    if (part.kind === 'range' && part.showRange) {
      return (
        <Fragment key={part.key}>
          <RangeCourseList label={part.title} range={part.range} planCourseKeySet={planCourseKeySet} alwaysShowControls {...listProps}>
            {held}
          </RangeCourseList>
          {part.includeOptions.length > 0 && choiceList(part.includeOptions)}
        </Fragment>
      );
    }
    const offer = part.kind === 'range' ? null : renderOffer(part, { alwaysShowControls: true });
    if (!offer && claimedKeys.length === 0 && !part.substituted?.length) return null;
    return <LabeledRow key={part.key} label={part.title} held={held} body={offer} />;
  }

  // Take-all nodes: a run of plain required courses is one borderless grid in
  // authored order. Same row props as CourseList, so click / stash are unchanged.
  function renderItem(item, optionTags = null, footer = undefined) {
    if (item.type === 'claimed') return claimedRow(item.key, optionTags, footer);
    if (item.type === 'sub') return substitutedRow(item.sub);
    return (
      <RequirementCourseRow
        key={item.key}
        courseKey={item.key}
        course={{ id: item.key, ...(courseMap[item.key] || {}) }}
        isStashed={stashSet.has(item.key)}
        onToggleStash={onToggleStash}
        onShowCourseInfo={onShowCourseInfo}
        subsetLabel={subsetLabels?.get(item.key)}
        onRowClick={onRowClick}
        tag={optionTags?.[item.key]}
      />
    );
  }

  function renderRun(group) {
    return (
      <div key={group.key} className="req-course-grid">
        {group.items.map((item) => renderItem(item))}
      </div>
    );
  }

  // `slotLayout: "rows"` either/or slot: its options as plain rows in authored
  // order, "or" pill + "Either one counts" for a pair, slot note underneath.
  function renderRowsSlot(group) {
    return <RowsSlot key={group.key} group={group} renderItem={renderItem} />;
  }

  function renderGroupBody(group) {
    const offer = renderOffer(group);
    const substituted = group.substituted?.length > 0;
    // A slot filled by a petition shows only its ✎ row (a label-only
    // substitute has no claimed course, so it would otherwise look empty).
    const empty = group.claimed.length === 0 && !substituted && !offer && !group.title;
    return (
      <Fragment key={group.key}>
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
      </Fragment>
    );
  }

  // `extra`: CourseList props for this call only (headed-box rows).
  function renderOffer(group, extra = {}) {
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
    // "Choose 1" box: every authored option, same grid at 2 and 3+ (no "or"
    // pill, no inactive hiding — these are required slots).
    if (group.layout === 'choose') {
      return <CourseList courses={toCourses(group.options)} optionTags={group.optionTags} {...extra} {...listProps} />;
    }
    // Required courses (ALL leaf) are never hidden — they aren't choices.
    if (group.required) return <CourseList courses={toCourses(group.options)} {...extra} {...listProps} />;
    return choiceList(group.options, { equivalent: group.equivalent, optionTags: group.optionTags, ...extra });
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
      {foldContinuing(groups).map((group) => {
        const parts = [group, ...group.continued];
        const substituted = parts.some((part) => part.substituted?.length > 0);
        const open = parts.some((part) => part.open);
        if (group.layout === 'run') return renderRun(group);
        if (group.layout === 'rows') return renderRowsSlot(group);
        if (group.layout === 'choose') {
          return (
            <div key={group.key} className="req-slot req-choose">
              <div className="req-choose-head">
                <span className="req-choose-badge">Choose 1</span>
                {group.title && <span className="req-slot-title">{group.title}</span>}
              </div>
              {parts.map((part) => renderGroupBody(part))}
            </div>
          );
        }
        if (group.heading) {
          return (
            <div key={group.key} className={`req-slot${open || substituted ? ' req-slot--open' : ''}`}>
              <div className="req-pool-head">
                <span className="req-pool-title">{group.heading}</span>
              </div>
              {parts.map((part) => renderLabeledRow(part))}
            </div>
          );
        }
        // The cap tag is skipped when the authored label already says "(max N)".
        const cap = group.listHeading?.cap;
        const showCap = cap != null && !/max\s*\d/i.test(group.title || '');
        return (
          <div key={group.key} className={`req-slot${open || substituted ? ' req-slot--open' : ''}`}>
            {group.listHeading ? (
              <div className="req-pool-head">
                <span className="req-pool-title">{group.title}</span>
                {showCap && <span className="req-choose-badge">up to {cap}</span>}
                {showCap && <span className="req-pool-count">{group.claimed.length} of {cap}</span>}
              </div>
            ) : group.title && <span className="req-slot-title">{group.title}</span>}
            {parts.map((part) => renderGroupBody(part))}
          </div>
        );
      })}
      {fallbackNote && <span className="req-node-detail req-fallback-note">{fallbackNote}</span>}
    </div>
  );
}
