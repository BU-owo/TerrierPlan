import { createContext } from 'react';

// Set of HUB unit codes the student still needs (see useHubProgress's
// neededHubCodes). PlannerPage provides it; null (no provider, or still
// loading) means every HUB chip renders bright, as before.
export const NeededHubContext = createContext(null);
