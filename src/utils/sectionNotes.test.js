// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSectionNotes } from './sectionNotes.js';

const plain = (parts) => parts.map((p) => p.text).join('');

test('QST SM 131 note, cut off mid-tag: text kept, URL becomes the link', () => {
  const notes = 'Students must also register for a G discussion section. If you are not able to register yourself for a Questrom course or section, please submit the <a href="https://questromworld.bu.edu/qro/waitlist/" target="blank';
  const parts = parseSectionNotes(notes);
  assert.equal(plain(parts).includes('<'), false);
  assert.equal(plain(parts).includes('target='), false);
  assert.ok(plain(parts).startsWith('Students must also register'));
  const links = parts.filter((p) => p.href);
  assert.deepEqual(links, [{ text: 'https://questromworld.bu.edu/qro/waitlist/', href: 'https://questromworld.bu.edu/qro/waitlist/' }]);
});

test('a complete anchor keeps its label; other tags are dropped with their text kept', () => {
  const parts = parseSectionNotes('See <b>the</b> <a href="https://example.edu/a?b=1&amp;c=2">course page</a>.');
  assert.deepEqual(parts, [
    { text: 'See the ' },
    { text: 'course page', href: 'https://example.edu/a?b=1&c=2' },
    { text: '.' },
  ]);
});

test('only http(s) URLs become links', () => {
  const parts = parseSectionNotes('<a href="javascript:alert(1)">click</a> and <a href="mailto:a@b.edu">mail</a> <a href="data:text/html,x">d</a>');
  assert.equal(parts.some((p) => p.href), false);
  assert.equal(plain(parts), 'click and mail d');
});

test('bare URLs are linked without trailing punctuation; entities decoded', () => {
  const parts = parseSectionNotes('Apply at https://www.bu.edu/x/y. Cost &lt; $5 &amp; more');
  assert.deepEqual(parts.filter((p) => p.href), [{ text: 'https://www.bu.edu/x/y', href: 'https://www.bu.edu/x/y' }]);
  assert.equal(plain(parts), 'Apply at https://www.bu.edu/x/y. Cost < $5 & more');
});

test('plain, empty and non-string notes', () => {
  assert.deepEqual(parseSectionNotes('Mts w/CAS CH204'), [{ text: 'Mts w/CAS CH204' }]);
  assert.deepEqual(parseSectionNotes(''), []);
  assert.deepEqual(parseSectionNotes(null), []);
  assert.deepEqual(parseSectionNotes(undefined), []);
  assert.equal(plain(parseSectionNotes('<script>alert(1)</script>hi <img src=x onerror=y>')), 'alert(1)hi');
});
