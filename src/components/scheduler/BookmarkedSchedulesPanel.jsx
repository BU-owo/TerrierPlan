import { describeSectionSet, totalCredits } from '../../utils/scheduleCombos';
import FlagIcon from './FlagIcon';

// The lightweight shortlist from the stepper's bookmark toggle — separate
// from SavedSchedulesPanel below it. Bookmarking is meant to be quick and
// disposable ("maybe this one") while browsing combinations; saving is the
// deliberate "keep this one" action. Bookmarks live only in SchedulerPage
// state (not Firestore/localStorage) and persist across draft/search
// changes within the session — only "Clear all" here wipes them, not
// touching a course or regenerating.
export default function BookmarkedSchedulesPanel({
  bookmarks, // [{ key, sectionIds }]
  sectionsById,
  courseMap,
  activeKey,
  onPreview,
  onPromote,
  onRemove,
  onClearAll,
}) {
  if (bookmarks.length === 0) return null;

  return (
    <div className="sched-bookmarks-panel">
      <div className="sched-bookmarks-header">
        <span className="sched-bookmarks-title">
          <FlagIcon filled /> Bookmarked ({bookmarks.length})
        </span>
        <button type="button" className="sched-bookmarks-clear-btn" onClick={onClearAll}>
          Clear all
        </button>
      </div>
      <div className="sched-bookmarks-list">
        {bookmarks.map(({ key, sectionIds }) => {
          const { compact, lines } = describeSectionSet(sectionIds, sectionsById, courseMap);
          const credits = totalCredits(sectionIds, sectionsById);
          return (
            <div key={key} className={`sched-bookmark-row${activeKey === key ? ' is-active' : ''}`}>
              <button
                type="button"
                className="sched-bookmark-row-main"
                onClick={() => onPreview(sectionIds)}
                title={lines.join('\n')}
              >
                <span className="sched-bookmark-row-summary">{compact || `${sectionIds.length} sections`}</span>
                <span className="sched-bookmark-row-credits">{credits} cr</span>
              </button>
              <button
                type="button"
                className="sched-bookmark-save-btn"
                onClick={() => onPromote(key, sectionIds)}
                title="Save this bookmark as a real saved schedule"
              >
                Save
              </button>
              <button
                type="button"
                className="sched-bookmark-remove-btn"
                onClick={() => onRemove(key)}
                aria-label="Remove bookmark"
                title="Remove bookmark"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
