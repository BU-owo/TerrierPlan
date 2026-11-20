import { createPortal } from 'react-dom';
import ReportForm from './ReportForm';
import './HelpSupportModal.css';

// "Send feedback" (footer link, header button): just the report form,
// Feedback preselected. Same shell as HelpSupportModal (only the × closes
// it). Portaled to <body> so the header's stacking context (z-index 20)
// and white text don't apply to it.
// `query` (optional) is what the report is about, e.g. a course code; it's
// shown in the form and sent in the report's Query field.
export default function FeedbackModal({ open, onClose, defaultCategory = 'feedback', query }) {
  if (!open) return null;

  return createPortal(
    <div className="help-overlay feedback-overlay" role="dialog" aria-modal="true" aria-labelledby="feedback-modal-title">
      <div className="help-modal">
        <div className="help-modal-header">
          <h2 id="feedback-modal-title">Send feedback</h2>
          <button type="button" className="help-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="help-modal-body">
          <ReportForm defaultCategory={defaultCategory} query={query} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
