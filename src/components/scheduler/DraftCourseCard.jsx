import { useState } from 'react';
import { compareSectionsByTime } from '../../utils/sectionTime';
import { groupSectionsByComponent } from '../../utils/sectionComponents';
import { EMPTY_COURSE_FILTERS, matchesFilters, isCourseFilterActive } from '../../utils/sectionFilters';
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
  filters = EMPTY_COURSE_FILTERS,
  globalTimeFilter,
  onFilterChange,
  onToggleSection,
  onToggleLock,
  onSelectAll,
  onDeselectAll,
  onRemoveCourse,
}) {
  // Collapse state is deliberately local (not lifted to SchedulerPage) —
  // it's a per-card view preference, not something that needs to survive
  // a page reload. Newly-added cards default to expanded so the student
  // sees what they just added. `filters` (time range + professor), unlike
  // collapse, IS lifted to SchedulerPage — the "why is Generate disabled"
  // blocker list needs visibility into per-course filter state too (see
  // SchedulerPage's generateBlockers), so it's a controlled prop here.
  const [collapsed, setCollapsed] = useState(false);

  const courseLabel = courseData?.courseNumber ?? courseKey;
  const comparator = sortMode === 'time'
    ? compareSectionsByTime
    : (a, b) => (a.classSection || '').localeCompare(b.classSection || '');
  const groups = groupSectionsByComponent(sections, comparator).map((group) => {
    const groupConsidering = considering[group.key] || [];
    const groupLockedIds = group.sections.map((s) => s.id).filter((id) => lockedIds.has(id));
    const visibleSections = group.sections.filter((s) => matchesFilters(s, filters, globalTimeFilter));
    return { ...group, groupConsidering, groupLockedIds, visibleSections };
  });

  const isReady = groups.length > 0 && groups.every((g) => g.groupConsidering.length > 0 || g.groupLockedIds.length > 0);
  const creditsLabel = sections[0]?.credits != null ? `${sections[0].credits} cr` : null;
  const filtersActive = isCourseFilterActive(filters);

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

      {!collapsed && !loading && sections.length > 0 && (
        <div className="sched-filter-bar">
          <label className="sched-filter-field">
            <span>Starts after</span>
            <input
              type="time"
              value={filters.startTime}
              onChange={(e) => onFilterChange({ ...filters, startTime: e.target.value })}
            />
          </label>
          <label className="sched-filter-field">
            <span>Starts before</span>
            <input
              type="time"
              value={filters.endTime}
              onChange={(e) => onFilterChange({ ...filters, endTime: e.target.value })}
            />
          </label>
          <label className="sched-filter-field sched-filter-field-professor">
            <span>Professor</span>
            <input
              type="text"
              placeholder="e.g. Smith"
              value={filters.professor}
              onChange={(e) => onFilterChange({ ...filters, professor: e.target.value })}
            />
          </label>
          {filtersActive && (
            <button type="button" className="sched-filter-clear" onClick={() => onFilterChange(EMPTY_COURSE_FILTERS)}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {!collapsed && !loading && groups.map((group) => {
        const allVisibleSelected = group.visibleSections.length > 0 &&
          group.visibleSections.every((s) => group.groupConsidering.includes(s.id) || group.groupLockedIds.includes(s.id));

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
              {group.visibleSections.length > 0 && (
                <button
                  type="button"
                  className="sched-select-all-btn"
                  onClick={() => (allVisibleSelected
                    ? onDeselectAll(group.key)
                    : onSelectAll(group.key, group.visibleSections.map((s) => s.id)))}
                >
                  {allVisibleSelected ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
            {group.visibleSections.length === 0 ? (
              <div className="sched-draft-card-empty">No sections match your filters.</div>
            ) : (
              <div className="sched-section-list">
                {group.visibleSections.map((section) => (
                  <SectionRow
                    key={section.id}
                    section={section}
                    checked={group.groupConsidering.includes(section.id)}
                    locked={lockedIds.has(section.id)}
                    conflicts={conflictMap[section.id]}
                    notes={!group.commonNotes ? section.notes : null}
                    onToggle={() => onToggleSection(group.key, section.id)}
                    onToggleLock={() => onToggleLock(group.key, section.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
