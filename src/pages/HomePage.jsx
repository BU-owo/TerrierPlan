import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import HelpSupportModal from '../components/HelpSupportModal';
import './home.css';

// Duplicated from HelpSupportModal.jsx / GlobalFooter.jsx, which each keep
// their own unexported copy — keep all three in sync if either changes.
const SUPPORT_EMAIL = 'terrierplan@gmail.com';
const DISCORD_URL = 'https://discord.gg/bostonuniversity';

const COMING_SOON_PREFIX = 'Coming Soon: ';

// Copy is the author's text verbatim. An item is either a plain string or
// { text, children } for a bullet with nested sub-bullets.
const FEATURES = [
  {
    id: 'plan',
    title: 'Plan your Degree',
    image: '/RhettPlan.png',
    alt: 'Rhett the Boston terrier holding a red pencil beside a long unrolled planning scroll',
    items: [
      'Map out your time at BU!',
      'Drag courses between semesters on the semester grid',
      'Lock individual courses or whole semesters into your plan',
      'Create multiple plans',
      'Locked courses carry across plans',
      'Guest mode: no account needed, and it moves to your account when you sign in',
      'Super senior? Add an extra year and summers as needed!',
      'Entering your past courses too much of a hassle? Automatically read info from your transcript in browser',
      'Compatible with AP, IB, and transfer credits',
      'Add AP/IB exams by hand, no transcript needed',
      'Search for courses by department, HUB, or name',
      'View historical offering data, no more guessing when a course is offered',
      'Coming Soon: Compare multiple plans at once',
    ],
  },
  {
    id: 'requirements',
    title: 'Check off your Requirements',
    image: '/RhettCheck.png',
    alt: 'Rhett the Boston terrier climbing over a giant red checkmark',
    items: [
      {
        text: 'The HUB search tool of your dreams!',
        children: [
          "See which of your department's classes fulfill your HUB",
          'See which courses fill your HUB gaps',
          'Search by AND and OR HUB requirements',
        ],
      },
      "Save Paw-Tential Courses to your list for later (and drag them into your plan when you're ready)",
      'Full-screen HUB tracker view',
      'HUB progress track compatible with first-year and transfer requirements',
      'Easily visualize your progress with progress rings per category, and how far your Paw-Tential Courses get you',
      'Of course, AP and IB count toward HUB',
      'Credit Tracking',
      'Quickly check major/minor requirements by accessing the bulletin!',
      'Coming Soon: GPA calculator',
      'Coming Soon: Major / Minor Requirement Tracking',
    ],
  },
  {
    id: 'schedule',
    title: 'Build your schedule',
    image: '/RhettCal.png',
    alt: 'Rhett the Boston terrier peeking out from a desk calendar with a red spiral-bound top',
    items: [
      'Schedule Builder, but it actually is good',
      'Filter by time ranges, professors, and sections',
      'Generate up to 2000 schedules',
      "Pin the sections you want, omit the sections you don't",
      'Conflicts flagged clearly, no guessing needed!',
      'Overlay all possible sections of a course/discussion on your schedule and pick the best fit',
      'Flag candidates schedules as you browse options',
      'Save your favorite schedules for later',
      'Design your schedule with customizable colors',
    ],
  },
];

function CheckMark() {
  return (
    <svg className="home-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThemeIcon({ theme }) {
  // Shows the mode you'd switch TO, matching the planner header toggle.
  return theme === 'dark' ? (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10 1.8v2.2M10 16v2.2M1.8 10H4M16 10h2.2M4.2 4.2l1.6 1.6M14.2 14.2l1.6 1.6M4.2 15.8l1.6-1.6M14.2 5.8l1.6-1.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M16.5 12.6A7 7 0 0 1 7.4 3.5a7 7 0 1 0 9.1 9.1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FeatureText({ text }) {
  if (text.startsWith(COMING_SOON_PREFIX)) {
    return (
      <>
        <span className="home-soon-badge">Coming soon</span>
        <span>{text.slice(COMING_SOON_PREFIX.length)}</span>
      </>
    );
  }
  return <span>{text}</span>;
}

function FeatureItem({ item }) {
  const text = typeof item === 'string' ? item : item.text;
  const isSoon = text.startsWith(COMING_SOON_PREFIX);
  return (
    <li className={`home-feature-item${isSoon ? ' is-soon' : ''}`}>
      <div className="home-feature-line">
        <CheckMark />
        <p><FeatureText text={text} /></p>
      </div>
      {item.children && (
        <ul className="home-feature-sublist">
          {item.children.map((child) => (
            <li key={child}>{child}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Shown to every visitor, in the hero and again in the closing section.
function AppButtons() {
  return (
    <div className="home-app-buttons">
      <Link to="/planner" className="home-btn home-btn-primary">Go to planner</Link>
      <Link to="/scheduler" className="home-btn home-btn-secondary">Go to scheduler</Link>
    </div>
  );
}

export default function HomePage({ theme = 'light', onToggleTheme }) {
  const { user, loading } = useAuth();
  const [showHelpModal, setShowHelpModal] = useState(false);

  // App waits on its own useAuth before rendering routes, but this hook
  // instance still starts at loading=true and only resolves a tick later
  // (onAuthStateChanged calls back asynchronously). Until then the
  // auth-dependent controls keep their space but stay invisible, so a
  // signed-in user never sees the guest links flash.
  const signedIn = Boolean(user);
  const authPending = loading ? { visibility: 'hidden' } : undefined;
  const pendingProps = loading ? { 'aria-hidden': true, tabIndex: -1 } : {};

  return (
    <div className="home-page">
      <header className={`home-topbar${signedIn ? ' is-signed-in' : ''}`}>
        <Link to="/" className="home-topbar-brand">
          <img src="/faviconred.png" alt="" width={22} height={22} />
          <span className="home-topbar-brand-text">Terrier Plan</span>
        </Link>
        <nav className="home-topbar-actions">
          {signedIn ? (
            <>
              <Link to="/planner" className="home-topbar-link">Planner</Link>
              <Link to="/scheduler" className="home-topbar-link">Scheduler</Link>
            </>
          ) : (
            <Link to="/login" className="home-topbar-link" style={authPending} {...pendingProps}>
              Sign in
            </Link>
          )}
          <button
            type="button"
            className="home-help-btn"
            onClick={() => setShowHelpModal(true)}
            aria-label="Help & feedback"
            title="Help & feedback"
          >
            ?
          </button>
          <button
            type="button"
            className="home-theme-toggle"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            <ThemeIcon theme={theme} />
          </button>
        </nav>
      </header>

      <main>
        <section className="home-hero">
          <img
            className="home-hero-logo"
            src={theme === 'dark' ? '/favicondark.png' : '/faviconlight.png'}
            alt=""
            width={88}
            height={88}
          />
          <h1 className="home-hero-title">Terrier Plan</h1>
          <p className="home-hero-tagline">
            An academic planning tool for BU students, built to replace your spreadsheet, bulletin, and MyBU juggling!
          </p>
          <AppButtons />
          {!signedIn && (
            <Link to="/login" className="home-signin-link" style={authPending} {...pendingProps}>
              Sign in with Google
            </Link>
          )}
        </section>

        {FEATURES.map((feature, index) => (
          <section
            key={feature.id}
            className={`home-feature${index % 2 === 1 ? ' is-flipped' : ''}`}
            aria-labelledby={`home-feature-${feature.id}`}
          >
            <div className="home-feature-inner">
              <div className="home-feature-art">
                <img
                  src={feature.image}
                  alt={feature.alt}
                  width={1080}
                  height={1080}
                  loading={index === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                />
              </div>
              <div className="home-feature-body">
                <h2 id={`home-feature-${feature.id}`} className="home-feature-title">
                  {feature.title}
                </h2>
                <ul className="home-feature-list">
                  {feature.items.map((item) => (
                    <FeatureItem key={typeof item === 'string' ? item : item.text} item={item} />
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ))}

        {/* Heading, intro and both contact actions copied from
            HelpSupportModal.jsx. */}
        <section className="home-closing" aria-labelledby="home-closing-title">
          <h2 id="home-closing-title" className="home-closing-title">Need a paw?</h2>
          <p className="home-closing-intro">
            TerrierPlan is built and maintained by a BUowo and friends, and we want this to be a tool that
            works for YOU. Tell us what's wrong, ask a question, make a suggestion, or just say hi!
          </p>
          <div className="home-closing-contact">
            <a className="home-contact-btn home-contact-email" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            <a
              className="home-contact-btn home-contact-discord"
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Join the Terrier Hub Discord
            </a>
          </div>
          <AppButtons />
        </section>
      </main>

      <HelpSupportModal open={showHelpModal} onClose={() => setShowHelpModal(false)} />
    </div>
  );
}
