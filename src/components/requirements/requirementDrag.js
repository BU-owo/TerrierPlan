import { createContext } from 'react';

// True only for the sidebar (compact) requirements tree on desktop: there,
// selectable course rows can be dragged onto semester columns (same payload
// as a search result — see RequirementCourseRow and PlannerPage's
// handleDragEnd). False in the full view and on mobile.
export const RequirementDragContext = createContext(false);
