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
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>
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
            {/* School selector */}
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
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Program selector */}
            {selectedSchool && (
              <div className="bulletin-major-selector" style={{ marginTop: 8 }}>
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

            {/* Not-found note */}
            {selectedSchool && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                Don't see your program listed? This list covers common
                undergrad majors/minors but isn't exhaustive yet — you can
                still find it directly on{' '}
                <a
                  href="https://www.bu.edu/academics/degree-programs/"
                  target="_blank"
                  rel="noreferrer"
                >
                  BU's degree programs page
                </a>.
              </p>
            )}

            {/* Content pane */}
            {selectedProgram && (
              <div style={{ marginTop: 12 }}>
                <a
                  href={selectedProgram.url}
                  target="_blank"
                  rel="noreferrer"
                  className="bulletin-open-new-tab"
                  style={{
                    display: 'inline-block',
                    fontSize: 12,
                    marginBottom: 8,
                    color: 'var(--text-accent)',
                  }}
                >
                  Open full page in new tab ↗
                </a>

                {!iframeFailed ? (
                  <div style={{ position: 'relative' }}>
                    {iframeLoading && (
                      <div className="bulletin-empty">Loading bulletin page…</div>
                    )}
                    <iframe
                      key={selectedProgram.url}
                      src={selectedProgram.url}
                      title={`${selectedProgram.name} bulletin`}
                      style={{
                        width: '100%',
                        height: '480px',
                        border: '1px solid var(--border, #ddd)',
                        borderRadius: 8,
                        display: iframeLoading ? 'none' : 'block',
                      }}
                      onLoad={() => setIframeLoading(false)}
                      onError={() => {
                        setIframeFailed(true);
                        setIframeLoading(false);
                      }}
                    />
                  </div>
                ) : (
                  <div className="bulletin-empty" style={{ lineHeight: 1.6 }}>
                    This page can't be shown embedded here — BU's site
                    blocks embedding for this page. Use the "Open full
                    page in new tab" link above instead.
                  </div>
                )}
              </div>
            )}

            {!selectedSchool && (
              <div className="bulletin-empty" style={{ marginTop: 12 }}>
                Pick a school to browse its majors and minors.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}