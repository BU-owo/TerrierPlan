import { useEffect, useRef, useState } from 'react';
import { compareSectionsByTime } from '../../utils/sectionTime';
import { groupSectionsByComponent } from '../../utils/sectionComponents';
import { matchesFilters, isGlobalFilterActive } from '../../utils/sectionFilters';
import SectionRow from './SectionRow';

function groupStatusLabel(considering, lockedIdsInGroup) {
  const consideringCount = considering.length;
  if (lockedIdsInGroup.length > 0) {
    return `📌 ${lockedIdsInGroup.length > 1 ? `${lockedIdsInGroup.length} locked` : 'Locked'}${
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
}) {
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

  const isReady = groups.length > 0 && groups.every((g) => g.groupConsidering.length > 0 || g.groupLockedIds.length > 0);
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

      {!collapsed && loading && <div className="sched-draft-card-loading">Loading sections…</div>}

      {!collapsed && !loading && sections.length === 0 && (
        <div className="sched-draft-card-empty">No sections found for this term.</div>
      )}

      {!collapsed && !loading && groups.map((group) => {
        const matchingCount = group.matchingIds.size;
        const allMatchingSelected = matchingCount > 0 &&
          group.sections.every((s) => !group.matchingIds.has(s.id) ||
            group.groupConsidering.includes(s.id) || group.groupLockedIds.includes(s.id));

        return (
          <div className="sched-section-group" key={group.key}>
            <div className="sched-section-group-header">
              <span className="sched-section-group-label">{group.label}</span>
              <span className={`sched-section-group-hint${group.commonNotes ? ' is-notes' : ''}`}>
                {group.commonNotes || group.hint}
              </span>
              <span className={`sched-draft-card-hint${group.groupLockedIds.length > 0 ? ' is-locked' : ''}`}>
                {groupStatusLabel(group.groupConsidering, group.groupLockedIds)}
              </span>
              {matchingCount > 0 && (
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
            </div>
            {anyFilterActive && matchingCount === 0 && (
              <div className="sched-draft-card-empty">No sections match the global time filter — shown dimmed below.</div>
            )}
            <div className="sched-section-list">
              {group.sections.map((section) => (
                <SectionRow
                  key={section.id}
                  section={section}
                  checked={group.groupConsidering.includes(section.id)}
                  locked={lockedIds.has(section.id)}
                  conflicts={conflictMap[section.id]}
                  notes={!group.commonNotes ? section.notes : null}
                  filteredOut={!group.matchingIds.has(section.id)}
                  onToggle={() => onToggleSection(group.key, section.id)}
                  onToggleLock={() => onToggleLock(group.key, section.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
