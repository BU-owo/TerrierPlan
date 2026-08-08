import { useState } from 'react';

export default function PlanSelector({
  plans,
  activePlanId,
  planName,
  saving,
  saveStatus,
  onSelectPlan,
  onRenamePlan,
  onNewPlan,
  onDeletePlan,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() {
    setDraft(planName);
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== planName) onRenamePlan(trimmed);
    setEditing(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(false);
  }

  const statusLabel =
    saving ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error' : null;

  return (
    <div className="plan-selector">
      {/* Plan switcher dropdown */}
      {plans.length > 1 && (
        <select
          className="plan-select"
          value={activePlanId ?? ''}
          onChange={(e) => onSelectPlan(e.target.value)}
          title="Switch plan"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {/* Editable plan name */}
      {editing ? (
        <input
          className="plan-name-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          autoFocus
          maxLength={60}
        />
      ) : (
        <button
          className="plan-btn-icon"
          title={`Plan: ${planName} — click to rename`}
          onClick={startEdit}
          style={{ width: 'auto', padding: '0 10px', fontSize: 13, fontWeight: 600, gap: 4, maxWidth: 200 }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {planName}
          </span>
          <span style={{ fontSize: 10, opacity: 0.7 }}>✏</span>
        </button>
      )}

      {/* New plan */}
      <button
        className="plan-btn-icon"
        title="New plan"
        onClick={onNewPlan}
      >
        +
      </button>

      {/* Delete plan */}
      {activePlanId && (
        <button
          className="plan-btn-icon danger"
          title="Delete this plan"
          onClick={() => onDeletePlan(activePlanId)}
        >
          🗑
        </button>
      )}

      {/* Save status */}
      {statusLabel && (
        <span className={`save-badge ${saving ? 'saving' : saveStatus}`}>
          {statusLabel}
        </span>
      )}
    </div>
  );
}
