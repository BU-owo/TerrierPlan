// Auto-discovers every program file under src/data/requirements/** so new
// majors just need a JSON file dropped in — no registry to hand-maintain.
const requirementModules = import.meta.glob('../../data/requirements/**/*.json', { eager: true });

export const REQUIREMENT_PROGRAMS = Object.values(requirementModules).map((mod) => mod.default ?? mod);
