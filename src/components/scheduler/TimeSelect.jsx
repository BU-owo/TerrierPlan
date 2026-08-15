// A time-of-day picker built from three plain <select> dropdowns (hour,
// minute, AM/PM) instead of a text/native time input — no typing, just
// clicking through familiar options. `value` and `onChange` deal only in
// minutes-since-midnight; this component owns the 12-hour display math.
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 15, 30, 45];

function minutesToParts(min) {
  const clamped = ((min % 1440) + 1440) % 1440;
  const hour24 = Math.floor(clamped / 60);
  const minute = clamped % 60;
  const meridiem = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour, minute, meridiem };
}

function partsToMinutes(hour, minute, meridiem) {
  const hour24 = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
  return hour24 * 60 + minute;
}

export default function TimeSelect({ value, onChange, disabled, ariaLabelPrefix }) {
  const { hour, minute, meridiem } = minutesToParts(value ?? 8 * 60);

  function update(next) {
    onChange(partsToMinutes(next.hour, next.minute, next.meridiem));
  }

  return (
    <span className="sched-time-select">
      <select
        disabled={disabled}
        value={hour}
        onChange={(e) => update({ hour: Number(e.target.value), minute, meridiem })}
        aria-label={`${ariaLabelPrefix} hour`}
      >
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select
        disabled={disabled}
        value={minute}
        onChange={(e) => update({ hour, minute: Number(e.target.value), meridiem })}
        aria-label={`${ariaLabelPrefix} minute`}
      >
        {MINUTES.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
      <select
        disabled={disabled}
        value={meridiem}
        onChange={(e) => update({ hour, minute, meridiem: e.target.value })}
        aria-label={`${ariaLabelPrefix} AM or PM`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  );
}
