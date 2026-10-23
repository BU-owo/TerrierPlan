// Run with: node --test src/utils/marineSemester.test.js (or npm test for all)
// Checks on the hand-curated lists in src/data/marineSemester.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import {
  ONLY,
  ALSO,
  RESEARCH,
  TWIN_GROUPS,
  fallOfferings,
  marineKind,
  isMarineResearch,
  twinGroup,
  marinePoolKeys,
  marinePool,
  fillsMarineSlot,
  withMarineCreditFallback,
} from '../data/marineSemester.js';

const ALL = [...ONLY, ...ALSO, ...RESEARCH];

test('every listed key exists in public/courses.json (missing ones are reported)', () => {
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/courses.json', import.meta.url)), 'utf8'));
  const ids = new Set(catalog.map((course) => course.id));
  const missing = [...new Set([...ALL, ...fallOfferings.keys])].filter((key) => !ids.has(key));
  assert.deepEqual(missing, [], `not in public/courses.json: ${missing.join(', ')}`);
});

test('no key is in two lists, and none is listed twice', () => {
  assert.equal(new Set(ALL).size, ALL.length, 'duplicate key');
  for (const key of ALL) {
    const lists = [ONLY, ALSO, RESEARCH].filter((list) => list.includes(key));
    assert.equal(lists.length, 1, `${key} is in ${lists.length} lists`);
  }
});

test('keys are bare courseKeys; inactive ES keys and the excluded courses are not listed', () => {
  for (const key of ALL) assert.match(key, /^[A-Z]+\d+$/, key);
  assert.ok(!ALL.some((key) => key.startsWith('CASES')), 'inactive ES-subject key');
  assert.ok(!ALL.includes('CASBI260'));
  assert.ok(!ALL.includes('CASMR501'));
});

test('twins are symmetrical: every twin is listed, in the same list, and groups do not overlap', () => {
  const seen = new Set();
  for (const group of TWIN_GROUPS) {
    assert.ok(group.length >= 2);
    const kinds = new Set(group.map((key) => marineKind(key)));
    assert.equal(kinds.size, 1, `${group.join('/')} disagree: ${[...kinds].join(',')}`);
    assert.notEqual([...kinds][0], null, `${group.join('/')} not listed`);
    const lists = new Set(group.map((key) => [ONLY, ALSO, RESEARCH].findIndex((list) => list.includes(key))));
    assert.equal(lists.size, 1, `${group.join('/')} split across ONLY/ALSO/RESEARCH`);
    for (const key of group) {
      assert.ok(!seen.has(key), `${key} in two twin groups`);
      seen.add(key);
      assert.deepEqual(twinGroup(key).sort(), [...group].sort());
    }
  }
});

test('marineKind: only | also | null, tolerant of spacing and case', () => {
  assert.equal(marineKind('CASBI511'), 'only');
  assert.equal(marineKind('CAS bi 511'), 'only');
  assert.equal(marineKind('CASEE557'), 'also');
  assert.equal(marineKind('CASMR391'), 'also');
  assert.equal(marineKind('CASBI260'), null);
  assert.equal(marineKind('CASMR501'), null);
  assert.equal(marineKind('CASCS111'), null);
  assert.equal(marineKind(undefined), null);
  assert.equal(marineKind(null), null);
  assert.equal(isMarineResearch('CASMR492'), true);
  assert.equal(isMarineResearch('CASMR500'), false);
});

test('twinGroup: the key itself for a course with no twin, [] for junk', () => {
  assert.deepEqual(twinGroup('CASBI511'), ['CASBI511']);
  assert.deepEqual(twinGroup('CASBI523').sort(), ['CASBI523', 'CASEE523']);
  assert.deepEqual(twinGroup('CASEE623').sort(), ['CASBI423', 'CASEE423', 'CASEE623']);
  assert.deepEqual(twinGroup(undefined), []);
});

test('the tracker pool is ONLY plus EE 557 and MR 500, not the Breadth courses', () => {
  const keys = marinePoolKeys();
  assert.deepEqual(keys, [...ONLY, 'CASEE557', 'CASMR500']);
  for (const key of ['CASBI423', 'CASEE423', 'CASEE623', 'CASMR391', 'CASBI260', 'CASMR501']) {
    assert.ok(!keys.includes(key), key);
  }
});

test('marinePool: twins are one OR_EQUIVALENT slot, so a pair counts once', () => {
  const pool = marinePool();
  const covered = pool.flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.options));
  assert.deepEqual([...covered].sort(), [...marinePoolKeys()].sort(), 'every pool key appears once');
  assert.equal(new Set(covered).size, covered.length);
  const pair = pool.find((entry) => entry.options?.includes('CASBI523'));
  assert.deepEqual(pair, { type: 'OR_EQUIVALENT', options: ['CASBI523', 'CASEE523'] });
  assert.ok(pool.includes('CASBI511'));
  assert.ok(pool.length < marinePoolKeys().length);
});

test('fillsMarineSlot: pool and research courses', () => {
  assert.equal(fillsMarineSlot('CASBI511'), true);
  assert.equal(fillsMarineSlot('CASMR500'), true);
  assert.equal(fillsMarineSlot('CASMR391'), true);
  assert.equal(fillsMarineSlot('CASBI423'), false);
  assert.equal(fillsMarineSlot('CASCS111'), false);
});

test('fallOfferings: listed keys only, no cancelled-only course, and matches Fall2026Courses.csv when present', () => {
  assert.equal(fallOfferings.year, 2026);
  for (const key of fallOfferings.keys) assert.ok(ALL.includes(key), `${key} not in a list`);
  assert.ok(!fallOfferings.keys.includes('CASBI521'), 'cancelled section');
  assert.equal(new Set(fallOfferings.keys).size, fallOfferings.keys.length);

  const csvPath = fileURLToPath(new URL('../../Fall2026Courses.csv', import.meta.url));
  if (!existsSync(csvPath)) return;
  const rows = parse(readFileSync(csvPath, 'utf8'), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true });
  const fromCsv = new Set(
    rows
      .filter((row) => /bump/i.test(row.Notes || '') && !/cancel/i.test(row['Class Stat'] || ''))
      .map((row) => `${row['Subject Area']}${row['Catalog Nbr']}`.replace(/\s+/g, '').toUpperCase()),
  );
  assert.deepEqual([...fromCsv].sort(), [...fallOfferings.keys].sort());
});

test('credits fallback: unknown pool/ALSO credits use the twin, else 4; known credits are never changed', () => {
  const out = withMarineCreditFallback({ CASBI593: 4, CASBI511: 3, CASEE542: 2, CASMR391: undefined, CASCS111: 4 });
  assert.equal(out.CASEE593, 4, 'twin BI 593 known');
  assert.equal(out.CASBI511, 3, 'known stays, even if odd');
  assert.equal(out.CASEE542, 2, 'known stays');
  assert.equal(out.CASBI569, 4, 'no twin, unknown: 4');
  assert.equal(out.CASEE557, 4, 'ALSO course');
  assert.equal(out.CASBI423, 4, 'ALSO course');
  assert.ok(!('CASMR391' in out) || out.CASMR391 === undefined, 'research is left alone');
  assert.equal(out.CASCS111, 4, 'other courses untouched');
  // A twin's credits win over the default.
  assert.equal(withMarineCreditFallback({ CASBI523: 3 }).CASEE523, 3);
  assert.equal(withMarineCreditFallback({ CASEE523: 3 }).CASBI523, 3);
  // null / 0 / non-numbers count as unknown.
  const odd = withMarineCreditFallback({ CASBI511: null, CASBI521: 0, CASBI531: '4' });
  assert.deepEqual([odd.CASBI511, odd.CASBI521, odd.CASBI531], [4, 4, 4]);
  // Does not mutate its input.
  const input = { CASBI593: 4 };
  withMarineCreditFallback(input);
  assert.deepEqual(input, { CASBI593: 4 });
  assert.deepEqual(withMarineCreditFallback(undefined).CASEE593, 4);
  assert.ok(!Object.values(out).some((v) => v === undefined && false));
});
