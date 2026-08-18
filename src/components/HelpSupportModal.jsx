import { useState } from 'react';
import './HelpSupportModal.css';

const SUPPORT_EMAIL = 'terrierplan@gmail.com';
const DISCORD_URL = 'https://discord.gg/bostonuniversity';

// The feedback form opens the student's OWN mail client with a mailto:
// link — it is never submitted anywhere on our end, and it goes out from
// their own address, fully attributable to them.
export default function HelpSupportModal({ open, onClose }) {
  const [message, setMessage] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [sent, setSent] = useState(false);

  if (!open) return null;

  function handleClose() {
    setMessage('');
    setReplyEmail('');
    setSent(false);
    onClose();
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    const bodyLines = [message.trim()];
    if (replyEmail.trim()) {
      bodyLines.push('', `Reply-to: ${replyEmail.trim()}`);
    }
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('TerrierPlan Feedback')}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
    // location.href (not window.open) — a mailto: URL hands off to the
    // OS/browser's mail handler without ever navigating this document, so
    // the SPA's state is untouched. window.open would instead leave behind
    // a blank extra tab/window in most browsers since mailto isn't a page.
    window.location.href = mailto;
    setSent(true);
  }

  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
      <div className="help-modal">
        <div className="help-modal-header">
          <h2 id="help-modal-title">Need a hand?</h2>
          <button type="button" className="help-close-btn" onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="help-modal-body">
          <p className="help-intro">
            TerrierPlan is built and maintained by a student, and we genuinely want this to work well for
            you. Tell us what's wrong, ask a question, or just say hi — we read everything.
          </p>

          <section className="help-section">
            <h3 className="help-section-label">Feedback form</h3>
            <form onSubmit={handleSubmit}>
              <textarea
                className="help-textarea"
                placeholder="What's going on? Bug report, feature idea, confusing screen — anything helps."
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setSent(false);
                }}
                rows={5}
                required
              />
              <input
                type="email"
                className="help-email-input"
                placeholder="Your email (optional, if you'd like a reply)"
                value={replyEmail}
                onChange={(e) => {
                  setReplyEmail(e.target.value);
                  setSent(false);
                }}
              />
              <button type="submit" className="help-primary-btn" disabled={!message.trim()}>
                Send feedback
              </button>
              {sent && (
                <p className="help-sent-note">
                  Opening your email app — this'll go out from your own address, so we can reply if you leave
                  one.
                </p>
              )}
            </form>
          </section>

          <section className="help-section">
            <h3 className="help-section-label">Prefer to email us yourself?</h3>
            <a className="help-secondary-btn" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </section>

          <section className="help-section">
            <h3 className="help-section-label">Want to chat live with other students?</h3>
            <a
              className="help-discord-btn"
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Join the Terrier Hub Discord
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
