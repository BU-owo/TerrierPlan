// Run with: node --test scripts/lib/wrTopicsParse.test.js (or npm test for all)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('./wrTopicsParse.cjs');

test('normalizeTitle: case, quotes, dashes, whitespace, trailing punctuation', () => {
  assert.equal(P.normalizeTitle('  Boston’s  Public Art Now. '), "boston's public art now");
  assert.equal(P.normalizeTitle('Who Owns the Past Now?'), 'who owns the past now');
  assert.equal(P.normalizeTitle('1968–1969: Hope — Horror'), '1968-1969: hope - horror');
  assert.equal(P.normalizeTitle('“Gender” Now'), '"gender" now');
});

test('normalizeTitle: Dickinson alias', () => {
  assert.equal(P.normalizeTitle('Dickinson, Bishop, Plath'), 'dickinson, bishop, and plath');
  assert.equal(P.normalizeTitle('Dickinson, Bishop, and Plath'), 'dickinson, bishop, and plath');
});

test('cleanDescription: collapses whitespace and fixes "n some ways"', () => {
  assert.equal(P.cleanDescription('Line one\n\n  line   two\n'), 'Line one line two');
  assert.equal(P.cleanDescription('n some ways, we write.'), 'In some ways, we write.');
  assert.equal(P.cleanDescription('In some ways, fine.'), 'In some ways, fine.');
});

const PAGE = [
  'nav junk',
  'WR 120 Topics (Spring 2027)',
  'Topic Title\tTopic Description\tInstructor\tClass',
  'Boston Sports Now\tWhy sports?\tWhite\tWR 120',
  'WR 151, WR 152, and WR 153 Topics (Spring 2027)',
  'Topic Title\tTopic Description\tInstructor\tClass',
  'The Theater Now\tTheater for Barents.\tBarents, K\tWR 153',
  'The Theater Now\tTheater for Tall.\tTall\tWR 153',
  'Film Odysseys\tHomer on film.\tBarents, K\tWR 153',
  'How We Write\tBarents B desc.\tBarents, B\tWR 153',
  'Multispecies Minds Now\tJoin us on adventures.',
  'non-human animals have',
  '',
  'pitch ideas.',
  '',
  'Schaaf\tWR 153',
  'Second Wave Feminism to Now\tSIS boilerplate\tKent\tWR 152',
  'Related to WR Course Catalog',
  'Contact Us',
].join('\n');

test('parseTopicTables: tables only, header and footer skipped', () => {
  const rows = P.parseTopicTables(PAGE);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[0], {
    title: 'Boston Sports Now', description: 'Why sports?', instructor: 'White', wr: 'WR 120', key: 'boston sports now',
  });
});

test('parseTopicTables: row ending on a whole "Instructor<TAB>WR 153" line', () => {
  const row = P.parseTopicTables(PAGE).find((r) => r.title === 'Multispecies Minds Now');
  assert.equal(row.instructor, 'Schaaf');
  assert.equal(row.wr, 'WR 153');
  assert.equal(row.description, 'Join us on adventures. non-human animals have pitch ideas.');
});

test('lookupRow: (title, instructor) first, then title only', () => {
  const rows = P.parseTopicTables(PAGE);
  assert.equal(P.lookupRow(rows, 'The Theater Now', 'Tall').row.description, 'Theater for Tall.');
  assert.equal(P.lookupRow(rows, 'The Theater Now', 'Barents').row.description, 'Theater for Barents.');
  assert.equal(P.lookupRow(rows, 'The Theater Now', 'Nobody').how, 'title');
  assert.equal(P.lookupRow(rows, 'Boston Sports Now', '').row.instructor, 'White');
  assert.equal(P.lookupRow(rows, 'No Such Topic', 'Tall'), null);
});

test('lookupRow: Barents B vs K by initial, surname alone matches by title', () => {
  const rows = P.parseTopicTables(PAGE);
  assert.equal(P.lookupRow(rows, 'How We Write', 'Barents, B').row.description, 'Barents B desc.');
  assert.equal(P.lookupRow(rows, 'Film Odysseys', 'Barents, B').how, 'title');
  assert.equal(P.lookupRow(rows, 'Film Odysseys', 'Barents').how, 'instructor');
});
