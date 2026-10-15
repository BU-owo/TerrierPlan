import { useEffect, useState } from 'react';
import { getCurrentTermCourseKeys, loadAllCoursesWhenRequested } from '../utils/courseQuery';

// courseKeys the static catalog marks `inCurrentTerm`, or null until the
// catalog has loaded. Waits for the catalog gate rather than starting the
// load itself, same as useInactiveCourseKeys.
export default function useCurrentTermCourseKeys() {
  const [keys, setKeys] = useState(getCurrentTermCourseKeys);

  useEffect(() => {
    if (keys) return undefined;
    let cancelled = false;
    loadAllCoursesWhenRequested()
      .then(() => {
        if (!cancelled) setKeys(getCurrentTermCourseKeys());
      })
      .catch(() => {}); // no catalog: no badge, no filter
    return () => {
      cancelled = true;
    };
  }, [keys]);

  return keys;
}
