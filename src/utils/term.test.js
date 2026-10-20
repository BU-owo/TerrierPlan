// Run with: node --test src/utils/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  termFromSlot, slotFromTerm, termForDate, termChronoValue, termLabel, normalizeStartTerm, mergeStartTerm,
  startTermOptions,
} from './term.js';
import { getTermStatus, isBeforeStartTerm, getSlotStatus, showsCurrentSemesterSelect } from './courseEntry.js';

const FALL_2024 = '2248';
const SPRING_2025 = '2251';
// Local-time dates (month is 0-based), the same way the app reads them.
const day = (y, m, d) => new Date(y, m - 1, d);

test('termFromSlot: Fall starter — even slots Fall, odd Spring, Summer after Spring', () => {
  assert.equal(termFromSlot(FALL_2024, 0), '2248');
  assert.equal(termFromSlot(FALL_2024, 1), '2251');
  assert.equal(termFromSlot(FALL_2024, 2), '2258');
  assert.equal(termFromSlot(FALL_2024, 7), '2281');
  assert.equal(termFromSlot(FALL_2024, 'summer:0'), '2255');
  assert.equal(termFromSlot(FALL_2024, 'summer:3'), '2285');
  assert.equal(termLabel(termFromSlot(FALL_2024, 3)), 'Spring 2026');
});

test('termFromSlot: Spring starter is Fall-anchored (slot 0 is the Fall before)', () => {
  assert.equal(termFromSlot(SPRING_2025, 0), '2248');
  assert.equal(termFromSlot(SPRING_2025, 1), '2251');
  assert.equal(termFromSlot(SPRING_2025, 'summer:0'), '2255');
});

test('termFromSlot: slots beyond the 8-slot grid still map', () => {
  assert.equal(termFromSlot(FALL_2024, 8), '2288');
  assert.equal(termFromSlot(FALL_2024, 15), '2321');
  assert.equal(termFromSlot(FALL_2024, 'summer:7'), '2325');
});

test('termFromSlot: invalid input → null', () => {
  assert.equal(termFromSlot(null, 0), null);
  assert.equal(termFromSlot('', 0), null);
  assert.equal(termFromSlot('2255', 0), null); // Summer is not a valid startTerm
  assert.equal(termFromSlot('Fall 2024', 0), null);
  assert.equal(termFromSlot(FALL_2024, -1), null);
  assert.equal(termFromSlot(FALL_2024, 1.5), null);
  assert.equal(termFromSlot(FALL_2024, 'summer:x'), null);
});

test('slotFromTerm: inverse of termFromSlot, including past the grid', () => {
  for (const start of [FALL_2024, SPRING_2025]) {
    for (let i = 0; i < 16; i++) assert.equal(slotFromTerm(start, termFromSlot(start, i)), i);
    for (let y = 0; y < 8; y++) assert.equal(slotFromTerm(start, termFromSlot(start, `summer:${y}`)), `summer:${y}`);
  }
  assert.equal(slotFromTerm(FALL_2024, '2328'), 16);
});

test('slotFromTerm: both Summer digits are the same Summer', () => {
  assert.equal(slotFromTerm(FALL_2024, '2255'), 'summer:0');
  assert.equal(slotFromTerm(FALL_2024, '2256'), 'summer:0');
});

test('slotFromTerm: before the anchor Fall or invalid → null', () => {
  assert.equal(slotFromTerm(FALL_2024, '2241'), null);
  assert.equal(slotFromTerm(FALL_2024, '2238'), null);
  assert.equal(slotFromTerm(SPRING_2025, '2248'), 0); // the Fall before is still slot 0
  assert.equal(slotFromTerm(FALL_2024, '2242'), null);
  assert.equal(slotFromTerm(null, '2248'), null);
});

test('termForDate: each month boundary', () => {
  assert.equal(termForDate(day(2026, 1, 1)), '2261');
  assert.equal(termForDate(day(2026, 5, 31)), '2261');
  assert.equal(termForDate(day(2026, 6, 1)), '2265');
  assert.equal(termForDate(day(2026, 8, 31)), '2265');
  assert.equal(termForDate(day(2026, 9, 1)), '2268');
  assert.equal(termForDate(day(2026, 12, 31)), '2268');
  assert.equal(termForDate(new Date('not a date')), null);
  assert.equal(termForDate(undefined), null);
});

test('termChronoValue: negative before the anchor', () => {
  assert.equal(termChronoValue(FALL_2024, '2248'), 0);
  assert.equal(termChronoValue(FALL_2024, '2241'), -2);
});

test('getTermStatus: Fall 2024 start, today 2026-10-20 → Year 3 Fall is current', () => {
  const today = day(2026, 10, 20);
  assert.equal(getTermStatus(0, FALL_2024, today), 'past');
  assert.equal(getTermStatus(3, FALL_2024, today), 'past');
  assert.equal(getTermStatus('summer:1', FALL_2024, today), 'past');
  assert.equal(getTermStatus(4, FALL_2024, today), 'current');
  assert.equal(getTermStatus(5, FALL_2024, today), 'upcoming');
  assert.equal(getTermStatus('summer:2', FALL_2024, today), 'upcoming');
  assert.equal(getTermStatus(7, FALL_2024, today), 'upcoming');
});

test('getTermStatus: Spring starter', () => {
  const today = day(2025, 2, 10);
  assert.equal(getTermStatus(0, SPRING_2025, today), 'past');
  assert.equal(getTermStatus(1, SPRING_2025, today), 'current');
  assert.equal(getTermStatus(2, SPRING_2025, today), 'upcoming');
  assert.equal(isBeforeStartTerm(0, SPRING_2025), true);
  assert.equal(isBeforeStartTerm(1, SPRING_2025), false);
  assert.equal(isBeforeStartTerm(0, FALL_2024), false);
  assert.equal(isBeforeStartTerm(0, null), false);
});

test('getTermStatus: Summer gap — no grid slot is current', () => {
  const today = day(2025, 7, 1);
  assert.equal(getTermStatus(1, FALL_2024, today), 'past');
  assert.equal(getTermStatus(2, FALL_2024, today), 'upcoming');
  assert.equal(getTermStatus('summer:0', FALL_2024, today), 'current');
  for (let i = 0; i < 8; i++) assert.notEqual(getTermStatus(i, FALL_2024, today), 'current');
});

test('getTermStatus: Jan 1 flips Fall to past', () => {
  assert.equal(getTermStatus(0, FALL_2024, day(2024, 12, 31)), 'current');
  assert.equal(getTermStatus(1, FALL_2024, day(2024, 12, 31)), 'upcoming');
  assert.equal(getTermStatus(0, FALL_2024, day(2025, 1, 1)), 'past');
  assert.equal(getTermStatus(1, FALL_2024, day(2025, 1, 1)), 'current');
});

test('getTermStatus: slots beyond the grid', () => {
  const today = day(2026, 10, 20);
  assert.equal(getTermStatus(12, FALL_2024, today), 'upcoming');
  assert.equal(getTermStatus(12, FALL_2024, day(2031, 1, 15)), 'past');
  assert.equal(getTermStatus(13, FALL_2024, day(2031, 1, 15)), 'current');
});

test('getTermStatus: before the anchor everything is upcoming', () => {
  assert.equal(getTermStatus(0, FALL_2024, day(2024, 3, 1)), 'upcoming');
});

test('getTermStatus: unset/invalid startTerm → null (caller falls back)', () => {
  assert.equal(getTermStatus(0, null, day(2026, 10, 20)), null);
  assert.equal(getTermStatus(0, '2255', day(2026, 10, 20)), null);
  assert.equal(getTermStatus(0, FALL_2024, null), null);
});

test('normalizeStartTerm: only Fall/Spring term-code strings survive', () => {
  assert.equal(normalizeStartTerm('2248'), '2248');
  assert.equal(normalizeStartTerm('2251'), '2251');
  assert.equal(normalizeStartTerm('2255'), null);
  assert.equal(normalizeStartTerm('2256'), null);
  assert.equal(normalizeStartTerm(2248), null);
  assert.equal(normalizeStartTerm('Fall 2024'), null);
  assert.equal(normalizeStartTerm(''), null);
  assert.equal(normalizeStartTerm(null), null);
  assert.equal(normalizeStartTerm(undefined), null);
  assert.equal(normalizeStartTerm({ year: 2024, season: 'fall' }), null);
});

test('mergeStartTerm: account wins, guest fills in, invalid is ignored', () => {
  assert.equal(mergeStartTerm('2248', '2251'), '2248');
  assert.equal(mergeStartTerm(undefined, '2251'), '2251');
  assert.equal(mergeStartTerm(null, '2251'), '2251');
  assert.equal(mergeStartTerm('garbage', '2251'), '2251');
  assert.equal(mergeStartTerm('2248', undefined), '2248');
  assert.equal(mergeStartTerm('2248', null), '2248');
  assert.equal(mergeStartTerm(undefined, undefined), null);
  assert.equal(mergeStartTerm(undefined, '2255'), null);
});

test('getSlotStatus: startTerm set → derived from today, ignoring currentSemesterTarget', () => {
  const ctx = { startTerm: FALL_2024, currentSemesterTarget: 0, today: day(2026, 10, 20) };
  assert.equal(getSlotStatus(3, ctx), 'past');
  assert.equal(getSlotStatus(4, ctx), 'current');
  assert.equal(getSlotStatus('summer:2', ctx), 'upcoming');
});

test('getSlotStatus: startTerm null/cleared/invalid → falls back to currentSemesterTarget', () => {
  for (const startTerm of [null, undefined, '', '2255']) {
    const ctx = { startTerm, currentSemesterTarget: 2, today: day(2026, 10, 20) };
    assert.equal(getSlotStatus(1, ctx), 'past');
    assert.equal(getSlotStatus(2, ctx), 'current');
    assert.equal(getSlotStatus(4, ctx), 'upcoming');
  }
  assert.equal(getSlotStatus(0, { startTerm: null, currentSemesterTarget: null, today: day(2026, 10, 20) }), null);
});

test('startTermOptions: newest first, 7 academic years back through the next Spring', () => {
  const fall = startTermOptions(day(2026, 10, 20));
  assert.equal(fall[0], '2271'); // Spring 2027
  assert.equal(fall[1], '2268'); // Fall 2026
  assert.equal(fall.at(-1), '2198'); // Fall 2019
  assert.equal(fall.length, 16);
  assert.ok(fall.every((code) => normalizeStartTerm(code) === code));
  // In Spring/Summer the coming Fall is offered (incoming students).
  const spring = startTermOptions(day(2026, 2, 1));
  assert.equal(spring[0], '2271');
  assert.equal(spring[1], '2268');
  assert.equal(spring.at(-1), '2188'); // Fall 2018
  assert.equal(startTermOptions(day(2026, 7, 1))[0], '2271');
  assert.deepEqual(startTermOptions(null), []);
});

test('showsCurrentSemesterSelect: only with no start term and a picked current semester', () => {
  assert.equal(showsCurrentSemesterSelect(null, 2), true);
  assert.equal(showsCurrentSemesterSelect('', 'summer:1'), true); // cleared start term
  assert.equal(showsCurrentSemesterSelect(null, 0), true);
  assert.equal(showsCurrentSemesterSelect(null, null), false);
  assert.equal(showsCurrentSemesterSelect('', undefined), false);
  assert.equal(showsCurrentSemesterSelect(FALL_2024, 2), false);
  assert.equal(showsCurrentSemesterSelect(FALL_2024, null), false);
});
