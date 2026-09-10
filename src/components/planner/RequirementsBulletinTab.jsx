import { findProgramByUrl } from '../../data/bu-programs';
import MajorPicker from './MajorPicker';

// Temporary stand-in for the full requirements tree/tracker
// (RequirementsSidebar -> RequirementTree density="compact") in the
// sidebar's Requirements tab — swapped in because requirements-engine
// coverage is still only ~2 of ~187 majors, so most students opening this
// tab just hit an unhelpful "not built for this major yet" empty state.
// Deliberately minimal: pick a major/minor, jump straight to its real
// bulletin page. No tree, no progress %, no exception flow, no iframe (a
// real BU bulletin page embedded at this panel's ~220px width would need
// horizontal scrolling inside the iframe itself, which is worse than just
// opening it). Swap RequirementsSidebar back into SidePanelTabs.jsx once
// coverage is broad enough to be worth showing by default again — nothing
// here was deleted, just no longer rendered from that tab.
export default function RequirementsBulletinTab({ majorBulletinUrl, onMajorSelect }) {
  const selectedProgram = findProgramByUrl(majorBulletinUrl);

  return (
    <div className="req-bulletin-tab">
      <p className="panel-summary-line">Pick your major or minor to jump to its bulletin page.</p>

      <MajorPicker
        idPrefix="requirements-bulletin"
        selectedProgramUrl={majorBulletinUrl || ''}
        onProgramSelect={onMajorSelect}
      />

      {selectedProgram ? (
        <a
          href={selectedProgram.url}
          target="_blank"
          rel="noreferrer"
          className="req-bulletin-open-btn"
        >
          Open {selectedProgram.name} bulletin ↗
        </a>
      ) : (
        <div className="panel-empty-state">
          <p>Pick a school above, then a major or minor.</p>
        </div>
      )}

      <p className="req-bulletin-note">
        Full requirements tracking (progress bars, course-by-course
        checklist) is temporarily simplified to just this bulletin
        link while more majors get structured — check the real bulletin
        for the actual requirements in the meantime.
      </p>
    </div>
  );
}
