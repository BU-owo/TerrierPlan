import { useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import HelpSupportModal from '../components/HelpSupportModal';
import { ART_ALT, CREDIT_SHORT, ART_MASCOT_SRC } from '../constants/credits';

// Any URL no route matches. Rendered inside App's shell, so GlobalFooter
// still shows underneath.
export default function NotFoundPage({ theme = 'light', onToggleTheme }) {
  const [showHelpModal, setShowHelpModal] = useState(false);

  return (
    <div className="not-found-page">
      <AppHeader theme={theme} onToggleTheme={onToggleTheme} onOpenHelp={() => setShowHelpModal(true)} />
      <main className="not-found-main">
        <div className="tp-art">
          <img className="not-found-mascot tp-art-cropped tp-art-outline" src={ART_MASCOT_SRC} alt={ART_ALT} width={120} height={99} />
          <p className="tp-art-credit">{CREDIT_SHORT}</p>
        </div>
        <h1 className="not-found-title">This page wandered off.</h1>
        <p className="not-found-text">Nothing lives at this address.</p>
        <Link to="/planner" className="not-found-btn">Go to planner</Link>
      </main>
      <HelpSupportModal open={showHelpModal} onClose={() => setShowHelpModal(false)} />
    </div>
  );
}
