import { useState, useMemo } from 'react';
import { BU_SCHOOLS } from '../../data/bu-programs';
import MajorPicker from './MajorPicker';

// selectedProgramUrl / onProgramSelect are lifted up so the active plan's
// majorBulletinUrl (also editable from the Requirements tab via its own
// MajorPicker) stays in sync with whatever major is picked here — see
// SCHEMA.md's `majorBulletinUrl` field.
export default function BulletinPanel({ selectedProgramUrl = '', onProgramSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);

  const selectedProgram = useMemo(() => {
    if (!selectedProgramUrl) return null;
    for (const school of BU_SCHOOLS) {
      const found = school.programs.find((p) => p.url === selectedProgramUrl);
      if (found) return found;
    }
    return null;
  }, [selectedProgramUrl]);

  function handleProgramSelect(url) {
    onProgramSelect?.(url);
    setIframeFailed(false);
    setIframeLoading(Boolean(url));
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
              <MajorPicker
                idPrefix="bulletin"
                selectedProgramUrl={selectedProgramUrl}
                onProgramSelect={handleProgramSelect}
              />
            </div>

            {/* Right: viewer */}
            <div className="bulletin-right">
              {!selectedProgram && (
                <div className="bulletin-empty">
                  Pick a school, then a major or minor, to see its bulletin page.
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
