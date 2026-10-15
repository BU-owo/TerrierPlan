import { useEffect, useState } from 'react';
import { getInactiveCourseKeys, loadAllCoursesWhenRequested } from '../utils/courseQuery';

const EMPTY = new Set();

// courseKeys the static catalog marks inactive (see isInactiveCourse), or an
// empty set until the catalog has loaded. Waits for the catalog gate rather
// than starting the load itself, same as useUpcomingSeasons.
export default function useInactiveCourseKeys() {
  const [keys, setKeys] = useState(getInactiveCourseKeys);

  useEffect(() => {
    if (keys) return undefined;
    let cancelled = false;
    loadAllCoursesWhenRequested()
      .then(() => {
        if (!cancelled) setKeys(getInactiveCourseKeys());
      })
      .catch(() => {}); // no catalog: nothing is hidden
    return () => {
      cancelled = true;
    };
  }, [keys]);

  return keys ?? EMPTY;
}
