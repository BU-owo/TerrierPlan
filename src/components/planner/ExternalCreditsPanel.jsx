import { memo, useEffect, useState } from 'react';
import { getApHub, getIbHub } from '../../data/apIbHubCredit';
import { HUB_LABELS } from '../../utils/hubConstants';
import { normalizeExternalCredit } from '../../utils/externalCredits';
import { resolveApHubFromScore, isKnownScoreDependentAp } from '../../utils/apScoreResolution';

const DEBUG_EXTERNAL_CREDITS = true;

function debugExternalCredits(stage, payload) {
  if (!DEBUG_EXTERNAL_CREDITS) return;
  console.log(`[DEBUG ExternalCreditsPanel] ${stage}`, payload);
}

const TransferExternalCreditRow = memo(function TransferExternalCreditRow({
  credit,
  index,
  onUpdate,
}) {
  const [courseKeyDraft, setCourseKeyDraft] = useState(credit.courseKey || '');

  useEffect(() => {
    setCourseKeyDraft(credit.courseKey || '');
  }, [credit.courseKey, credit.sourceTitle]);

  function commitCourseKey(nextValue) {
    onUpdate?.(index, {
      courseKey: nextValue.replace(/\s+/g, '').toUpperCase() || null,
      status: nextValue.trim() ? 'mapped' : 'needs_mapping',
    });
  }

  return (
    <div className="external-credit-warning">
      Needs BU equivalent — check MyBU
      <input
        type="text"
        aria-label={`BU equivalent for ${credit.sourceTitle}`}
        placeholder="e.g. CASMA 225"
        value={courseKeyDraft}
        onChange={(e) => {
          const nextValue = e.target.value;
          setCourseKeyDraft(nextValue);
          commitCourseKey(nextValue);
        }}
        onBlur={(e) => commitCourseKey(e.target.value)}
      />
    </div>
  );
});

export default function ExternalCreditsPanel({ externalCredits, onRemove, onUpdate }) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingScoreIndex, setEditingScoreIndex] = useState(null);
  const credits = Array.isArray(externalCredits) ? externalCredits : [];
  debugExternalCredits('render-props', {
    collapsed,
    count: credits.length,
    transferCredits: credits.filter((c) => normalizeExternalCredit(c)?.type === 'transfer'),
    externalCredits: credits,
  });

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
          const normalized = normalizeExternalCredit(ec) || ec;
          const type = normalized.type;
          const isTestCredit = type === 'ap' || type === 'ib';
          const testHub = isTestCredit
            ? (Array.isArray(normalized.manualHubUnits)
              ? normalized.manualHubUnits
              : type === 'ib'
                ? getIbHub(normalized.testSubject, normalized.score, normalized.isHigherLevel)
                : getApHub(normalized.testSubject, normalized.score))
            : null;
          const knownScoreDependentAp = type === 'ap' && isKnownScoreDependentAp(normalized.testSubject);
          const hasKnownApScorePath = knownScoreDependentAp
            && testHub === null
            && normalized.score == null;
          const showScoreEditor = knownScoreDependentAp && (hasKnownApScorePath || editingScoreIndex === i);
          const needsMapping = type === 'transfer' && (normalized.status === 'needs_mapping' || !normalized.courseKey);
          const needsApReview = (type === 'ib' && testHub === null) || (type === 'ap' && testHub === null && !knownScoreDependentAp);
          const needsReview = needsMapping || needsApReview;
          return (
          <li
            key={`${type}-${normalized.courseKey || normalized.sourceTitle}-${i}`}
            className={`external-credit-row ${needsReview ? 'needs-review' : ''}`}
          >
            <div className="external-credit-main">
              <span className={`external-credit-type type-${type}`}>
                {type === 'ap' ? 'AP' : type === 'ib' ? 'IB' : 'Transfer'}
              </span>
              <div>
                <div className="external-credit-title">
                  {normalized.courseKey || 'Unmapped'} · {normalized.sourceTitle}
                </div>
                <div className="external-credit-meta">
                  {normalized.testSubject && <span>{normalized.testSubject}</span>}
                  {normalized.score != null && <span>Score {normalized.score}</span>}
                  {normalized.institution && <span>{normalized.institution}</span>}
                  <span>{normalized.credits} cr</span>
                  {knownScoreDependentAp && normalized.score != null && (
                    <button
                      type="button"
                      className="external-credit-score-edit-btn"
                      onClick={() => setEditingScoreIndex((prev) => (prev === i ? null : i))}
                    >
                      Edit score
                    </button>
                  )}
                </div>
                {needsMapping && (
                  <TransferExternalCreditRow
                    credit={normalized}
                    index={i}
                    onUpdate={onUpdate}
                  />
                )}
                {showScoreEditor && (
                  <div className="external-credit-warning external-credit-score-picker">
                    Select AP score to resolve HUB units
                    <label className="external-credit-score-label">
                      Score
                      <select
                        className="external-credit-score-select"
                        value={normalized.score ?? ''}
                        onChange={(e) => {
                          const resolved = resolveApHubFromScore(normalized.testSubject, e.target.value);
                          onUpdate?.(i, {
                            score: resolved.score,
                            manualHubUnits: Array.isArray(resolved.hubUnits) ? resolved.hubUnits : undefined,
                            status: resolved.score == null ? 'needs_review' : 'auto_hub_resolved',
                          });
                        }}
                      >
                        <option value="">—</option>
                        {[1, 2, 3, 4, 5].map((scoreOption) => (
                          <option key={scoreOption} value={scoreOption}>{scoreOption}</option>
                        ))}
                      </select>
                    </label>
                    <div className="external-credit-score-actions">
                      <button
                        type="button"
                        className="external-credit-score-btn"
                        onClick={() => setEditingScoreIndex(null)}
                      >
                        Done
                      </button>
                    </div>
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
