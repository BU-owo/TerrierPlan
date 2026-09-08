import { useEffect, useState } from 'react';
import { describeRequirementLabels } from '../../utils/hubConstants';
import { useHubProgress, contributorsForRequirement } from '../../hooks/useHubProgress';
import HubYearToggle from './HubYearToggle';
import CourseChip from '../requirements/CourseChip';

// One ring, reused at two sizes (see the overview strip vs. each card's own
// header below) — SVG, no charting library, same currentColor-driven
// approach as the app's other hand-rolled icons (FlagIcon/PinIcon in the
// scheduler). Color comes entirely from whatever hub-ring-<id> class the
// caller wraps it in (see planner.css), which itself just points at the
// existing --hub-* tokens — this component only knows percentage/geometry.
// Label font scales with `size` directly (inline, not a CSS class per
// size) so the same component looks right at 72px and 48px without a
// third implementation.
function HubProgressRing({ percent, size = 56, strokeWidth = 6 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="hub-ring" aria-hidden="true">
      <circle className="hub-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} fill="none" />
      <circle
        className="hub-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        className="hub-ring-label"
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontSize: Math.round(size * 0.24) }}
      >
        {percent}%
      </text>
    </svg>
  );
}

// Splits the (already plan-order-stable) group list into render segments,
// preserving top-to-bottom order: an expanded category becomes its own
// solo full-width segment, and a run of consecutive COLLAPSED categories
// becomes one shared-grid segment. Without this, feeding every card
// straight into one CSS grid left leftover cells wherever an expanded
// (grid-column: 1/-1) card interrupted a partial row, which read as an
// accidental layout break rather than an intentional pattern — segmenting
// first means a run of collapsed cards always starts its OWN grid, so it
// always packs cleanly regardless of what came before it.
function segmentGroups(groupSummaries, collapsedOf) {
  const segments = [];
  let run = [];
  function flushRun() {
    if (run.length > 0) {
      segments.push({ type: 'run', items: run });
      run = [];
    }
  }
  for (const g of groupSummaries) {
    if (collapsedOf(g)) {
      run.push(g);
    } else {
      flushRun();
      segments.push({ type: 'solo', item: g });
    }
  }
  flushRun();
  return segments;
}

// Full-screen overlay/mode rendered from inside PlannerPage (not a route —
// mirrors RequirementsFullView.jsx's pattern exactly: same dialog/Escape
// chrome, opened via PlannerPage's `?view=hub` state instead of duplicating
// it). Progress/completion data comes entirely from useHubProgress, the
// same computation HubSidebar's compact tab uses — this component only
// adds a redesigned, higher-density presentation of it (an overview ring
// strip, collapsible per-category cards, inline course/exam names via the
// shared CourseChip) plus reuses HubYearToggle as-is. Does not touch
// requirementsEngine.js, HUB_REQUIREMENTS.md parsing, or external-credit
// HUB resolution.
export default function HubFullView({
  semesters,
  extraCourseKeys = [],
  externalCredits = [],
  courseMap,
  isTransfer,
  onToggleTransfer,
  lockStatusMap,
  onClose,
}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const { groupSummaries, contributorsByUnit, allFulfilled } = useHubProgress({
    semesters,
    extraCourseKeys,
    externalCredits,
    courseMap,
    isTransfer,
  });

  // Per-category collapse state — the ONE source of truth for both the
  // overview ring row and each category's own card; same "override
  // defaults to computed satisfied-ness" idiom HubSidebar's own
  // collapsedOverrides already uses (satisfied categories start collapsed,
  // everything else starts open), just keyed by group.id.
  const [collapsedOverrides, setCollapsedOverrides] = useState({});

  function isCollapsed(groupSummary) {
    return collapsedOverrides[groupSummary.group.id] ?? groupSummary.satisfied;
  }

  // Toggles in place — no scrollIntoView, whether triggered from an
  // overview ring or a card's own header. The card updates wherever it
  // already sits on the page; scrolling to it is left to the user.
  function toggleGroup(groupId, currentlyCollapsed) {
    setCollapsedOverrides((prev) => ({ ...prev, [groupId]: !currentlyCollapsed }));
  }

  const anyCollapsed = groupSummaries.some((g) => isCollapsed(g));

  function toggleAll() {
    setCollapsedOverrides(Object.fromEntries(groupSummaries.map((g) => [g.group.id, !anyCollapsed])));
  }

  function renderGroupCard(groupSummary) {
    const { group, requirements, fulfilled: groupFulfilled, total: groupTotal, percent, satisfied } = groupSummary;
    const collapsed = isCollapsed(groupSummary);

    return (
      <section key={group.id} className={`hub-full-group${collapsed ? '' : ' is-expanded'}`}>
        <div
          className="hub-full-group-header"
          role="button"
          tabIndex={0}
          onClick={() => toggleGroup(group.id, collapsed)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleGroup(group.id, collapsed);
            }
          }}
          aria-expanded={!collapsed}
        >
          <span className={`hub-ring-wrap hub-ring-${group.id}`}>
            <HubProgressRing percent={percent} size={38} strokeWidth={4} />
          </span>
          <div className="hub-full-group-heading">
            <h3 className="hub-full-group-label">{group.label}</h3>
            <span className={`hub-full-group-count${satisfied ? ' satisfied' : ''}`}>
              {groupFulfilled}/{groupTotal} units
            </span>
          </div>
          <span className="hub-full-group-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        </div>

        {!collapsed && (
          <div className="hub-full-requirements">
            {requirements.map(({ requirement, isSatisfied }) => {
              const { displayLabel, shortLabel } = describeRequirementLabels(requirement);
              const contributors = contributorsForRequirement(requirement, contributorsByUnit);

              return (
                <div key={requirement.id} className={`hub-full-requirement ${isSatisfied ? 'fulfilled' : 'pending'}`}>
                  <div className="hub-full-requirement-header">
                    <span className="hub-full-requirement-indicator" aria-hidden="true">
                      {isSatisfied ? '✓' : '○'}
                    </span>
                    <span className="hub-full-requirement-label">{displayLabel}</span>
                    {shortLabel && <span className="hub-full-requirement-detail">{shortLabel}</span>}
                  </div>
                  <div className="hub-full-requirement-chips">
                    {contributors.length === 0 && (
                      <span className="hub-full-requirement-empty">No courses fulfilling this yet</span>
                    )}
                    {contributors.map((contributor, i) =>
                      contributor.type === 'course' ? (
                        <CourseChip
                          key={`course-${contributor.courseKey}-${i}`}
                          courseKey={contributor.courseKey}
                          courseMap={courseMap}
                          interactive={false}
                          density="full"
                          lockStatus={lockStatusMap?.[contributor.courseKey]}
                        />
                      ) : (
                        <span
                          key={`credit-${i}`}
                          className="req-pool-chip claimed req-pool-chip--full req-pool-chip--completed"
                          title={contributor.label}
                        >
                          <span className="req-pool-chip-check" aria-hidden="true">✓</span>
                          <span className="req-pool-chip-text">{contributor.label}</span>
                          <span className="req-pool-chip-status">{contributor.creditType.toUpperCase()}</span>
                        </span>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  const segments = segmentGroups(groupSummaries, isCollapsed);

  return (
    <div className="full-view" role="dialog" aria-modal="true" aria-label="HUB Tracker">
      <header className="full-view-header">
        <h2 className="full-view-title">HUB Tracker</h2>
        <button
          type="button"
          className="full-view-close"
          onClick={onClose}
          aria-label="Close full-screen HUB Tracker view"
        >
          × Close
        </button>
      </header>
      <div className="full-view-body">
        <div className="full-view-inner">
          <HubYearToggle isTransfer={isTransfer} onToggleTransfer={onToggleTransfer} />

          <div className="hub-full-overview-toolbar">
            <span className="hub-full-overview-heading">HUB Categories</span>
            <button type="button" className="panel-open-full-btn" onClick={toggleAll}>
              {anyCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          </div>

          {/* Overview strip — one ring per category, spread across the full
              width. Each ring is a real toggle on the same collapse state
              the category's own card uses (not a separate "jump" flag) —
              toggles in place, no scrolling. Wraps to more rows on narrow
              viewports rather than scrolling horizontally. */}
          <div className="hub-full-overview">
            {groupSummaries.map((groupSummary) => {
              const { group, percent } = groupSummary;
              const collapsed = isCollapsed(groupSummary);
              return (
                <button
                  key={group.id}
                  type="button"
                  className={`hub-full-overview-item hub-ring-${group.id}`}
                  onClick={() => toggleGroup(group.id, collapsed)}
                  aria-pressed={!collapsed}
                  aria-label={`${group.label} — ${percent}% complete, ${collapsed ? 'collapsed' : 'expanded'}. Toggle.`}
                >
                  <span className={`hub-ring-wrap hub-ring-${group.id}`}>
                    <HubProgressRing percent={percent} size={72} strokeWidth={6} />
                  </span>
                  <span className="hub-full-overview-label">{group.label}</span>
                </button>
              );
            })}
          </div>

          {allFulfilled && (
            <div className="panel-all-fulfilled">
              <p>All HUB requirements fulfilled!</p>
            </div>
          )}

          <div className="hub-full-groups">
            {segments.map((segment, i) =>
              segment.type === 'solo' ? (
                renderGroupCard(segment.item)
              ) : (
                <div key={`run-${i}`} className="hub-full-groups-row">
                  {segment.items.map((g) => renderGroupCard(g))}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
