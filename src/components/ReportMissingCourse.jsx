import { useState } from 'react';
import { sendReport } from '../utils/reportIssue';

const NOTE_MAX = 300;

// "Report a missing course" for an empty course search (planner and
// scheduler). Two taps: the first asks to confirm the exact query, the
// second sends the query, the term filter, the page and an optional note.
// Callers key it by query, so a new search gets a fresh button.
export default function ReportMissingCourse({ query, term }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'confirm' | 'sending' | 'sent' | 'failed' | 'capped'
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  async function report() {
    setStatus('sending');
    try {
      await sendReport({ category: 'missing_course', query, term, note });
      setStatus('sent');
    } catch (err) {
      setStatus(err?.capped ? 'capped' : 'failed');
    }
  }

  if (status === 'sent') {
    return <div className="search-report" role="status">Thanks! We&apos;ll take a look.</div>;
  }
  if (status === 'idle') {
    return (
      <div className="search-report">
        <button type="button" className="hub-stash-link" onClick={() => setStatus('confirm')}>
          Report a missing course
        </button>
      </div>
    );
  }
  const sending = status === 'sending';
  return (
    <div className="search-report">
      <div>Report &ldquo;{query}&rdquo; as missing?</div>
      {noteOpen && (
        <label className="search-report-note">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={2}
            placeholder="Anything that helps us find it (optional)"
            aria-label="Note (optional)"
            disabled={sending}
          />
          <span>Anonymous, but leave out personal info. {note.length}/{NOTE_MAX}</span>
        </label>
      )}
      <div className="search-report-actions">
        <button type="button" className="hub-stash-link" onClick={report} disabled={sending}>
          {sending ? 'Sending…' : 'Yes, report it'}
        </button>
        {!noteOpen && (
          <button type="button" className="hub-stash-link search-report-cancel" onClick={() => setNoteOpen(true)} disabled={sending}>
            Add a note
          </button>
        )}
        <button type="button" className="hub-stash-link search-report-cancel" onClick={() => setStatus('idle')} disabled={sending}>
          Cancel
        </button>
      </div>
      {status === 'failed' && <div role="alert">Couldn&apos;t send that. Try again in a bit.</div>}
      {status === 'capped' && <div role="alert">Lots of reports right now. Try again in a few minutes.</div>}
    </div>
  );
}
