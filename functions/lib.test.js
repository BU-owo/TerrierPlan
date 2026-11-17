import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReport, buildDiscordPayload, defang, nextWindow, createInstanceLimiter, WINDOW_MS, GLOBAL_MAX } from './lib.js';

const ok = { category: 'missing_course', query: 'CAS XX 123', term: 'Spring 2027 (all courses)', page: '/planner', appVersion: 'abc1234' };

test('accepts a good report and trims fields', () => {
  assert.deepEqual(validateReport({ ...ok, note: '  hi  ', website: '' }), { ...ok, note: 'hi' });
});

test('rejects honeypot, bad category, wrong types and over-cap fields', () => {
  assert.throws(() => validateReport({ ...ok, website: 'x' }), { code: 'invalid-argument' });
  assert.throws(() => validateReport({ ...ok, category: 'spam' }), { code: 'invalid-argument' });
  assert.throws(() => validateReport({ ...ok, category: 'toString' }), { code: 'invalid-argument' });
  assert.throws(() => validateReport({ ...ok, note: 5 }), { code: 'invalid-argument' });
  assert.throws(() => validateReport({ ...ok, note: 'x'.repeat(301) }), { code: 'invalid-argument' });
  assert.throws(() => validateReport({ ...ok, query: 'x'.repeat(101) }), { code: 'invalid-argument' });
  assert.throws(() => validateReport({ ...ok, page: 'x'.repeat(101) }), { code: 'invalid-argument' });
  assert.throws(() => validateReport(null), { code: 'invalid-argument' });
  assert.throws(() => validateReport([]), { code: 'invalid-argument' });
});

test('missing_course needs a query; other categories do not', () => {
  assert.throws(() => validateReport({ category: 'missing_course' }), { code: 'invalid-argument' });
  assert.equal(validateReport({ category: 'bug', note: 'x'.repeat(300) }).note.length, 300);
  assert.equal(validateReport({ category: 'feedback', note: 'love it' }).category, 'feedback');
});

test('feedback embed is titled Feedback', () => {
  assert.equal(buildDiscordPayload(validateReport({ category: 'feedback' })).embeds[0].title, 'Feedback');
});

test('ignores fields it does not know about', () => {
  const r = validateReport({ ...ok, email: 'a@b.c', uid: 'u1' });
  assert.equal('email' in r || 'uid' in r, false);
});

test('defang breaks mass and direct mentions', () => {
  assert.equal(defang('@everyone @HERE'), '@​everyone @​HERE');
  assert.equal(defang('<@123> <@!4> <@&5> <#6>'), '<@​123> <@!​4> <@&​5> <#​6>');
});

test('payload has no pings and only the six fields', () => {
  const p = buildDiscordPayload(validateReport({ ...ok, note: 'hey @everyone' }));
  assert.deepEqual(p.allowed_mentions, { parse: [] });
  assert.deepEqual(p.embeds[0].fields.map((f) => f.name), ['Category', 'Query', 'Term filter', 'Page', 'App version', 'Note']);
  assert.equal(p.embeds[0].fields[5].value, 'hey @​everyone');
  assert.equal(p.content, undefined);
  assert.equal(p.embeds[0].timestamp, undefined);
});

test('global window: caps at GLOBAL_MAX, then resets after the window', () => {
  let doc;
  for (let i = 0; i < GLOBAL_MAX; i++) {
    const r = nextWindow(doc, 1000 + i);
    assert.equal(r.allowed, true);
    doc = r.next;
  }
  assert.equal(nextWindow(doc, 2000).allowed, false);
  assert.deepEqual(nextWindow(doc, 1000 + WINDOW_MS).next, { windowStart: 1000 + WINDOW_MS, count: 1 });
});

test('instance limiter slides', () => {
  const allow = createInstanceLimiter(2, 100);
  assert.equal(allow(0), true);
  assert.equal(allow(10), true);
  assert.equal(allow(20), false);
  assert.equal(allow(100), true);
});
