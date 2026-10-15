import { useState, useMemo, useEffect } from 'react';
import { BU_SCHOOLS } from '../../data/bu-programs';
import { REQUIREMENT_PROGRAMS } from '../requirements/programs';

// Bulletin URLs that have a requirements JSON (tracked programs list first).
const TRACKED_URLS = new Set(REQUIREMENT_PROGRAMS.map((p) => p.bulletinUrl));
// Majors (no minors) in the picker that have requirement tracking.
const TRACKED_MAJOR_COUNT = BU_SCHOOLS.flatMap((s) => s.programs).filter(
  (p) => p.degree !== 'Minor' && TRACKED_URLS.has(p.url)
).length;

// Cascading school → program picker. Owns its own "which school is the
// dropdown showing" state; the actual selection (a bulletin URL) is fully
// controlled by the parent via selectedProgramUrl/onProgramSelect, so more
// than one picker (Requirements tab, Requirements full view) can stay in sync with
// the same plan field without knowing about each other. idPrefix keeps
// element ids unique when multiple pickers are mounted at once.
export default function MajorPicker({ selectedProgramUrl = '', onProgramSelect, idPrefix = 'major-picker' }) {
  const [selectedSchoolCode, setSelectedSchoolCode] = useState('');

  useEffect(() => {
    if (!selectedProgramUrl) return;
    const owningSchool = BU_SCHOOLS.find((s) => s.programs.some((p) => p.url === selectedProgramUrl));
    if (owningSchool && owningSchool.code !== selectedSchoolCode) {
      setSelectedSchoolCode(owningSchool.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProgramUrl]);

  const selectedSchool = useMemo(
    () => BU_SCHOOLS.find((s) => s.code === selectedSchoolCode) || null,
    [selectedSchoolCode]
  );

  // Minors aren't offered (bu-programs.js still lists them). A plan that
  // already has one selected keeps it in the list so the select shows it.
  const { tracked, untracked } = useMemo(() => {
    const programs = (selectedSchool?.programs || []).filter(
      (p) => p.degree !== 'Minor' || p.url === selectedProgramUrl
    );
    return {
      tracked: programs.filter((p) => TRACKED_URLS.has(p.url)),
      untracked: programs.filter((p) => !TRACKED_URLS.has(p.url)),
    };
  }, [selectedSchool, selectedProgramUrl]);

  function handleSchoolChange(e) {
    setSelectedSchoolCode(e.target.value);
    onProgramSelect?.('');
  }

  function handleProgramChange(e) {
    onProgramSelect?.(e.target.value);
  }

  return (
    <div className="major-picker">
      <div className="bulletin-major-selector">
        <label htmlFor={`${idPrefix}-school`}>School / College</label>
        <select
          id={`${idPrefix}-school`}
          className="bulletin-major-select"
          value={selectedSchoolCode}
          onChange={handleSchoolChange}
        >
          <option value="">— Pick a school —</option>
          {BU_SCHOOLS.map((s) => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
      </div>

      {selectedSchool && (
        <div className="bulletin-major-selector">
          <label htmlFor={`${idPrefix}-program`}>Major</label>
          <select
            id={`${idPrefix}-program`}
            className="bulletin-major-select"
            value={selectedProgramUrl}
            onChange={handleProgramChange}
          >
            <option value="">— Pick a major —</option>
            {tracked.length > 0 && (
              <optgroup label="✓ Available now">
                {tracked.map((p) => (
                  <option key={p.url} value={p.url}>
                    {p.name} ({p.degree})
                  </option>
                ))}
              </optgroup>
            )}
            {untracked.length > 0 && (
              <optgroup label="Coming soon (bulletin link only)">
                {untracked.map((p) => (
                  <option key={p.url} value={p.url}>
                    {p.name} ({p.degree})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}

      <p className="bulletin-hint req-tracking-count">
        Requirement tracking is available for {TRACKED_MAJOR_COUNT} major{TRACKED_MAJOR_COUNT === 1 ? '' : 's'}. More are on the way.
      </p>

      {selectedSchool && (
        <p className="bulletin-hint">
          Don't see your program?{' '}
          <a
            href="https://www.bu.edu/academics/degree-programs/"
            target="_blank"
            rel="noreferrer"
          >
            Browse all BU programs ↗
          </a>
        </p>
      )}
    </div>
  );
}
