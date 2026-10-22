// Whether one chunk of a course-doc lookup came back short because of the
// network, not because the courses don't exist. Firestore's getDocs doesn't
// throw while offline: it answers from its (often empty) cache. So a short
// answer only means "couldn't reach the server" when it was served from the
// cache or the browser says it's offline. A short answer from the server
// means those courses really aren't there (retired or unknown keys).
//   requested  distinct keys asked for in this chunk
//   received   docs that came back
//   fromCache  snapshot.metadata.fromCache
//   online     navigator.onLine
export function isNetworkShortBatch({ requested, received, fromCache, online }) {
  if (!(requested > 0) || received >= requested) return false;
  return fromCache === true || online === false;
}
