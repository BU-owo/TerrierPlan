// Day/time parsing and overlap detection for `sections` docs (see
// SCHEMA.md — daysOfWeek is a raw string like "Mon Wed Fri", startTime/
// endTime are raw strings like "01:25PM"). Shared by the section picker's
// inline conflict badges, combination generation, and the weekly grid.

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// "Mon Wed Fri" -> ["Mon", "Wed", "Fri"]. Blank/missing (async, TBA, no
// scheduled meeting) yields [].
export function parseDays(daysOfWeek) {
  if (!daysOfWeek) return [];
  return daysOfWeek
    .split(/\s+/)
    .map((d) => d.trim())
    .filter((d) => DAY_ORDER.includes(d));
}

// "01:25PM" -> 805 (minutes since midnight). Returns null for blank/
// unparseable input rather than throwing — plenty of rows have no time.
export function parseTimeToMinutes(time) {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})(AM|PM)$/i.exec(time.trim());
  if (!match) return null;
  let [, hourStr, minuteStr, meridiem] = match;
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  if (meridiem.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (meridiem.toUpperCase() === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

// A section only "meets" (and can conflict) if it has both days and a
// parseable start/end time — TBA/async/no-meeting rows never conflict with
// anything.
export function sectionMeeting(section) {
  const days = parseDays(section?.daysOfWeek);
  const startMin = parseTimeToMinutes(section?.startTime);
  const endMin = parseTimeToMinutes(section?.endTime);
  if (days.length === 0 || startMin == null || endMin == null) return null;
  return { days, startMin, endMin };
}

export function sectionsConflict(a, b) {
  const meetingA = sectionMeeting(a);
  const meetingB = sectionMeeting(b);
  if (!meetingA || !meetingB) return false;
  const sharesDay = meetingA.days.some((d) => meetingB.days.includes(d));
  if (!sharesDay) return false;
  return meetingA.startMin < meetingB.endMin && meetingB.startMin < meetingA.endMin;
}

// Exported (not just used internally by describeSectionTime) so callers
// that already have a day figured out — the weekly grid, which positions a
// block on one specific day column — can render just the time portion
// without repeating day letters that would be redundant there.
export function formatClock(min) {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const meridiem = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}${meridiem}`;
}

// Short day letters that stay unambiguous (Tue/Thu and Sat/Sun otherwise
// collide on their first letter alone).
const DAY_LETTER = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'Th', Fri: 'F', Sat: 'Sa', Sun: 'Su' };

// "Mon Wed Fri" + "01:25PM"/"02:15PM" -> "MWF 1:25–2:15pm". Used in section
// rows, conflict badges, and grid block labels.
export function describeSectionTime(section) {
  const meeting = sectionMeeting(section);
  if (!meeting) return 'No scheduled meeting';
  const dayLetters = meeting.days.map((d) => DAY_LETTER[d] ?? d).join('');
  return `${dayLetters} ${formatClock(meeting.startMin)}–${formatClock(meeting.endMin)}`;
}

// "Open — 12/30 seats" / "Closed — waitlist available (3/10)" / "Closed" —
// used by the section-swap ghost tooltip and mobile sheet. `enrlStat` is
// the raw "Open"/"Closed" BU exports (see SCHEMA.md); waitlist detail only
// shows up when the section actually has waitlist capacity.
export function describeSeatStatus(section) {
  const status = (section.enrlStat || '').trim();
  const seatsLabel = section.capEnrl != null ? `${section.totEnrl ?? 0}/${section.capEnrl} seats` : null;
  if (status.toLowerCase() === 'closed' && section.waitCap > 0) {
    const waitLabel = section.waitTot != null ? ` (${section.waitTot}/${section.waitCap})` : '';
    return `Closed — waitlist available${waitLabel}`;
  }
  if (status) return seatsLabel ? `${status} — ${seatsLabel}` : status;
  return seatsLabel || 'Seat status unknown';
}

// Chronological sort (earliest day, then earliest start time) — the
// section picker's default order. Sections with no scheduled meeting
// (async/TBA) have no time to sort by, so they sink to the bottom, tied
// among themselves by classSection.
export function compareSectionsByTime(a, b) {
  const meetingA = sectionMeeting(a);
  const meetingB = sectionMeeting(b);
  if (!meetingA && !meetingB) return (a.classSection || '').localeCompare(b.classSection || '');
  if (!meetingA) return 1;
  if (!meetingB) return -1;
  const dayA = Math.min(...meetingA.days.map((d) => DAY_ORDER.indexOf(d)));
  const dayB = Math.min(...meetingB.days.map((d) => DAY_ORDER.indexOf(d)));
  if (dayA !== dayB) return dayA - dayB;
  if (meetingA.startMin !== meetingB.startMin) return meetingA.startMin - meetingB.startMin;
  return (a.classSection || '').localeCompare(b.classSection || '');
}

export { DAY_ORDER };
