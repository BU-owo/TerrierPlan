// Cloud Functions for TerrierPlan. Deploy steps are in the README.
//
// reportIssue: callable, works for guests. Posts a short report to a Discord
// channel through a webhook whose URL lives only in Secret Manager
// (DISCORD_WEBHOOK_URL). It never reads request.auth or request.rawRequest
// and never logs report contents, so nothing that identifies a person is
// stored. (Cloud Run's own platform request logs are separate; see README.)

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { validateReport, buildDiscordPayload, nextWindow, createInstanceLimiter, ReportError, TRY_LATER } from './lib.js';

const DISCORD_WEBHOOK_URL = defineSecret('DISCORD_WEBHOOK_URL');

initializeApp();
const db = getFirestore();
// The one global counter doc. Admin SDK only; clients can't read or write it.
const counterRef = db.doc('rateLimits/reportIssue');
const instanceAllows = createInstanceLimiter();

async function takeGlobalSlot() {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const { allowed, next } = nextWindow(snap.exists ? snap.data() : undefined, Date.now());
    if (allowed) tx.set(counterRef, next);
    return allowed;
  });
}

export const reportIssue = onCall(
  { secrets: [DISCORD_WEBHOOK_URL], maxInstances: 2, timeoutSeconds: 15, memory: '256MiB' },
  async (request) => {
    let report;
    try {
      report = validateReport(request.data);
    } catch (err) {
      if (err instanceof ReportError) throw new HttpsError(err.code, err.message);
      throw err;
    }

    if (!instanceAllows(Date.now())) throw new HttpsError('resource-exhausted', TRY_LATER);
    if (!(await takeGlobalSlot())) throw new HttpsError('resource-exhausted', TRY_LATER);

    let res;
    try {
      res = await fetch(DISCORD_WEBHOOK_URL.value(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDiscordPayload(report)),
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      logger.error('reportIssue: webhook request failed', { name: err?.name });
      throw new HttpsError('unavailable', 'Could not send the report.');
    }
    if (!res.ok) {
      logger.error('reportIssue: webhook returned an error', { status: res.status });
      throw new HttpsError(res.status === 429 ? 'resource-exhausted' : 'unavailable', res.status === 429 ? TRY_LATER : 'Could not send the report.');
    }
    return { ok: true };
  },
);
