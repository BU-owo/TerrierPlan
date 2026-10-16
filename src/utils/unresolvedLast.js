// Display order for a node's children in the requirements tracker: every
// non-UNRESOLVED child first, then every UNRESOLVED ("Check with advisor")
// child, each group in its existing (JSON) order. A stable partition that
// returns a new array and never mutates its input — the evaluated tree,
// claim order and totals stay in JSON order; only what is rendered moves.
export function unresolvedLast(children) {
  if (!Array.isArray(children)) return children;
  return [
    ...children.filter((child) => child.type !== 'UNRESOLVED'),
    ...children.filter((child) => child.type === 'UNRESOLVED'),
  ];
}
