// Day/time parsing and overlap detection for `sections` docs (see
// SCHEMA.md — daysOfWeek is a raw string like "Mon Wed Fri", startTime/
// endTime are raw strings like "01:25PM"). Shared by the section picker's
// inline conflict badges, combination generation, and the weekly grid.
//
// A section may also carry a `meetings` array (same field names per entry
// plus `kind: 'class' | 'exam'`) for sections that meet more than once. A
// section without one behaves exactly as the six top-level fields say.

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

const LEGACY_FIELDS = ['daysOfWeek', 'startTime', 'endTime', 'facilId', 'meetingStartDate', 'meetingEndDate'];

const text = (v) => (typeof v === 'string' ? v : '');

// Raw meeting entries for a section: `section.meetings` when it's a non-empty
// array (entries that aren't objects are skipped; if none survive, fall back),
// otherwise one entry built from the six legacy fields. A missing or unknown
// `kind` means 'class'.
export function getMeetings(section) {
  const list = section?.meetings;
  if (Array.isArray(list)) {
    const entries = list
      .filter((m) => m && typeof m === 'object' && !Array.isArray(m))
      .map((m) => ({
        ...Object.fromEntries(LEGACY_FIELDS.map((f) => [f, text(m[f]).trim()])),
        kind: m.kind === 'exam' ? 'exam' : 'class',
      }));
    if (entries.length > 0) return entries;
  }
  return [{
    ...Object.fromEntries(LEGACY_FIELDS.map((f) => [f, text(section?.[f]).trim()])),
    kind: 'class',
  }];
}

// A meeting only "meets" (and can conflict) if it has both days and a
// parseable start/end time — TBA/async/no-meeting rows never conflict with
// anything. Entries that don't are left out.
const parsedCache = new WeakMap();
function parsedMeetings(section) {
  if (!section || typeof section !== 'object') return { all: [], classes: [], exams: [], first: null };
  let cached = parsedCache.get(section);
  if (!cached) {
    const all = [];
    for (const m of getMeetings(section)) {
      const days = parseDays(m.daysOfWeek);
      const startMin = parseTimeToMinutes(m.startTime);
      const endMin = parseTimeToMinutes(m.endTime);
      if (days.length === 0 || startMin == null || endMin == null) continue;
      all.push({
        days,
        startMin,
        endMin,
        kind: m.kind,
        facilId: m.facilId,
        meetingStartDate: m.meetingStartDate,
        meetingEndDate: m.meetingEndDate,
      });
    }
    const classes = all.filter((m) => m.kind === 'class');
    const first = classes[0] ? { days: classes[0].days, startMin: classes[0].startMin, endMin: classes[0].endMin } : null;
    cached = { all, classes, exams: all.filter((m) => m.kind === 'exam'), first };
    parsedCache.set(section, cached);
  }
  return cached;
}

// Every parseable meeting (class and exam), parsed. Callers must not mutate it.
export function sectionMeetings(section) {
  return parsedMeetings(section).all;
}

export function classMeetings(section) {
  return parsedMeetings(section).classes;
}

export function examMeetings(section) {
  return parsedMeetings(section).exams;
}

// The first class meeting as { days, startMin, endMin }, or null. Kept for
// callers that only deal with one meeting per section.
export function sectionMeeting(section) {
  return parsedMeetings(section).first;
}

function sameSection(a, b) {
  return a === b || (a?.id != null && a.id === b?.id);
}

// Class meetings only — an exam never conflicts, and a section never
// conflicts with itself (its own meetings can overlap each other).
export function sectionsConflict(a, b) {
  if (sameSection(a, b)) return false;
  const meetingsA = classMeetings(a);
  const meetingsB = classMeetings(b);
  for (const ma of meetingsA) {
    for (const mb of meetingsB) {
      if (ma.days.some((d) => mb.days.includes(d)) && ma.startMin < mb.endMin && mb.startMin < ma.endMin) {
        return true;
      }
    }
  }
  return false;
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

// "6:30–8:30pm" (one am/pm when both ends share it), "11:30am–1:00pm" otherwise.
export function formatClockRange(startMin, endMin) {
  const start = formatClock(startMin);
  const end = formatClock(endMin);
  return start.slice(-2) === end.slice(-2) ? `${start.slice(0, -2)}–${end}` : `${start}–${end}`;
}

// One parsed meeting as "Th 8:00–8:50am" (for tooltips).
export function describeMeetingShort(meeting) {
  return `${meeting.days.map((d) => DAY_LETTER[d] ?? d).join('')} ${formatClockRange(meeting.startMin, meeting.endMin)}`;
}

// One parsed meeting as "TTh 8:00am–9:15am".
export function describeMeeting(meeting) {
  const dayLetters = meeting.days.map((d) => DAY_LETTER[d] ?? d).join('');
  return `${dayLetters} ${formatClock(meeting.startMin)}–${formatClock(meeting.endMin)}`;
}

// "Mon Wed Fri" + "01:25PM"/"02:15PM" -> "MWF 1:25pm–2:15pm". A section with
// several class meetings joins them: "TTh 8:00am–9:15am · F 8:00am–8:50am".
// Used in section rows, conflict badges, and grid block labels.
export function describeSectionTime(section) {
  const meetings = classMeetings(section);
  if (meetings.length === 0) return 'No scheduled meeting';
  return meetings.map(describeMeeting).join(' · ');
}

// Same format for the section's exam meeting(s), or "" when it has none.
export function describeExamTime(section) {
  return examMeetings(section).map(describeMeeting).join(' · ');
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

// Chronological sort (earliest day, then earliest start time of the
// section's earliest class meeting) — the section picker's default order.
// Sections with no scheduled meeting (async/TBA) have no time to sort by, so
// they sink to the bottom, tied among themselves by classSection.
function earliestClassMeeting(section) {
  let best = null;
  for (const m of classMeetings(section)) {
    const day = Math.min(...m.days.map((d) => DAY_ORDER.indexOf(d)));
    if (!best || day < best.day || (day === best.day && m.startMin < best.startMin)) {
      best = { day, startMin: m.startMin };
    }
  }
  return best;
}

export function compareSectionsByTime(a, b) {
  const earliestA = earliestClassMeeting(a);
  const earliestB = earliestClassMeeting(b);
  if (!earliestA && !earliestB) return (a.classSection || '').localeCompare(b.classSection || '');
  if (!earliestA) return 1;
  if (!earliestB) return -1;
  if (earliestA.day !== earliestB.day) return earliestA.day - earliestB.day;
  if (earliestA.startMin !== earliestB.startMin) return earliestA.startMin - earliestB.startMin;
  return (a.classSection || '').localeCompare(b.classSection || '');
}

export { DAY_ORDER };
