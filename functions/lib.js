// Pure pieces of reportIssue (no Firebase, no network), so they can be
// tested with `node --test` in this folder. index.js wires them up.
//
// Privacy: a report carries only what the client sends below (category,
// query, term filter, page path, app version, optional note). Nothing that
// identifies a person is read, stored, logged or forwarded.

export const CATEGORIES = {
  feedback: 'Feedback',
  missing_course: 'Missing course',
  wrong_info: 'Wrong info',
  bug: 'Bug',
};

// Max length of each string field, after trimming. Over the cap is rejected,
// not truncated (the client trims to these before sending).
export const CAPS = { query: 100, term: 40, page: 100, appVersion: 40, note: 300 };

export const WINDOW_MS = 10 * 60 * 1000;
export const GLOBAL_MAX = 20; // reports per WINDOW_MS, all users combined
export const INSTANCE_MAX = 20; // best-effort, per function instance

export class ReportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // an HttpsError code
  }
}

const bad = (message) => new ReportError('invalid-argument', message);

function optionalString(data, key) {
  const v = data[key];
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${key} must be a string`);
  const s = v.trim();
  if (s.length > CAPS[key]) throw bad(`${key} is too long`);
  return s;
}

// -> { category, query, term, page, appVersion, note }, or throws ReportError.
export function validateReport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('bad request');
  // Honeypot: a field real users never see. Anything in it means a bot.
  if (data.website !== undefined && data.website !== '') throw bad('bad request');
  if (!Object.hasOwn(CATEGORIES, data.category)) throw bad('unknown category');
  const report = {
    category: data.category,
    query: optionalString(data, 'query'),
    term: optionalString(data, 'term'),
    page: optionalString(data, 'page'),
    appVersion: optionalString(data, 'appVersion'),
    note: optionalString(data, 'note'),
  };
  if (report.category === 'missing_course' && !report.query) throw bad('query is required');
  return report;
}

// Breaks @everyone / @here and user/role/channel mentions so they render as
// plain text (allowed_mentions already stops pings; this is belt and braces).
export function defang(s) {
  return s
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/<(@[!&]?|#)(\d+)>/g, '<$1​$2>');
}

// Discord webhook body. Only the six report fields; no timestamp, no user.
export function buildDiscordPayload(r) {
  const field = (name, value) => ({ name, value: value ? defang(value) : '—', inline: name !== 'Note' });
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: CATEGORIES[r.category],
        color: r.category === 'bug' ? 0xcc0000 : r.category === 'wrong_info' ? 0xe0a000 : r.category === 'feedback' ? 0x2e9e5b : 0x5865f2,
        fields: [
          field('Category', CATEGORIES[r.category]),
          field('Query', r.query),
          field('Term filter', r.term),
          field('Page', r.page),
          field('App version', r.appVersion),
          field('Note', r.note),
        ],
      },
    ],
  };
}

// Fixed window on one counter doc. `doc` is the stored { windowStart, count }
// (or undefined). -> { allowed, next } where next is what to store.
export function nextWindow(doc, now, max = GLOBAL_MAX) {
  const fresh = !doc || typeof doc.windowStart !== 'number' || now - doc.windowStart >= WINDOW_MS || now < doc.windowStart;
  if (fresh) return { allowed: true, next: { windowStart: now, count: 1 } };
  const count = Number(doc.count) || 0;
  if (count >= max) return { allowed: false, next: null };
  return { allowed: true, next: { windowStart: doc.windowStart, count: count + 1 } };
}

// In-memory sliding window for one instance. Keeps only timestamps (no ids).
export function createInstanceLimiter(max = INSTANCE_MAX, windowMs = WINDOW_MS) {
  const hits = [];
  return (now) => {
    while (hits.length && now - hits[0] >= windowMs) hits.shift();
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}

export const TRY_LATER = 'Lots of reports right now. Try again in a few minutes.';
