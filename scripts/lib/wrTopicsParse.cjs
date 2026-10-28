// Pure helpers for scripts/build-wr-topics.cjs (no I/O), so the tests can load them.
'use strict';

const ALIASES = {
  'dickinson, bishop, plath': 'dickinson, bishop, and plath',
};

const CLASS_RE = 'WR (?:120|151|152|153)';
// A row ends on "<TAB>Instructor<TAB>WR 1xx", or on a line that is just "Instructor<TAB>WR 1xx".
const END_TAB_RE = new RegExp(`\\t([^\\t]+)\\t(${CLASS_RE})\\s*$`);
const END_LINE_RE = new RegExp(`^\\s*([^\\t]+)\\t(${CLASS_RE})\\s*$`);

const HEADINGS = [
  /^WR 120 Topics \(Spring 2027\)\s*$/,
  /^WR 151, WR 152, and WR 153 Topics \(Spring 2027\)\s*$/,
];

function squish(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

// Lowercase, curly to straight quotes, en/em dash to hyphen, collapse whitespace,
// strip trailing punctuation. Used on both the CSV and the page titles.
function normalizeTitle(s) {
  const t = squish(
    String(s ?? '')
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-'),
  ).replace(/[\s.,;:!?'"-]+$/, '');
  return ALIASES[t] || t;
}

function cleanDescription(s) {
  return squish(s).replace(/^n some ways\b/, 'In some ways');
}

// "Barents, B" -> { last: 'barents', initial: 'b' }; "Tall" -> { last: 'tall', initial: '' }.
function parseInstructor(s) {
  const [last, init = ''] = String(s ?? '').split(',');
  return { last: normalizeTitle(last), initial: squish(init).toLowerCase().replace(/\./g, '') };
}

function parseTopicTables(text) {
  const lines = String(text).split(/\r?\n/);
  const rows = [];
  let tableClassGroup = null;
  let buf = [];
  for (const line of lines) {
    const h = HEADINGS.findIndex((re) => re.test(line));
    if (h !== -1) {
      tableClassGroup = h === 0 ? '120' : '151-153';
      buf = [];
      continue;
    }
    if (!tableClassGroup) continue;
    if (/^Topic Title\tTopic Description\t/.test(line)) continue;

    let m = line.match(END_TAB_RE);
    let body;
    if (m) {
      body = [...buf, line.slice(0, m.index)];
    } else if ((m = line.match(END_LINE_RE))) {
      body = buf;
    } else {
      buf.push(line);
      continue;
    }
    buf = [];
    const joined = body.join(' ');
    const tab = joined.indexOf('\t');
    if (tab === -1) continue;
    rows.push({
      title: squish(joined.slice(0, tab)),
      description: cleanDescription(joined.slice(tab + 1)),
      instructor: squish(m[1]),
      wr: m[2],
      key: normalizeTitle(joined.slice(0, tab)),
    });
  }
  return rows;
}

// Page row for (title, instructor surname): same title + surname (+ initial when the CSV
// gives one), else title only. Returns { row, how } or null.
function lookupRow(rows, title, instructorLast) {
  const key = normalizeTitle(title);
  const sameTitle = rows.filter((r) => r.key === key);
  if (!sameTitle.length) return null;
  const want = parseInstructor(instructorLast);
  if (want.last) {
    const hits = sameTitle.filter((r) => {
      const got = parseInstructor(r.instructor);
      return got.last === want.last && (!want.initial || got.initial === want.initial);
    });
    if (hits.length) return { row: hits[0], how: hits.length > 1 ? 'instructor (ambiguous)' : 'instructor' };
  }
  return { row: sameTitle[0], how: 'title' };
}

module.exports = { normalizeTitle, cleanDescription, parseInstructor, parseTopicTables, lookupRow };
