// Sends a "report a problem" to the reportIssue Cloud Function (functions/),
// which posts it to our Discord. Works signed out.
//
// Called with plain fetch using the callable protocol instead of the
// Firebase SDK's httpsCallable on purpose: httpsCallable attaches the
// signed-in user's ID token, and reports must carry nothing that identifies
// anyone. Only the fields below are sent.
//
// VITE_FUNCTIONS_ORIGIN overrides the endpoint origin (e.g. the emulator,
// http://127.0.0.1:5001/<project>/us-central1); unset in production.

const REGION = 'us-central1';
const ORIGIN = import.meta.env.VITE_FUNCTIONS_ORIGIN
  || `https://${REGION}-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;

// Same caps as functions/lib.js; trimmed here so a long query still sends.
const CAPS = { query: 100, term: 40, page: 100, appVersion: 40, note: 300 };
const cap = (s, key) => String(s ?? '').trim().slice(0, CAPS[key]);

// Thrown on failure. `capped` is true when the server says to wait a bit.
export class ReportFailed extends Error {
  constructor(message, capped) {
    super(message);
    this.capped = capped;
  }
}

// { category, query?, term?, note?, website? } -> resolves on success.
// Page path and app version are filled in here.
export async function sendReport({ category, query, term, note, website = '' }) {
  const data = {
    category,
    query: cap(query, 'query'),
    term: cap(term, 'term'),
    page: cap(window.location.pathname, 'page'),
    appVersion: cap(import.meta.env.VITE_BUILD_ID || 'dev', 'appVersion'),
    note: cap(note, 'note'),
    website,
  };
  let res;
  try {
    res = await fetch(`${ORIGIN}/reportIssue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new ReportFailed('network', false);
  }
  const body = await res.json().catch(() => null);
  if (res.ok && body?.result?.ok) return;
  throw new ReportFailed(body?.error?.message || `status ${res.status}`, body?.error?.status === 'RESOURCE_EXHAUSTED');
}
