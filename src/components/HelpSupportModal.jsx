import { BU_LINKS } from '../data/officialLinks';
import './HelpSupportModal.css';

// Exported for the Requirements "want yours next?" line.
export const SUPPORT_EMAIL = 'terrierplan@gmail.com';
export const DISCORD_URL = 'https://discord.gg/bostonuniversity';

export default function HelpSupportModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
      <div className="help-modal">
        <div className="help-modal-header">
          {/* No paw variant reads on both themes, so it follows the theme like the loading screen. */}
          <img
            className="help-modal-paw"
            src={document.documentElement.dataset.theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
            alt="TerrierPlan paw logo"
            width={64}
            height={64}
          />
          <h2 id="help-modal-title">Need a paw?</h2>
          <button type="button" className="help-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="help-modal-body">
          <p className="help-intro">
            TerrierPlan is built and maintained by BUowo and friends, and we want this to be a tool that
            works for YOU. Tell us what's wrong, ask a question, make a suggestion, or just say hi!
          </p>

          <section className="help-section">
            <h3 className="help-section-label">Email us</h3>
            <a className="help-secondary-btn" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </section>

          <section className="help-section">
            <h3 className="help-section-label">Want to chat live?</h3>
            <a
              className="help-discord-btn"
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Join the Terrier Hub Discord
            </a>
          </section>

          <p className="help-disclaimer">
            Independent, not affiliated with BU. Confirm everything with{' '}
            <a href={BU_LINKS.myBU.url} target="_blank" rel="noopener noreferrer">MyBU</a>, the{' '}
            <a href={BU_LINKS.bulletin.url} target="_blank" rel="noopener noreferrer">Bulletin</a>, and your
            advisor.
          </p>
        </div>
      </div>
    </div>
  );
}
