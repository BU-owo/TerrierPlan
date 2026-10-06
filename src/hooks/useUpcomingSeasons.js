import { useEffect, useState } from 'react';
import { getUpcomingSeasonsIndex, loadAllCoursesWhenRequested } from '../utils/courseQuery';

// `upcomingSeasons` for a course from the cached static catalog, or undefined
// if the catalog hasn't loaded (or the course has none). Waits for the
// catalog gate rather than starting the load itself, so it never changes
// when the catalog downloads.
export default function useUpcomingSeasons(courseKey) {
  const [index, setIndex] = useState(getUpcomingSeasonsIndex);

  useEffect(() => {
    if (index) return undefined;
    let cancelled = false;
    loadAllCoursesWhenRequested()
      .then(() => {
        if (!cancelled) setIndex(getUpcomingSeasonsIndex());
      })
      .catch(() => {}); // no catalog: fall back to the offering pattern alone
    return () => {
      cancelled = true;
    };
  }, [index]);

  return courseKey ? index?.get(courseKey) : undefined;
}
