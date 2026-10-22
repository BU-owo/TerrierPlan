import { createContext } from 'react';

// HUB unit codes the student still needs (see useHubProgress's
// neededHubCodes), as { completed, planned, potential, stashOnly } Sets:
// needed with completed courses only, with the whole plan, with the plan
// plus the Paw-tential stash, and with the stash alone. PlannerPage
// provides it; null (no provider, or still loading) means every HUB chip
// renders plain, as before.
export const NeededHubContext = createContext(null);
