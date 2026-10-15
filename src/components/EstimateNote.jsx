// Small muted "planning only" line for the planner's HUB and Credits panels.
// `link` is an entry from BU_LINKS; `lead` / `label` override the default
// wording ("lead" + linked "label" + "."); `prominent` bumps size and color
// for the full-screen views. Without a `link`, it's just "lead.".
export default function EstimateNote({
  link,
  lead = 'Estimates only. Confirm with',
  label = 'BU',
  prominent = false,
}) {
  return (
    <p className={`estimate-note${prominent ? ' is-prominent' : ''}`}>
      {link ? (
        <>
          {lead}{' '}
          <a href={link.url} target="_blank" rel="noopener noreferrer">{label}</a>.
        </>
      ) : (
        <>{lead}.</>
      )}
    </p>
  );
}
