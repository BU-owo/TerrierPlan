import { useState } from 'react';
import { getApHub, getIbHub } from '../../data/apIbHubCredit';
import { HUB_LABELS } from '../../utils/hubConstants';

export default function ExternalCreditsPanel({ externalCredits, onRemove, onUpdate }) {
  const [collapsed, setCollapsed] = useState(false);
  const credits = Array.isArray(externalCredits) ? externalCredits : [];

  if (!credits.length) return null;

  if (collapsed) {
    return (
      <div className="plan-side-panel collapsed">
        <button type="button" className="plan-side-panel-expand" onClick={() => setCollapsed(false)}>
          External Credit · {credits.length} item{credits.length === 1 ? '' : 's'}
        </button>
      </div>
    );
  }

  return (
    <div className="plan-side-panel external-credits-panel">
      <div className="plan-side-panel-header">
        <div>
          <h3>External Credit</h3>
          <p className="plan-side-panel-sub">
            AP credit may count toward HUB; transfer credit never does
          </p>
        </div>
        <button
          type="button"
          className="plan-side-panel-collapse"
          onClick={() => setCollapsed(true)}
          title="Collapse"
        >
          −
        </button>
      </div>

      <ul className="external-credits-list">
        {credits.map((ec, i) => {
          const isTestCredit = ec.type === 'ap' || ec.type === 'ib';
          const testHub = isTestCredit
            ? (Array.isArray(ec.manualHubUnits)
              ? ec.manualHubUnits
              : ec.type === 'ib'
                ? getIbHub(ec.testSubject, ec.score, ec.isHigherLevel)
                : getApHub(ec.testSubject, ec.score))
            : null;
          const needsMapping = ec.type === 'transfer' && (ec.status === 'needs_mapping' || !ec.courseKey);
          const needsApReview = isTestCredit && testHub === null;
          const needsReview = needsMapping || needsApReview;
          return (
          <li
            key={`${ec.type}-${ec.courseKey || ec.sourceTitle}-${i}`}
            className={`external-credit-row ${needsReview ? 'needs-review' : ''}`}
          >
            <div className="external-credit-main">
              <span className={`external-credit-type type-${ec.type}`}>
                {ec.type === 'ap' ? 'AP' : ec.type === 'ib' ? 'IB' : 'Transfer'}
              </span>
              <div>
                <div className="external-credit-title">
                  {ec.courseKey || 'Unmapped'} · {ec.sourceTitle}
                </div>
                <div className="external-credit-meta">
                  {ec.testSubject && <span>{ec.testSubject}</span>}
                  {ec.score != null && <span>Score {ec.score}</span>}
                  {ec.institution && <span>{ec.institution}</span>}
                  <span>{ec.credits} cr</span>
                </div>
                {needsMapping && (
                  <div className="external-credit-warning">
                    Needs BU equivalent — check MyBU
                    <input
                      type="text"
                      aria-label={`BU equivalent for ${ec.sourceTitle}`}
                      placeholder="e.g. CASMA 225"
                      value={ec.courseKey || ''}
                      onChange={(e) => onUpdate?.(i, {
                        courseKey: e.target.value.replace(/\s+/g, '').toUpperCase() || null,
                        status: e.target.value.trim() ? 'mapped' : 'needs_mapping',
                      })}
                    />
                  </div>
                )}
                {needsApReview && (
                  <div className="external-credit-warning">
                    Needs manual HUB review — exam or score could not be resolved
                    <label className="external-credit-hub-picker">
                      HUB units that BU confirmed
                      <select
                        multiple
                        value={ec.manualHubUnits || []}
                        onChange={(e) => onUpdate?.(i, {
                          manualHubUnits: Array.from(e.target.selectedOptions, (option) => option.value),
                          status: 'manual_hub_confirmed',
                        })}
                      >
                        {Object.entries(HUB_LABELS).map(([code, label]) => (
                          <option key={code} value={code}>{code} — {label}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="external-credit-no-hub"
                      onClick={() => onUpdate?.(i, {
                        manualHubUnits: [],
                        status: 'no_hub_confirmed',
                      })}
                    >
                      Confirm no HUB
                    </button>
                  </div>
                )}
                {isTestCredit && Array.isArray(testHub) && (
                  <div className="external-credit-hub">
                    {testHub.length > 0 ? `HUB: ${testHub.join(' · ')}` : 'No HUB confirmed'}
                  </div>
                )}
              </div>
            </div>
            {onRemove && (
              <button
                type="button"
                className="external-credit-remove"
                onClick={() => onRemove(i)}
                aria-label="Remove external credit"
              >
                ×
              </button>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
