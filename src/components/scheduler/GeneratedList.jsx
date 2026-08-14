import { totalCredits } from '../../utils/scheduleCombos';

const PAGE_SIZE = 25;

// Every valid combination the generator found is kept in memory (see
// scheduleCombos.js — no result-count cap); this only controls how many
// rows are in the DOM at once. "Show more" appends, it never hides results
// that were already counted in the header.
export default function GeneratedList({ generated, sectionsById, courseMap, visibleCount, onShowMore, previewIndex, onPreview }) {
  if (!generated) return null;

  const { schedules, truncated } = generated;

  if (schedules.length === 0) {
    return (
      <div className="sched-generated-empty">
        No conflict-free combination exists for the sections currently in consideration — try
        checking an additional section for one of your courses.
      </div>
    );
  }

  const visible = schedules.slice(0, visibleCount);

  return (
    <div className="sched-generated">
      <div className="sched-generated-header">
        <h3>{schedules.length} possible schedule{schedules.length === 1 ? '' : 's'}</h3>
        {truncated && (
          <span className="sched-generated-truncated-note">
            Stopped early — narrow your in-consideration sections to see the full set.
          </span>
        )}
      </div>

      <div className="sched-generated-list">
        {visible.map((sectionIds, index) => {
          const label = sectionIds
            .map((id) => {
              const section = sectionsById[id];
              if (!section) return null;
              const code = courseMap[section.courseKey]?.courseNumber ?? section.courseKey;
              return `${code} ${section.classSection}`;
            })
            .filter(Boolean)
            .join(', ');
          const credits = totalCredits(sectionIds, sectionsById);

          return (
            <button
              type="button"
              key={index}
              className={`sched-generated-row${previewIndex === index ? ' is-active' : ''}`}
              onClick={() => onPreview(index)}
            >
              <span className="sched-generated-row-index">#{index + 1}</span>
              <span className="sched-generated-row-label">{label}</span>
              <span className="sched-generated-row-credits">{credits} cr</span>
            </button>
          );
        })}
      </div>

      {visibleCount < schedules.length && (
        <button type="button" className="sched-show-more-btn" onClick={onShowMore}>
          Show {Math.min(PAGE_SIZE, schedules.length - visibleCount)} more (
          {schedules.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}

export { PAGE_SIZE };
