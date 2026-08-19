import { useState } from 'react';
import HelpSupportModal from './HelpSupportModal';
import useSiteStats from '../hooks/useSiteStats';

const SUPPORT_EMAIL = 'terrierplan@gmail.com';
const DISCORD_URL = 'https://discord.gg/bostonuniversity';

function pluralizeStudents(n) {
  return `${n.toLocaleString()} student${n === 1 ? '' : 's'}`;
}

export default function GlobalFooter() {
  const [showHelp, setShowHelp] = useState(false);
  const { totalUsersEver, onlineNow } = useSiteStats();

  return (
    <footer className="app-footer">
      <div className="app-footer-row">
        <div className="app-footer-links">
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <span className="app-footer-dot" aria-hidden="true">·</span>
          <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
            Terrier Hub Discord
          </a>
          <span className="app-footer-dot" aria-hidden="true">·</span>
          <button type="button" className="app-footer-help-btn" onClick={() => setShowHelp(true)}>
            Need help?
          </button>
        </div>

        {/* Withheld (not "0 · 0") until both numbers actually arrive, so a
            slow/offline read doesn't flash a wrong zero before correcting
            itself a moment later. */}
        {totalUsersEver != null && onlineNow != null && (
          <div className="app-footer-stats">
            <span>{pluralizeStudents(totalUsersEver)}</span>
            <span className="app-footer-stats-online">
              <span className="app-footer-stats-dot" aria-hidden="true" />
              {onlineNow.toLocaleString()} online now
            </span>
          </div>
        )}
      </div>

      <p className="app-footer-disclaimer">
        Not affiliated with or endorsed by Boston University. This is an independent, community-made,
        mostly vibe-coded tool. Use at your own discretion.
      </p>

      <HelpSupportModal open={showHelp} onClose={() => setShowHelp(false)} />
    </footer>
  );
}
