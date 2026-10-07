// BU's section `notes` can carry raw HTML (e.g. `submit the <a href="https://…"
// target="blank">`), sometimes cut off mid-tag. This turns one into plain text
// parts — { text } or { text, href } — so it can be rendered without ever
// putting the raw string in as HTML. Every tag is dropped but its visible text
// is kept, and only http(s) URLs become links (`href`).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (dec || hex) {
      const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

// Tags removed, including a final one that was cut off before its `>`.
function stripTags(text) {
  return text.replace(/<[^>]*>/g, '').replace(/<[^>]*$/, '');
}

function httpUrl(value) {
  try {
    const url = new URL(decodeEntities(value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// Plain text with any bare http(s) URLs split out as links.
function linkifyText(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"]+/gi)) {
    const raw = match[0].replace(/[.,;:!?)\]]+$/, '');
    const href = httpUrl(raw);
    if (!href) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: raw, href });
    last = match.index + raw.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// An <a href=…>label</a>, or one cut off after its href (no `>` or no label):
// the label falls back to the URL itself.
const ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*(?:>|$)([\s\S]*?)(?:<\/a\s*>|$)/gi;

export function parseSectionNotes(notes) {
  if (typeof notes !== 'string' || !notes.trim()) return [];
  const parts = [];
  const pushText = (raw) => {
    const text = decodeEntities(stripTags(raw));
    if (text) parts.push(...linkifyText(text));
  };
  let last = 0;
  for (const match of notes.matchAll(ANCHOR)) {
    pushText(notes.slice(last, match.index));
    const href = httpUrl(match[1] ?? match[2] ?? match[3] ?? '');
    const label = decodeEntities(stripTags(match[4] || '')).trim();
    if (href) parts.push({ text: label || href, href });
    else if (label) parts.push({ text: label });
    last = match.index + match[0].length;
  }
  pushText(notes.slice(last));
  // Merge neighbouring plain-text pieces and trim the ends.
  const merged = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.href && !part.href) prev.text += part.text;
    else merged.push({ ...part });
  }
  if (merged[0] && !merged[0].href) merged[0].text = merged[0].text.trimStart();
  const end = merged[merged.length - 1];
  if (end && !end.href) end.text = end.text.trimEnd();
  return merged.filter((p) => p.text);
}
