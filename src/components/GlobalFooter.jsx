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
      <p className="app-footer-line app-footer-disclaimer">
        <strong>Disclaimer:</strong> Not affiliated with or endorsed by Boston University. This is an
        independent, community-made, mostly vibe-coded tool. Use at your own discretion.
      </p>
      <p className="app-footer-line">
        Questions or issues? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
      <p className="app-footer-line">
        Need more help with course planning and registration? Join{' '}
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Terrier Hub Discord
        </a>{' '}
        for community support!
      </p>
      {/* Withheld (not "0 · 0") until both numbers actually arrive, so a
          slow/offline read doesn't flash a wrong zero before correcting
          itself a moment later. */}
      {totalUsersEver != null && onlineNow != null && (
        <p className="app-footer-line app-footer-stats">
          {pluralizeStudents(totalUsersEver)} have used TerrierPlan · {onlineNow.toLocaleString()} online now
        </p>
      )}
      <button type="button" className="app-footer-help-btn" onClick={() => setShowHelp(true)}>
        Need help?
      </button>

      <HelpSupportModal open={showHelp} onClose={() => setShowHelp(false)} />
    </footer>
  );
}
