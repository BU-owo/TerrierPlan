import { useState } from 'react';
import { sendReport } from '../utils/reportIssue';
import './HelpSupportModal.css';

// Feedback / report-a-problem form, posted to our Discord through the
// reportIssue Cloud Function (see utils/reportIssue.js). Used in the Help
// modal and the footer's "Send feedback" modal.

const CATEGORIES = [
  ['feedback', 'Feedback'],
  ['missing_course', 'Missing course'],
  ['wrong_info', 'Wrong info'],
  ['bug', 'Bug'],
];
const NOTE_MAX = 300;

// In-memory note drafts for the tab, one per subject (`query`; '' for
// general feedback): the modals unmount when closed, and a typed note must
// survive that and a failed send, without a note about one course turning
// up in another course's report. Only a successful send clears it. Never
// persisted. The category always starts from the opener's default.
const drafts = new Map();

// `query` (optional): what the report is about (e.g. "CAS CS 111"), shown
// above the form and sent with it.
export default function ReportForm({ defaultCategory = '', query = '' }) {
  const [category, setCategory] = useState(defaultCategory);
  const [note, setNoteState] = useState(drafts.get(query) ?? '');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'failed' | 'capped'

  function setNote(value) {
    drafts.set(query, value);
    setNoteState(value);
  }

  async function submit(e) {
    e.preventDefault();
    if (!category || status === 'sending') return;
    setStatus('sending');
    try {
      await sendReport({ category, query, note, website: honeypot });
      drafts.delete(query);
      setCategory(defaultCategory);
      setNoteState('');
      setStatus('sent');
    } catch (err) {
      setStatus(err?.capped ? 'capped' : 'failed');
    }
  }

  if (status === 'sent') {
    return (
      <div className="help-report-form">
        <p className="help-report-msg" role="status">Thanks! We got it.</p>
        <button type="button" className="help-link-btn" onClick={() => setStatus('idle')}>
          Send another
        </button>
      </div>
    );
  }

  return (
    <form className="help-report-form" onSubmit={submit}>
      {query && <p className="help-report-msg">About <strong>{query}</strong></p>}
      <div className="help-report-cats" role="radiogroup" aria-label="What's this about?">
        {CATEGORIES.map(([value, label]) => (
          <label key={value} className={`help-report-cat${category === value ? ' active' : ''}`}>
            <input
              type="radio"
              name="report-category"
              value={value}
              checked={category === value}
              onChange={() => setCategory(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <label className="help-report-note">
        <span>Anything else? (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_MAX}
          rows={3}
        />
        <span className="help-report-count">{note.length}/{NOTE_MAX}</span>
      </label>
      {/* Honeypot: hidden from people, filled in by bots. */}
      <div className="help-report-hp" aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>
      <p className="help-report-public">Feedback is anonymous, but leave out personal info.</p>
      {status === 'failed' && (
        <p className="help-report-msg" role="alert">Couldn&apos;t send that. Your note is still here, try again in a bit.</p>
      )}
      {status === 'capped' && (
        <p className="help-report-msg" role="alert">Lots of reports right now. Try again in a few minutes.</p>
      )}
      <button type="submit" className="help-secondary-btn" disabled={!category || status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
