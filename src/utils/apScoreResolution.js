import { getApHub } from '../data/apIbHubCredit';

export function normalizeApScore(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) return null;
  return parsed;
}

export function resolveApHubFromScore(testSubject, scoreValue) {
  const score = normalizeApScore(scoreValue);
  if (score == null) {
    return { score: null, hubUnits: null };
  }
  return {
    score,
    hubUnits: getApHub(testSubject, score),
  };
}

export function isKnownApExam(testSubject) {
  for (let score = 1; score <= 5; score += 1) {
    if (Array.isArray(getApHub(testSubject, score))) return true;
  }
  return Array.isArray(getApHub(testSubject, null));
}

export function isKnownScoreDependentAp(testSubject) {
  return getApHub(testSubject, null) === null && isKnownApExam(testSubject);
}
