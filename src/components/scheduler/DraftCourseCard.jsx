import { Fragment, useEffect, useRef, useState } from 'react';
import { compareSectionsByTime } from '../../utils/sectionTime';
import { groupSectionsByComponent, UNKNOWN_KEY } from '../../utils/sectionComponents';
import { matchesFilters, isGlobalFilterActive } from '../../utils/sectionFilters';
import SectionRow from './SectionRow';
import SectionNotes from './SectionNotes';
import SwapIcon from './SwapIcon';

function groupStatusLabel(considering, lockedIdsInGroup, groupKey) {
  const consideringCount = considering.length;
  if (lockedIdsInGroup.length > 0) {
    // Several pins in a real component (an old draft) are "pick one of these";
    // only the "Other" group uses every pin.
    const several = groupKey === UNKNOWN_KEY
      ? `${lockedIdsInGroup.length} locked`
      : `${lockedIdsInGroup.length} pinned, one will be used`;
    return `📌 ${lockedIdsInGroup.length > 1 ? several : 'Locked'}${
      consideringCount > 0 ? ` + ${consideringCount} more in consideration` : ''
    }`;
  }
  return consideringCount === 0 ? 'Pick at least one section' : `${consideringCount} in consideration`;
}

export default function DraftCourseCard({
  courseKey,
  courseData,
  sections,
  loading,
  considering,
  lockedIds,
  conflictMap,
  sortMode,
  globalTimeFilter,
  onToggleSection,
  onToggleLock,
  onSelectAll,
  onDeselectAll,
  onRemoveCourse,
  collapseSignal,
  // Manual mode: rows place/remove a section on the grid (one per group)
  // instead of checking it into the generation pool.
  mode = 'auto',
  placedIds = new Set(),
  onPlace = () => {},
  // "Show all" ghosts: which of this course's group keys are drawn on the grid.
  ghostGroupKeys = new Set(),
  onToggleGhosts = () => {},
  // Short "what's missing" note for this course (e.g. "pick a Lecture"), or null.
  hint = null,
  // Auto: check/uncheck every section of every component of this course (only
  // the ones that pass the Global Time Filter get checked).
  onSelectAllCourse = () => {},
  onDeselectAllCourse = () => {},
  // { courseKey, groupKey, n } from the "Not complete yet" banner: expand this
  // card and scroll to that component group.
  focusRequest = null,
}) {
  const manual = mode === 'manual';
  // Collapse state is deliberately local (not lifted to SchedulerPage) —
  // it's a per-card view preference, not something that needs to survive
  // a page reload. Newly-added cards default to expanded so the student
  // sees what they just added.
  const [collapsed, setCollapsed] = useState(false);

  // `collapseSignal` is a counter SchedulerPage bumps every time a course
  // gets added to the draft — see handleAddCourse. Any card already
  // mounted when that happens auto-collapses, so the student isn't stuck
  // scrolling past everything they already set up to reach the new one.
  // The ref skips the very first effect run (on this card's own mount, for
  // both a freshly-added course and one restored from a saved schedule) so
  // a card doesn't collapse itself the moment it appears.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setCollapsed(true);
  }, [collapseSignal]);

  // Jump to a component group (from the status line below or the banner above
  // the grid): open the card, then scroll once the group has rendered.
  const groupRefs = useRef({});
  const [scrollTarget, setScrollTarget] = useState(null);
  useEffect(() => {
    if (focusRequest && focusRequest.courseKey === courseKey) {
      setCollapsed(false);
      setScrollTarget({ key: focusRequest.groupKey, n: focusRequest.n });
    }
  }, [focusRequest, courseKey]);
  useEffect(() => {
    // Runs after the commit that opened the card, so the group is in the DOM.
    if (scrollTarget) groupRefs.current[scrollTarget.key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollTarget]);
  function focusGroup(groupKey) {
    setCollapsed(false);
    setScrollTarget({ key: groupKey, n: Date.now() });
  }

  const courseLabel = courseData?.courseNumber ?? courseKey;
  const comparator = sortMode === 'time'
    ? compareSectionsByTime
    : (a, b) => (a.classSection || '').localeCompare(b.classSection || '');
  const groups = groupSectionsByComponent(sections, comparator).map((group) => {
    const groupConsidering = considering[group.key] || [];
    const groupLockedIds = group.sections.map((s) => s.id).filter((id) => lockedIds.has(id));
    const matchingIds = new Set(
      group.sections.filter((s) => matchesFilters(s, globalTimeFilter)).map((s) => s.id),
    );
    return { ...group, groupConsidering, groupLockedIds, matchingIds };
  });

  const isReady = groups.length > 0 && (manual
    ? groups.every((g) => g.sections.some((s) => placedIds.has(s.id)))
    : groups.every((g) => g.groupConsidering.length > 0 || g.groupLockedIds.length > 0));
  // Auto: one entry per required component, picked or not (a pin counts).
  const componentStatus = manual || loading ? [] : groups.map((g) => ({
    key: g.key,
    label: g.label === 'Other' ? 'Other sections' : g.label,
    picked: g.groupConsidering.length > 0 || g.groupLockedIds.length > 0,
    hidden: isGlobalFilterActive(globalTimeFilter) && g.sections.length > 0 && g.matchingIds.size === 0,
  }));
  const showStatus = componentStatus.some((c) => !c.picked);
  // "Every section" means every one that passes the time filter.
  const everySectionSelected = groups.length > 0 && groups.every((g) => g.sections.every((s) =>
    !g.matchingIds.has(s.id) || g.groupConsidering.includes(s.id) || g.groupLockedIds.includes(s.id)));
  const creditsLabel = sections[0]?.credits != null ? `${sections[0].credits} cr` : null;
  const anyFilterActive = isGlobalFilterActive(globalTimeFilter);

  return (
    <div className="sched-draft-card">
      <div className="sched-draft-card-header">
        <button
          type="button"
          className="sched-draft-card-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          <span className="sched-draft-card-chevron" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          <span className="sched-draft-card-titles">
            <span className="sched-draft-card-code">{courseLabel}</span>
            <span className="sched-draft-card-name">{courseData?.name ?? '—'}</span>
          </span>
          {collapsed && !loading && (
            <span className={`sched-draft-card-summary${isReady ? ' is-ready' : ''}`}>
              {creditsLabel && <>{creditsLabel} · </>}
              {isReady ? '✓ Ready' : 'Needs a pick'}
            </span>
          )}
        </button>
        {!manual && !loading && groups.length > 0 && (
          <button
            type="button"
            className="sched-select-all-btn sched-course-select-all"
            onClick={everySectionSelected ? onDeselectAllCourse : onSelectAllCourse}
            title={everySectionSelected
              ? 'Uncheck every section of this course (pinned sections stay)'
              : 'Check every section of every component of this course'}
          >
            {everySectionSelected ? 'Deselect all sections' : 'Select all sections'}
          </button>
        )}
        <button
          type="button"
          className="sched-remove-course-btn"
          onClick={(e) => { e.stopPropagation(); onRemoveCourse(); }}
          aria-label={`Remove ${courseLabel} from schedule draft`}
          title="Remove course"
        >
          ×
        </button>
      </div>

      {showStatus && (
        <div className="sched-draft-card-status" role="status">
          {componentStatus.map((c, i) => (
            <Fragment key={c.key}>
              {i > 0 && <span className="sched-draft-card-status-sep" aria-hidden="true"> · </span>}
              {c.picked ? (
                <span className="sched-draft-card-status-item is-done">{c.label} <span aria-label="picked">✓</span></span>
              ) : (
                <button
                  type="button"
                  className="sched-draft-card-status-item is-missing"
                  onClick={() => focusGroup(c.key)}
                  title={`Go to ${c.label}`}
                >
                  {c.label}: none picked{c.hidden ? ' (all hidden by your time filter)' : ''}
                </button>
              )}
            </Fragment>
          ))}
        </div>
      )}

      {hint && !loading && !showStatus && <div className="sched-draft-card-pick-hint">{hint}</div>}

      {!collapsed && loading && <div className="sched-draft-card-loading">Loading sections…</div>}

      {!collapsed && !loading && sections.length === 0 && (
        <div className="sched-draft-card-empty">No sections found for this term.</div>
      )}

      {!collapsed && !loading && groups.map((group) => {
        const matchingCount = group.matchingIds.size;
        const allMatchingSelected = matchingCount > 0 &&
          group.sections.every((s) => !group.matchingIds.has(s.id) ||
            group.groupConsidering.includes(s.id) || group.groupLockedIds.includes(s.id));
        const placedInGroup = group.sections.find((s) => placedIds.has(s.id));
        const ghostsOn = ghostGroupKeys.has(group.key);
        // Auto: a group with every section already selected has nothing left to
        // show as a ghost to pick from. (Left usable while its ghosts are on, so
        // they can still be turned off.)
        const everyoneSelected = !manual && group.sections.every((s) =>
          group.groupConsidering.includes(s.id) || group.groupLockedIds.includes(s.id));
        const showAllDisabled = everyoneSelected && !ghostsOn;

        return (
          <div
            className="sched-section-group"
            key={group.key}
            ref={(el) => { groupRefs.current[group.key] = el; }}
          >
            <div className="sched-section-group-header">
              <span className="sched-section-group-label">{group.label}</span>
              <span className={`sched-section-group-hint${group.commonNotes ? ' is-notes' : ''}`}>
                {group.commonNotes ? <SectionNotes notes={group.commonNotes} /> : group.hint}
              </span>
              <span className={`sched-draft-card-hint${!manual && group.groupLockedIds.length > 0 ? ' is-locked' : ''}`}>
                {manual
                  ? (placedInGroup ? `Placed: ${placedInGroup.classSection}` : 'Pick one')
                  : groupStatusLabel(group.groupConsidering, group.groupLockedIds, group.key)}
              </span>
              {!manual && matchingCount > 0 && (
                <button
                  type="button"
                  className="sched-select-all-btn"
                  onClick={() => (allMatchingSelected
                    ? onDeselectAll(group.key)
                    : onSelectAll(group.key, group.sections.filter((s) => group.matchingIds.has(s.id)).map((s) => s.id)))}
                >
                  {allMatchingSelected ? 'Deselect all' : 'Select all'}
                </button>
              )}
              {group.sections.length > 0 && (
                <button
                  type="button"
                  className={`sched-select-all-btn sched-ghost-toggle-btn${ghostsOn ? ' is-on' : ''}`}
                  onClick={() => onToggleGhosts(group.key)}
                  aria-pressed={ghostsOn}
                  disabled={showAllDisabled}
                  title={showAllDisabled
                    ? 'Every section in this group is already selected'
                    : manual
                      ? 'Show every section in this group as ghosts on the grid. Click one to place it'
                      : 'Show every section in this group as ghosts on the grid. Click one to select or unselect it'}
                >
                  <SwapIcon />
                  {showAllDisabled ? 'All selected' : 'Show all'}
                </button>
              )}
            </div>
            {anyFilterActive && matchingCount === 0 && (
              <div className="sched-draft-card-empty">No sections match the global time filter — shown dimmed below.</div>
            )}
            <div className="sched-section-list">
              {group.sections.map((section) => (
                <SectionRow
                  key={section.id}
                  section={section}
                  checked={manual ? placedIds.has(section.id) : group.groupConsidering.includes(section.id)}
                  locked={!manual && lockedIds.has(section.id)}
                  conflicts={manual ? undefined : conflictMap[section.id]}
                  notes={!group.commonNotes ? section.notes : null}
                  filteredOut={!group.matchingIds.has(section.id)}
                  onToggle={() => (manual ? onPlace(group.key, section.id) : onToggleSection(group.key, section.id))}
                  onToggleLock={() => onToggleLock(group.key, section.id)}
                  manual={manual}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
