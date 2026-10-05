import { CURRENT_TERM } from './term';
import { EMPTY_GLOBAL_FILTERS } from './sectionFilters';

// The Scheduler's in-progress work — draft courses (checked/locked sections),
// the time filter, the section sort mode, the bookmark shortlist, and the
// combination being previewed (with its stepper position) — saved to one
// localStorage key so a refresh doesn't lose it. Guests use the plain key; a
// signed-in user's draft lives under that key + their uid, so a shared
// computer never shows the previous person's draft. Everything derived is left out and rebuilt on load: the
// generated batch, fetched sections/course docs, and course colors
// (re-assigned from course order; manual picks have their own key).
//
// Never throws: a full or unavailable localStorage, or a corrupt value, just
// means nothing is saved/restored.
export const DRAFT_STORAGE_KEY = 'terrierplan_scheduler_draft';
export const DRAFT_STORAGE_VERSION = 1;

// uid null/undefined = guest.
function draftKey(uid) {
  return uid ? `${DRAFT_STORAGE_KEY}_${uid}` : DRAFT_STORAGE_KEY;
}

function strings(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

function sanitizeCourses(raw) {
  const seen = new Set();
  const courses = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c.courseKey !== 'string' || seen.has(c.courseKey)) continue;
    seen.add(c.courseKey);
    const considering = {};
    for (const [group, ids] of Object.entries(c.considering && typeof c.considering === 'object' ? c.considering : {})) {
      considering[group] = strings(ids);
    }
    courses.push({ courseKey: c.courseKey, considering, locked: strings(c.locked) });
  }
  return courses;
}

function sanitizeFilter(raw) {
  const ok = raw && typeof raw === 'object' && (raw.mode === 'same' || raw.mode === 'custom')
    && raw.global && typeof raw.global === 'object' && raw.perDay && typeof raw.perDay === 'object';
  return ok ? raw : EMPTY_GLOBAL_FILTERS;
}

// The stored state if it's for the current term and this version of the
// format; otherwise null (a different term's draft or an old format is
// discarded, not migrated). Section ids are NOT checked against the catalog
// here — that needs Firestore (see SchedulerPage's restore).
export function readStoredDraft(uid) {
  try {
    const raw = localStorage.getItem(draftKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== DRAFT_STORAGE_VERSION || parsed.term !== CURRENT_TERM) return null;
    const bookmarks = [];
    for (const ids of Array.isArray(parsed.bookmarks) ? parsed.bookmarks : []) {
      const list = strings(ids);
      if (list.length > 0) bookmarks.push(list);
    }
    return {
      courses: sanitizeCourses(parsed.draft?.courses),
      globalTimeFilter: sanitizeFilter(parsed.draft?.globalTimeFilter),
      sortMode: parsed.draft?.sortMode === 'section' ? 'section' : 'time',
      bookmarks, // string[][] — each a bookmarked combination's section ids
      // The combination on screen and its stepper position, or null.
      preview: strings(parsed.preview?.sectionIds).length > 0
        ? {
            sectionIds: strings(parsed.preview.sectionIds),
            index: Number.isInteger(parsed.preview.index) && parsed.preview.index >= 0 ? parsed.preview.index : null,
          }
        : null,
    };
  } catch (err) {
    console.warn('Could not read the saved scheduler draft:', err);
    return null;
  }
}

// Bookmarks are stored as plain id lists (their content key is recomputed on
// load). With nothing to keep — no courses and no bookmarks — the key is
// removed instead of storing an empty shell. Returns true when the write (or
// removal) went through, false when it didn't.
export function writeStoredDraft({ draftCourses, globalTimeFilter, sectionSortMode, bookmarks, previewSectionIds, previewIndex }, uid) {
  try {
    // Only a current-term combination is worth keeping (section ids start
    // with their term, "2271_1234"); a previewed other-term schedule isn't.
    const keepPreview = previewSectionIds.length > 0 && previewSectionIds.every((id) => id.startsWith(`${CURRENT_TERM}_`));
    if (draftCourses.length === 0 && bookmarks.size === 0 && !keepPreview) {
      localStorage.removeItem(draftKey(uid));
      return true;
    }
    localStorage.setItem(
      draftKey(uid),
      JSON.stringify({
        version: DRAFT_STORAGE_VERSION,
        term: CURRENT_TERM,
        savedAt: new Date().toISOString(),
        draft: { courses: draftCourses, globalTimeFilter, sortMode: sectionSortMode },
        bookmarks: Array.from(bookmarks.values()),
        preview: keepPreview ? { sectionIds: previewSectionIds, index: previewIndex } : null,
      }),
    );
    return true;
  } catch (err) {
    console.warn('Could not save the scheduler draft:', err);
    return false;
  }
}

export function clearStoredDraft(uid) {
  try {
    localStorage.removeItem(draftKey(uid));
  } catch (err) {
    console.warn('Could not clear the scheduler draft:', err);
  }
}
