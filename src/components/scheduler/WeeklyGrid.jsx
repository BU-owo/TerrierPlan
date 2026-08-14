import { DAY_ORDER, sectionMeeting, describeSectionTime, formatClock } from '../../utils/sectionTime';
import { courseColorIndex } from '../../utils/scheduleColors';

const PX_PER_MIN = 2;
const DEFAULT_START = 8 * 60; // 8:00am floor, so an empty/light schedule still reads as a normal day
const DEFAULT_END = 18 * 60; // 6:00pm ceiling
const MIN_BLOCK_HEIGHT = 62; // tall enough for code/time/prof/room even on a short class

function formatHourLabel(hour) {
  const h = hour % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? 'AM' : 'PM'}`;
}

// Renders one schedule (a set of committed sectionIds) as a Mon–Fri (+
// Sat/Sun if actually used) time grid. `lockedSectionIds`/`onToggleLock`/
// `onEliminate` make each block itself interactive — locking or
// eliminating a section right from the grid is meant to feel identical to
// doing it from the draft picker; the caller (SchedulerPage) re-generates
// immediately afterward so the schedule shown here never drifts out of
// sync with what's actually locked/considered.
export default function WeeklyGrid({
  sectionIds,
  sectionsById,
  courseMap,
  lockedSectionIds = new Set(),
  onToggleLock = () => {},
  onEliminate = () => {},
}) {
  const sections = sectionIds.map((id) => sectionsById[id]).filter(Boolean);
  const withMeeting = sections
    .map((section) => ({ section, meeting: sectionMeeting(section) }))
    .filter((m) => m.meeting);
  const withoutMeeting = sections.filter((s) => !sectionMeeting(s));

  if (sections.length === 0) {
    return (
      <div className="sched-grid-empty">
        Generate schedules or load a saved one to preview it here.
      </div>
    );
  }

  const usedDays = new Set(withMeeting.flatMap((m) => m.meeting.days));
  const days = DAY_ORDER.filter((d) => !['Sat', 'Sun'].includes(d) || usedDays.has(d));

  const rawMin = withMeeting.length > 0 ? Math.min(...withMeeting.map((m) => m.meeting.startMin)) : DEFAULT_START;
  const rawMax = withMeeting.length > 0 ? Math.max(...withMeeting.map((m) => m.meeting.endMin)) : DEFAULT_END;
  const gridStart = Math.floor(Math.min(rawMin, DEFAULT_START) / 60) * 60;
  const gridEnd = Math.ceil(Math.max(rawMax, DEFAULT_END) / 60) * 60;

  const hours = [];
  for (let t = gridStart; t <= gridEnd; t += 60) hours.push(t / 60);

  const gridHeight = (gridEnd - gridStart) * PX_PER_MIN;
  const hourPx = 60 * PX_PER_MIN;

  return (
    <div className="sched-grid-wrap">
      <div className="sched-grid-header">
        <div className="sched-grid-time-gutter" />
        {days.map((d) => (
          <div key={d} className="sched-grid-day-label">{d}</div>
        ))}
      </div>
      <div className="sched-grid-body" style={{ height: gridHeight }}>
        <div className="sched-grid-time-gutter">
          {hours.map((h) => (
            <div key={h} className="sched-grid-hour-label" style={{ top: (h * 60 - gridStart) * PX_PER_MIN }}>
              {formatHourLabel(h)}
            </div>
          ))}
        </div>
        <div
          className="sched-grid-days"
          style={{ backgroundSize: `100% ${hourPx}px`, backgroundPosition: '0 0' }}
        >
          {days.map((day) => (
            <div key={day} className="sched-grid-day-col">
              {withMeeting
                .filter((m) => m.meeting.days.includes(day))
                .map(({ section, meeting }) => {
                  const courseCode = courseMap[section.courseKey]?.courseNumber ?? section.courseKey;
                  const isLocked = lockedSectionIds.has(section.id);
                  const profLastName = section.instructors?.[0]?.last || null;
                  const roomAndNbr = [section.facilId, section.classNbr ? `#${section.classNbr}` : null]
                    .filter(Boolean)
                    .join(' · ');

                  return (
                    <div
                      key={`${section.id}-${day}`}
                      className={`sched-grid-block sched-color-${courseColorIndex(section.courseKey)}${isLocked ? ' is-locked' : ''}`}
                      style={{
                        top: (meeting.startMin - gridStart) * PX_PER_MIN,
                        height: Math.max(MIN_BLOCK_HEIGHT, (meeting.endMin - meeting.startMin) * PX_PER_MIN),
                      }}
                      title={`${courseCode} — Section ${section.classSection} — ${describeSectionTime(section)}${section.facilId ? ` — ${section.facilId}` : ''}`}
                    >
                      <div className="sched-grid-block-actions">
                        <button
                          type="button"
                          className={`sched-grid-block-action-btn${isLocked ? ' is-locked' : ''}`}
                          onClick={(e) => { e.stopPropagation(); onToggleLock(section.id); }}
                          aria-label={isLocked ? `Unlock ${courseCode} section ${section.classSection}` : `Lock ${courseCode} section ${section.classSection} into every generated schedule`}
                          title={isLocked ? 'Locked into every generated schedule — click to unlock' : 'Lock this section into every generated schedule'}
                        >
                          {isLocked ? '📌' : '📍'}
                        </button>
                        <button
                          type="button"
                          className="sched-grid-block-action-btn sched-grid-block-eliminate-btn"
                          onClick={(e) => { e.stopPropagation(); onEliminate(section.id); }}
                          aria-label={`Remove ${courseCode} section ${section.classSection} from consideration`}
                          title="Remove from consideration — won't appear in any future generated schedule"
                        >
                          ×
                        </button>
                      </div>
                      <span className="sched-grid-block-code">{courseCode} {section.classSection}</span>
                      <span className="sched-grid-block-time">{formatClock(meeting.startMin)}–{formatClock(meeting.endMin)}</span>
                      {profLastName && <span className="sched-grid-block-prof">{profLastName}</span>}
                      {roomAndNbr && <span className="sched-grid-block-room">{roomAndNbr}</span>}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>

      {withoutMeeting.length > 0 && (
        <div className="sched-grid-no-meeting">
          No scheduled meeting time: {withoutMeeting
            .map((s) => `${courseMap[s.courseKey]?.courseNumber ?? s.courseKey} (${s.classSection})`)
            .join(', ')}
        </div>
      )}
    </div>
  );
}
