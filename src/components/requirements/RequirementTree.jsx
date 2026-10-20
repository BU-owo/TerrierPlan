import { useState, useMemo, useEffect, useRef } from 'react';
import { evaluateRequirementTree } from '../../utils/requirementsEngine';
import { normalizeCourseKey } from '../../utils/courseKey';
import { REQUIREMENT_PROGRAMS } from './programs';
import {
  collectAllNodes, collectAllCourseKeys, collectMatchedKeys, segmentCards, nodeShown, nodeProgressState,
} from './treeHelpers';
import {
  courseTally, countNeedsReview, startsCollapsed, requirementsProgressView, progressHeaderText, progressSummaryText,
} from '../../utils/completion';
import MajorPicker from '../planner/MajorPicker';
import RequirementNodeView from './RequirementNodeView';
import ExceptionModal from './ExceptionModal';
import EstimateNote from '../EstimateNote';
import RhettPeek from '../RhettPeek';
import { BU_LINKS } from '../../data/officialLinks';
import { RequirementDragContext } from './requirementDrag';
import { unresolvedLast } from '../../utils/unresolvedLast';
import { DISCORD_URL, SUPPORT_EMAIL } from '../HelpSupportModal';
import { findProgramByUrl } from '../../data/bu-programs';
import useInactiveCourseKeys from '../../hooks/useInactiveCourseKeys';

// The one source of truth for requirement-tree rendering — evaluates the
// program against the plan's courseKeys and renders the tree as cards (one
// per top-level node, bulletin order), slot rows, and the per-node "⋯"
// exception flow. Used both by the compact sidebar tab (density="compact")
// and the full-screen view (density="full") — see RequirementsSidebar.jsx
// and RequirementsFullView.jsx.
// Full density additionally accepts `lockStatusMap` (courseKey ->
// {locked, source}, display-only — never fed into evaluateRequirementTree)
// to distinguish planned vs. completed courses in claimed/fulfilled chips.
// Course chips toggle Paw-tential Courses (`stash`) — never the plan.
export default function RequirementTree({
  density = 'compact',
  majorBulletinUrl,
  planCourseKeys = [],
  // Remaining Marine Semester course slots in the plan (placeholders and
  // research courses in a Marine term), for `poolFrom: "marineSemester"` nodes.
  marineSlots = 0,
  onMajorSelect,
  onSummaryChange,
  courseMap = {},
  onEnsureCourseData,
  requirementOverrides = {},
  onSetRequirementOverride,
  onRemoveRequirementOverride,
  lockStatusMap,
  // lockStatusMap when the done-vs-planned split applies, else undefined
  // (see planSplitEnabled): planned rows, split rings, pool card states.
  splitStatusMap,
  onOpenFullView,
  stash = [],
  onAddToStash,
  onRemoveFromStash,
  onShowCourseInfo,
  // Sidebar on desktop: course rows can be dragged onto semesters.
  dragEnabled = false,
}) {
  const [collapsedOverrides, setCollapsedOverrides] = useState({});
  // Selected tab of a hoisted ONE_OF ("tracks"), by node id.
  const [trackViews, setTrackViews] = useState({});
  // { nodeId, mode: 'waive' | 'substitute' } while the exception form is open
  // ('waive' is only "Mark as done" on an UNRESOLVED node).
  const [exception, setException] = useState(null);
  // Full view's All / Still to do / Done filter — view state only.
  const [viewFilter, setViewFilter] = useState('all');
  const activeFilter = density === 'full' ? viewFilter : 'all';

  const programDef = useMemo(
    () => REQUIREMENT_PROGRAMS.find((p) => p.bulletinUrl === majorBulletinUrl) || null,
    [majorBulletinUrl]
  );

  // A track tab the student picked is evaluated as the active track
  // (forcedTracks), so every total, the banner, the summary and the cards
  // follow the tab. No pick = the engine's own best match. Celebrations
  // (PlannerPage) use their own unforced evaluation.
  const result = useMemo(
    () => (programDef
      ? evaluateRequirementTree(programDef, planCourseKeys, requirementOverrides, { marineSlots, forcedTracks: trackViews })
      : null),
    [programDef, planCourseKeys, requirementOverrides, marineSlots, trackViews]
  );

  const flatNodes = useMemo(() => (result ? collectAllNodes(result.tree) : []), [result]);

  // The engine's own claim set is built from this same normalization, so
  // matching it here is what lets "already claimed elsewhere" and "already
  // in the plan" collapse into a single check.
  const planCourseKeySet = useMemo(
    () => new Set(Array.from(planCourseKeys).filter(Boolean).map(normalizeCourseKey)),
    [planCourseKeys]
  );

  const stashSet = useMemo(() => new Set(stash), [stash]);
  // Long-unoffered courses, hidden from requirement choice lists (see hideInactive).
  const inactiveKeys = useInactiveCourseKeys();

  useEffect(() => {
    onSummaryChange?.({
      badge: result ? `${result.totalCoursesClaimed}/${result.totalCoursesRequired}` : '—',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  useEffect(() => {
    if (!result || !onEnsureCourseData) return;
    const keys = Array.from(collectAllCourseKeys(result.tree));
    const missing = keys.filter((key) => !courseMap[key]);
    if (missing.length > 0) onEnsureCourseData(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Same default as RequirementNodeView: only fully done rows start
  // collapsed (startsCollapsed); a manual toggle always wins.
  function isCollapsed(node) {
    return collapsedOverrides[node.id] ?? startsCollapsed(nodeProgressState(node, splitStatusMap));
  }

  function toggleNode(id, currentlyCollapsed) {
    setCollapsedOverrides((prev) => ({ ...prev, [id]: !currentlyCollapsed }));
  }

  const anyCollapsed = flatNodes.some(isCollapsed);

  function toggleAll() {
    setCollapsedOverrides(Object.fromEntries(flatNodes.map((n) => [n.id, !anyCollapsed])));
  }

  // Whole-row click on a course row: add only (the paw removes). Shows a
  // short "Added to Paw-tential · Undo" toast; already-stashed rows do
  // nothing.
  const [toastKey, setToastKey] = useState(null);
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function addFromRow(courseKey) {
    if (stashSet.has(courseKey)) return;
    onAddToStash?.(courseKey);
    clearTimeout(toastTimer.current);
    setToastKey(courseKey);
    toastTimer.current = setTimeout(() => setToastKey(null), 4000);
  }

  function undoAddFromRow() {
    clearTimeout(toastTimer.current);
    onRemoveFromStash?.(toastKey);
    setToastKey(null);
  }

  function toggleStash(courseKey) {
    if (stashSet.has(courseKey)) onRemoveFromStash?.(courseKey);
    else onAddToStash?.(courseKey);
  }

  const exceptionNode = exception ? flatNodes.find((n) => n.id === exception.nodeId) || null : null;

  // "Substitute a course" choices: any course in the plan that no requirement
  // is counting yet (a course not in the plan yet can be typed in the form).
  const substituteOptions = useMemo(() => {
    if (!exceptionNode || exception?.mode !== 'substitute' || !result) return [];
    const claimed = new Set(collectMatchedKeys(result.tree));
    return Array.from(planCourseKeySet).filter((key) => !claimed.has(key)).sort();
  }, [exceptionNode, exception, result, planCourseKeySet]);

  // Petitions (see requirementsEngine's normalizeSubstitutions). One override
  // per node: { type: 'substitute', substitutions: [{ courseKey, for? }],
  // note? }. Rebuilt from the evaluated node's normalized list, so an older
  // single-course substitute is upgraded the first time it's touched. Fields
  // are omitted rather than set to undefined (Firestore rejects undefined),
  // and a node left with no substitutions loses its override entirely.
  function writeSubstitutions(node, list, newNote) {
    if (list.length === 0) {
      onRemoveRequirementOverride?.(node.id);
      return;
    }
    const existingNote = requirementOverrides[node.id]?.note;
    const note = typeof existingNote === 'string' && existingNote ? existingNote : newNote;
    onSetRequirementOverride?.(node.id, {
      type: 'substitute',
      substitutions: list,
      ...(note ? { note } : {}),
    });
  }

  const toStored = (sub) => ({
    ...(sub.courseKey ? { courseKey: sub.courseKey } : {}),
    ...(sub.label ? { label: sub.label } : {}),
    ...(sub.for ? { for: sub.for } : {}),
  });

  // `courseKey` (a catalog course) and/or `label` (free text for a course from
  // somewhere else); `replaces` is the required course it stands in for.
  function addSubstitution(node, { courseKey, label, replaces, note }) {
    const current = (node.substitutions ?? []).map(toStored);
    writeSubstitutions(node, [...current, toStored({ courseKey, label, for: replaces })], note);
  }

  function undoSubstitution(node, index) {
    const next = (node.substitutions ?? []).filter((_, i) => i !== index).map(toStored);
    writeSubstitutions(node, next);
  }

  const shared = {
    collapsedOverrides,
    onToggle: toggleNode,
    planCourseKeySet,
    courseMap,
    density,
    lockStatusMap,
    splitStatusMap,
    viewFilter: activeFilter,
    stashSet,
    onToggleStash: toggleStash,
    onShowCourseInfo,
    requirementOverrides,
    onRemoveRequirementOverride,
    onMarkDone: (node) => setException({ nodeId: node.id, mode: 'waive' }),
    onSubstitute: (node) => setException({ nodeId: node.id, mode: 'substitute' }),
    onUndo: (node) => onRemoveRequirementOverride(node.id),
    onUndoSubstitution: undoSubstitution,
    flatNodes,
    onAddFromRow: addFromRow,
    inactiveKeys,
  };

  // Same "planning only" line as the HUB views, under the progress summary
  // (prominent in the full view, the small sidebar size in compact).
  const disclaimer = (
    <EstimateNote
      prominent={density === 'full'}
      link={BU_LINKS.myBU}
      lead="For planning only. Verify on the official bulletin and"
      label="MyBU"
    />
  );

  // Tracked programs only; the coming-soon branch has its own bulletin button.
  const bulletinLink = programDef ? (
    <a
      href={programDef.bulletinUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="req-bulletin-link"
    >
      View official bulletin ↗
    </a>
  ) : null;

  // A ONE_OF flagged `presentation: "tracks"` is hoisted out of the card list:
  // its options become a selector under the progress header, and the selected
  // option's children render as ordinary top-level cards. The selected tab
  // follows the engine's active track until the student picks another (view
  // state only — never what is evaluated).
  const rootChildren = result ? (Array.isArray(result.tree.children) ? result.tree.children : [result.tree]) : [];
  const hoisted = rootChildren.find((n) => n.type === 'ONE_OF' && n.presentation === 'tracks' && Array.isArray(n.children)) ?? null;
  const trackIndex = hoisted ? trackViews[hoisted.id] ?? hoisted.activeChildIndex ?? 0 : 0;
  const hoistedTrack = hoisted ? hoisted.children[trackIndex] ?? null : null;
  const topNodes = unresolvedLast(
    rootChildren.flatMap((n) => {
      if (n !== hoisted) return [n];
      if (!hoistedTrack) return [];
      return Array.isArray(hoistedTrack.children) ? hoistedTrack.children : [hoistedTrack];
    })
  );
  // Collapsed cards share grid rows in full density (same as HubFullView);
  // the narrow compact sidebar just stacks them.
  const shownTopNodes = topNodes.filter((node) => nodeShown(node, activeFilter, splitStatusMap));
  const segments = density === 'full'
    ? segmentCards(shownTopNodes, isCollapsed)
    : shownTopNodes.map((item) => ({ type: 'solo', item }));
  // "Courses: 12 done · 3 planned · 2 to go" — the header's own course
  // totals (engine's active track) split by status; advisor items on top.
  // Independent of the All / Still to do / Done filter.
  const tally = result
    ? courseTally({
      claimedTotal: result.totalCoursesClaimed,
      requiredTotal: result.totalCoursesRequired,
      countedKeys: collectMatchedKeys(result.tree),
      statusMap: splitStatusMap,
      toCheck: countNeedsReview(result.tree),
    })
    : null;
  // Header %, the bar's solid (done) + dashed (planned) shares, and which
  // banner shows — never "complete" / confetti while courses are only planned.
  const progress = result
    ? requirementsProgressView({
      satisfied: result.status === 'satisfied',
      claimed: result.totalCoursesClaimed,
      required: result.totalCoursesRequired,
      planned: tally.planned,
    })
    : null;
  const banner = progress?.banner ?? null;
  // Split on: "6 of 15 courses done · 9 planned (· N to add)". Split off:
  // the original "X of Y courses counted" wording, unchanged.
  const headerNumbers = tally && result
    ? { done: tally.done, planned: tally.planned, toGo: tally.toGo, required: result.totalCoursesRequired }
    : null;
  const progressBar = progress && (
    <div
      className="req-progress-bar"
      role="progressbar"
      aria-valuenow={progress.donePercent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={progress.plannedPercent > 0 ? `${progress.donePercent}% done, ${progress.plannedPercent}% planned` : undefined}
    >
      <div className="req-progress-bar-fill" style={{ width: `${progress.donePercent}%` }} />
      {progress.plannedPercent > 0 && (
        <div
          className="req-progress-bar-planned"
          style={{ width: `${progress.plannedPercent}%`, marginLeft: progress.donePercent > 0 ? 2 : 0 }}
        />
      )}
    </div>
  );

  return (
    <RequirementDragContext.Provider value={density === 'compact' && dragEnabled}>
    <div className={`req-panel${density === 'full' ? ' req-panel--full' : ''}`}>
      {/* Sidebar only: way into the full view, same banner as HubSidebar's. */}
      {density === 'compact' && onOpenFullView && (
        <button
          type="button"
          className="hub-full-view-banner"
          onClick={onOpenFullView}
          title="Open full-screen Requirements view"
        >
          <span className="hub-full-view-banner-icon" aria-hidden="true">⤢</span>
          Full view
        </button>
      )}

      {/* Standalone picker — Requirements tracking must work without ever
          opening the Bulletin panel, so this sets majorBulletinUrl directly. */}
      <MajorPicker
        idPrefix={density === 'full' ? 'requirements-full-major' : 'requirements-major'}
        selectedProgramUrl={majorBulletinUrl || ''}
        onProgramSelect={onMajorSelect}
      />

      {!majorBulletinUrl && (
        <div className="panel-empty-state">
          <p>Pick a major above to track your degree requirements.</p>
          <p className="panel-empty-disclaimer">
Hey! This tracker is a work in progress. ~200 majors need to be structured and confirmed manually. I'm only one fella.... Please confirm against the bulletin!
          </p>
        </div>
      )}

      {majorBulletinUrl && !programDef && (
        <div className="panel-empty-state req-coming-soon">
          <p>Tracking for this major is coming soon. Until then, here&apos;s the bulletin page.</p>
          <a
            href={majorBulletinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="req-bulletin-open-btn"
          >
            Open {findProgramByUrl(majorBulletinUrl)?.name ?? 'program'} bulletin ↗
          </a>
          <p className="req-coming-soon-ask">
            Want yours next? Let us know on{' '}
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord</a> or at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      )}

      {/* No progress card without a tracked program — the disclaimer still shows. */}
      {!result && disclaimer}

      {result && (
        <>
          {density === 'full' ? (
            <div className="req-progress-summary">
              <p className="req-progress-summary-text">
                {splitStatusMap
                  ? progressHeaderText(headerNumbers)
                  : `${result.totalCoursesClaimed} of ${result.totalCoursesRequired} courses counted — ${progress.countedPercent}% complete`}
              </p>
              {progressBar}
              <p className="req-progress-summary-sub">{result.programName} {result.degree}</p>
              {bulletinLink}
            </div>
          ) : (
            <div className="req-compact-summary">
              <p className="panel-summary-line">
                {splitStatusMap
                  ? progressHeaderText(headerNumbers, { compact: true })
                  : `${result.totalCoursesClaimed} of ${result.totalCoursesRequired} courses counted`}
                <span className="req-beta-tag">Beta</span>
              </p>
              {progressBar}
              {bulletinLink}
            </div>
          )}

          {disclaimer}

          {hoisted && (
            <div className="hub-year-toggle-group req-one-of-toggle req-tracks-toggle" role="group" aria-label={hoisted.label}>
              {hoisted.children.map((option, i) => (
                <button
                  key={option.id ?? i}
                  type="button"
                  className={`hub-year-toggle-btn${i === trackIndex ? ' active' : ''}`}
                  aria-pressed={i === trackIndex}
                  onClick={() => setTrackViews((prev) => ({ ...prev, [hoisted.id]: i }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {/* Celebrates whenever the plan covers everything; the copy never
              says "complete" while counted courses are still only planned.
              Split off: the original "All requirements satisfied!". */}
          {banner && (
            <div className="panel-all-fulfilled">
              {density === 'compact' && <RhettPeek />}
              <p>
                {banner === 'covered'
                  ? 'Your plan covers every requirement!'
                  : splitStatusMap ? 'All requirements complete!' : 'All requirements satisfied!'}
              </p>
              {banner === 'covered' && (
                <p className="panel-all-fulfilled-sub">
                  {tally.planned} course{tally.planned === 1 ? '' : 's'} still to take
                </p>
              )}
            </div>
          )}

          {density === 'full' && (
            <div className="hub-full-overview-toolbar req-toolbar">
              <div className="hub-year-toggle-group req-filter-toggle" role="group" aria-label="Show requirements">
                {[['all', 'All'], ['todo', 'Still to do'], ['done', 'Done']].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`hub-year-toggle-btn${viewFilter === value ? ' active' : ''}`}
                    aria-pressed={viewFilter === value}
                    onClick={() => setViewFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="req-filter-summary">
                {splitStatusMap ? progressSummaryText(tally) : (
                  <>
                    Courses: {tally.done} done · {tally.planned} planned · {tally.toGo} to go
                    {tally.toCheck > 0 ? ` · ${tally.toCheck} to check with advisor` : ''}
                  </>
                )}
              </span>
              <button type="button" className="panel-open-full-btn" onClick={toggleAll}>
                {anyCollapsed ? 'Expand all' : 'Collapse all'}
              </button>
            </div>
          )}

          <div className="hub-full-groups req-tree">
            {segments.length === 0 && activeFilter !== 'all' && (
              <p className="req-filter-empty">
                {activeFilter === 'done' ? 'Nothing done yet.' : 'Nothing left to do here!'}
              </p>
            )}
            {segments.map((segment, i) =>
              segment.type === 'solo' ? (
                <RequirementNodeView key={segment.item.id} node={segment.item} {...shared} />
              ) : (
                <div key={`run-${i}`} className="hub-full-groups-row">
                  {segment.items.map((node) => (
                    <RequirementNodeView key={node.id} node={node} {...shared} />
                  ))}
                </div>
              ),
            )}
          </div>
        </>
      )}

      {toastKey && (
        <div className="req-toast" role="status">
          Added to Paw-tential ·{' '}
          <button type="button" className="req-toast-undo" onClick={undoAddFromRow}>Undo</button>
        </div>
      )}

      <ExceptionModal
        key={exception ? `${exception.nodeId}:${exception.mode}` : 'closed'}
        node={exceptionNode}
        mode={exception?.mode}
        substituteOptions={substituteOptions}
        hasNote={Boolean(exceptionNode && requirementOverrides[exceptionNode.id]?.note)}
        courseMap={courseMap}
        onSubstitute={addSubstitution}
        onSetOverride={onSetRequirementOverride}
        onClose={() => setException(null)}
      />
    </div>
    </RequirementDragContext.Provider>
  );
}
