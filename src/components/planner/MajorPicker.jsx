import { useState, useMemo, useEffect } from 'react';
import { BU_SCHOOLS } from '../../data/bu-programs';

// Cascading school → program picker. Owns its own "which school is the
// dropdown showing" state; the actual selection (a bulletin URL) is fully
// controlled by the parent via selectedProgramUrl/onProgramSelect, so more
// than one picker (BulletinPanel, RequirementsSidebar) can stay in sync with
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
          <label htmlFor={`${idPrefix}-program`}>Major / Minor</label>
          <select
            id={`${idPrefix}-program`}
            className="bulletin-major-select"
            value={selectedProgramUrl}
            onChange={handleProgramChange}
          >
            <option value="">— Pick a major or minor —</option>
            {selectedSchool.programs.map((p) => (
              <option key={p.url} value={p.url}>
                {p.name} ({p.degree})
              </option>
            ))}
          </select>
        </div>
      )}

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
