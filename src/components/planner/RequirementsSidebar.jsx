import RequirementTree from '../requirements/RequirementTree';

// Thin compact-density wrapper around the shared RequirementTree — see
// src/components/requirements/RequirementTree.jsx for the actual tree-walk
// rendering, pool/chip logic, and exception flow, which this and
// RequirementsFullView both render from the same source. `onOpenFullView`
// (passed down from PlannerPage via SidePanelTabs) surfaces a control next
// to the summary line to switch into the full-screen view.
export default function RequirementsSidebar(props) {
  return <RequirementTree density="compact" {...props} />;
}
