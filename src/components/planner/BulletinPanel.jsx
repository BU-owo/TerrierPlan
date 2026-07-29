import { useState, useMemo } from 'react';
import { BU_SCHOOLS } from '../../data/bu-programs';

export default function BulletinPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSchoolCode, setSelectedSchoolCode] = useState('');
  const [selectedProgramUrl, setSelectedProgramUrl] = useState('');
  const [iframeFailed, setIframeFailed] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);

  const selectedSchool = useMemo(
    () => BU_SCHOOLS.find((s) => s.code === selectedSchoolCode) || null,
    [selectedSchoolCode]
  );

  const selectedProgram = useMemo(() => {
    if (!selectedSchool || !selectedProgramUrl) return null;
    return selectedSchool.programs.find((p) => p.url === selectedProgramUrl) || null;
  }, [selectedSchool, selectedProgramUrl]);

  function handleSchoolChange(e) {
    setSelectedSchoolCode(e.target.value);
    setSelectedProgramUrl('');
    setIframeFailed(false);
  }

  function handleProgramChange(e) {
    setSelectedProgramUrl(e.target.value);
    setIframeFailed(false);
    setIframeLoading(true);
  }

  return (
    <div className="bulletin-panel">
      {/* Toggle bar */}
      <div
        className="bulletin-toggle-bar"
        onClick={() => setIsOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setIsOpen((o) => !o)}
        aria-expanded={isOpen}
      >
        <div className="bulletin-toggle-left">
          <span>📋</span>
          <span>Major & Minor Bulletin</span>
          {selectedProgram && (
            <span className="bulletin-selected-label">
              — {selectedProgram.name} ({selectedProgram.degree})
            </span>
          )}
        </div>
        <span className={`bulletin-toggle-arrow${isOpen ? ' open' : ''}`}>▼</span>
      </div>

      {/* Collapsible body */}
      <div className={`bulletin-body${isOpen ? ' open' : ''}`}>
        <div className="bulletin-body-inner">
          <div className="bulletin-content-area">

            {/* Left: selectors */}
            <div className="bulletin-left">
              <div className="bulletin-major-selector">
                <label htmlFor="bulletin-school">School / College</label>
                <select
                  id="bulletin-school"
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
                  <label htmlFor="bulletin-program">Major / Minor</label>
                  <select
                    id="bulletin-program"
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

            {/* Right: viewer */}
            <div className="bulletin-right">
              {!selectedSchool && (
                <div className="bulletin-empty">
                  Pick a school to browse its majors and minors.
                </div>
              )}

              {selectedSchool && !selectedProgram && (
                <div className="bulletin-empty">
                  Pick a major or minor to see its requirements.
                </div>
              )}

              {selectedProgram && (
                <>
                  <a
                    href={selectedProgram.url}
                    target="_blank"
                    rel="noreferrer"
                    className="bulletin-open-new-tab"
                  >
                    Open full page in new tab ↗
                  </a>

                  {!iframeFailed ? (
                    <div className="bulletin-iframe-wrapper">
                      {iframeLoading && (
                        <div className="bulletin-loading">Loading bulletin page…</div>
                      )}
                      <iframe
                        key={selectedProgram.url}
                        src={selectedProgram.url}
                        title={`${selectedProgram.name} bulletin`}
                        className={`bulletin-iframe${iframeLoading ? ' hidden' : ''}`}
                        onLoad={() => setIframeLoading(false)}
                        onError={() => {
                          setIframeFailed(true);
                          setIframeLoading(false);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="bulletin-empty">
                      BU's site blocks this page from being embedded.
                      Use the link above to open it in a new tab.
                    </div>
                  )}
                </>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}