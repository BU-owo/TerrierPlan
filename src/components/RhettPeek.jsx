import './RhettPeek.css';

// Static Rhett for the "all done" banners (HubSidebar, RequirementTree's
// compact density). Cropped at the bottom of a fixed-height box so he reads
// as popping up from behind the banner text. Decorative: the banner text
// already says it.
export default function RhettPeek() {
  return (
    <div className="rhett-peek" aria-hidden="true">
      <img src="/RhettCelebrate-sm.png" alt="" width={140} height={140} loading="lazy" />
    </div>
  );
}
