import { useState } from 'react';
import { DAY_ORDER, formatClock } from '../../utils/sectionTime';
import { TIME_PRESETS, EMPTY_DAY_BOUNDS, isGlobalFilterActive } from '../../utils/sectionFilters';
import TimeSelect from './TimeSelect';

// The global time filter — see sectionFilters.js for the
// { mode, global, perDay } shape this reads and writes. `onChange` always
// receives the FULL next filter object (not a patch), since edits can
// touch deeply nested per-day state; SchedulerPage just wires this
// straight to its setGlobalTimeFilter state setter.
//
// Starts collapsed (most drafts never touch it) behind a summary line, the
// same collapse pattern DraftCourseCard uses for its own header. Body
// content is kept deliberately compact: an unset bound is a small
// "+ Earliest"/"+ Latest" button, not a disabled dropdown trio sitting
// there taking up space — the dropdowns only appear once a bound is on.
const DAY_LABEL = { Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat', Sun: 'Sun' };
// "Customize by day" only offers weekdays — a Sat/Sun section (labs mostly)
// still respects the "same every day" global bounds via
// effectiveBoundsForDay's fallback (see sectionFilters.js), it just can't
// get its own override from this list.
const CUSTOMIZABLE_DAYS = DAY_ORDER.filter((d) => d !== 'Sat' && d !== 'Sun');
const DEFAULT_START = 8 * 60; // 8:00 AM — only used the moment "Earliest" is first turned on
const DEFAULT_END = 18 * 60; // 6:00 PM — only used the moment "Latest" is first turned on

function summarize(value) {
  if (!isGlobalFilterActive(value)) return 'No restriction';
  if (value.mode === 'custom') return 'Customized by day';
  const { startMin, endMin, activePreset } = value.global;
  const preset = TIME_PRESETS.find((p) => p.id === activePreset);
  if (preset) return preset.label;
  if (startMin != null && endMin != null) return `${formatClock(startMin)}–${formatClock(endMin)}`;
  if (startMin != null) return `After ${formatClock(startMin)}`;
  return `Before ${formatClock(endMin)}`;
}

function BoundPill({ label, value, defaultValue, onChange }) {
  if (value == null) {
    return (
      <button type="button" className="sched-time-pill-add" onClick={() => onChange(defaultValue)}>
        + {label}
      </button>
    );
  }
  return (
    <span className="sched-time-pill">
      <span className="sched-time-pill-label">{label}</span>
      <TimeSelect value={value} onChange={onChange} ariaLabelPrefix={label} />
      <button type="button" className="sched-time-pill-clear" onClick={() => onChange(null)} aria-label={`Clear ${label}`}>
        ×
      </button>
    </span>
  );
}

export default function GlobalTimeFilter({ value, onChange, onClear }) {
  const [collapsed, setCollapsed] = useState(true);
  const mode = value.mode === 'custom' ? 'custom' : 'same';
  const globalBounds = value.global;
  const active = isGlobalFilterActive(value);

  function applyGlobalPreset(preset) {
    if (globalBounds.activePreset === preset.id) {
      onChange({ ...value, global: { ...EMPTY_DAY_BOUNDS } });
    } else {
      onChange({ ...value, global: { startMin: preset.startMin, endMin: preset.endMin, activePreset: preset.id } });
    }
  }

  function setGlobalBound(field, min) {
    onChange({ ...value, global: { ...globalBounds, [field]: min, activePreset: null } });
  }

  function setDayBound(day, field, min) {
    const current = value.perDay[day] || EMPTY_DAY_BOUNDS;
    onChange({ ...value, perDay: { ...value.perDay, [day]: { ...current, [field]: min, activePreset: null } } });
  }

  return (
    <div className="sched-global-filter-bar">
      <button
        type="button"
        className="sched-draft-card-toggle"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="sched-draft-card-chevron" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        <span className="sched-global-filter-label">Global time filter</span>
        <span className={`sched-global-filter-summary${active ? ' is-active' : ''}`}>{summarize(value)}</span>
      </button>

      {!collapsed && (
        <div className="sched-global-filter-body">
          <div className="sched-time-row">
            {TIME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`sched-time-preset-chip${globalBounds.activePreset === preset.id ? ' active' : ''}`}
                onClick={() => applyGlobalPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
            <BoundPill label="Earliest" value={globalBounds.startMin} defaultValue={DEFAULT_START} onChange={(min) => setGlobalBound('startMin', min)} />
            <BoundPill label="Latest" value={globalBounds.endMin} defaultValue={DEFAULT_END} onChange={(min) => setGlobalBound('endMin', min)} />
          </div>

          <label className="sched-time-mode-switch">
            <input
              type="checkbox"
              role="switch"
              checked={mode === 'custom'}
              onChange={(e) => onChange({ ...value, mode: e.target.checked ? 'custom' : 'same' })}
            />
            <span className="sched-time-mode-switch-track"><span className="sched-time-mode-switch-thumb" /></span>
            <span>Customize by day</span>
          </label>

          {mode === 'custom' && (
            <div className="sched-time-day-list">
              {CUSTOMIZABLE_DAYS.map((day) => {
                const dayBounds = value.perDay[day] || EMPTY_DAY_BOUNDS;
                return (
                  <div className="sched-time-day-row" key={day}>
                    <span className="sched-time-day-label">{DAY_LABEL[day]}</span>
                    <BoundPill label="Earliest" value={dayBounds.startMin} defaultValue={DEFAULT_START} onChange={(min) => setDayBound(day, 'startMin', min)} />
                    <BoundPill label="Latest" value={dayBounds.endMin} defaultValue={DEFAULT_END} onChange={(min) => setDayBound(day, 'endMin', min)} />
                  </div>
                );
              })}
            </div>
          )}

          <div className="sched-global-filter-footer">
            {active && (
              <button type="button" className="sched-filter-clear" onClick={onClear}>
                Clear global filter
              </button>
            )}
            <span className="sched-global-filter-hint">Applies to every course below, alongside each course's own filters. Sections that don't fit are dimmed, not hidden.</span>
          </div>
        </div>
      )}
    </div>
  );
}
