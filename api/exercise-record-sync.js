// Vercel serverless endpoint. Narrow, single-purpose: accepts a signed Keep
// exercise screenshot snapshot from Cyberboss and (1) overwrites the full
// fact-layer record at users/{uid}/exerciseRecords/{date}, and (2) projects
// only two autoValue fields into that date's dailyReviewDraft — never an
// arbitrary Firestore path or fieldId supplied by the caller. See
// src/server/exerciseRecordSyncCore.js for the fully unit-tested pure logic
// this handler wires up to a real Firestore transaction. Modeled directly on
// api/focus-review-sync.js, which is the existing precedent for "external
// fact source -> autoValue projection" in this app.
//
// Auth: HMAC-SHA256 over `${x-catkeeper-timestamp}.${rawBody}`, using
// CATKEEPER_EXERCISE_SYNC_SECRET (falling back to CATKEEPER_FOCUS_SYNC_SECRET
// so an existing deployment needs no second secret provisioned — same
// convention as the reward-shop endpoint), verified with a timing-safe
// compare, with a +/-5min timestamp window. The target user's uid comes ONLY
// from CATKEEPER_USER_UID (server env) — never from the request body.
//
// Idempotency / same-day update semantics: Keep's page is always "today so
// far, in full" — a second screenshot for the same date REPLACES
// summary+sessions, it never adds to them. A byte-identical screenshot is a
// true record/projection no-op, but still gets the cheap Tracker self-heal
// check so a newly-deployed repair version can materialize old facts.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  verifyHmacSignature,
  isTimestampFresh,
  validateExercisePayload,
  buildExerciseFieldPatch,
  applyExerciseFieldUpdates,
  isSameSnapshot,
  isProjectionMaterialized,
} from "../src/server/exerciseRecordSyncCore.js";
import { reconcileTrackerSourcesAdmin } from "../src/server/trackerSourceReconcileAdmin.js";

// Vercel auto-parses JSON bodies by default — HMAC verification needs the
// exact raw bytes that were signed, not a re-serialized copy, so parsing
// must be disabled here (same reason as focus-review-sync.js).
export const config = { api: { bodyParser: false } };

let firestoreSingleton = null;
function getDb() {
  if (firestoreSingleton) return firestoreSingleton;
  if (!getApps().length) {
    const raw = process.env.CATKEEPER_FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("CATKEEPER_FIREBASE_SERVICE_ACCOUNT is not configured");
    const serviceAccount = JSON.parse(raw);
    initializeApp({ credential: cert(serviceAccount) });
  }
  firestoreSingleton = getFirestore();
  return firestoreSingleton;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Core transaction + canonical server-side Tracker reconcile.
 */
export async function handleExerciseRecordSyncRequest({ db, uid, normalized, body = {}, now = new Date() } = {}) {
  const recordRef = db.collection("users").doc(uid).collection("exerciseRecords").doc(normalized.date);
  const draftRef = db.collection("users").doc(uid).collection("dailyReviewDrafts").doc(normalized.date);
  const jobId = `exerciseRecord:${normalized.date}`;
  const jobDocRef = db.collection("users").doc(uid).collection("trackerReconcileJobs").doc(jobId);

  const result = await db.runTransaction(async (transaction) => {
    const [recordSnap, draftSnap, jobSnap] = await Promise.all([
      transaction.get(recordRef),
      transaction.get(draftRef),
      transaction.get(jobDocRef),
    ]);
    const existingRecord = recordSnap.exists ? recordSnap.data() : null;
    const currentFields = draftSnap.exists ? draftSnap.data()?.fields || {} : {};
    const { fieldUpdates, exerciseSync } = buildExerciseFieldPatch(normalized);

    const sameSnapshot = isSameSnapshot(existingRecord, normalized.source.sourceSnapshotHash);
    const materialized = sameSnapshot && isProjectionMaterialized(currentFields, fieldUpdates);
    if (materialized) {
      return { status: "noop", reason: "identical screenshot already synced", sessionCount: normalized.summary.sessionCount };
    }

    const nowIso = now.toISOString();
    transaction.set(recordRef, {
      schemaVersion: normalized.schemaVersion,
      date: normalized.date,
      timezone: normalized.timezone,
      summary: normalized.summary,
      sessions: normalized.sessions,
      source: { ...normalized.source, extractedAt: body?.source?.extractedAt || "", receivedAt: nowIso },
      createdAt: existingRecord?.createdAt || nowIso,
      updatedAt: nowIso,
    });

    const nextFields = applyExerciseFieldUpdates(currentFields, fieldUpdates);
    transaction.set(draftRef, { fields: nextFields, exerciseSync }, { merge: true });

    // Durable fallback job. The server-side reconcile below is now the normal
    // path, but keeping the job makes a transient server failure retryable by
    // the existing client sweep instead of losing the source update.
    transaction.set(jobDocRef, {
      id: jobId,
      type: "exerciseRecord",
      date: normalized.date,
      status: "pending",
      attempts: 0,
      createdAt: jobSnap.exists ? jobSnap.data().createdAt : nowIso,
      updatedAt: nowIso,
    });

    return {
      status: existingRecord ? "updated" : "created",
      totalMinutes: normalized.summary.sourceDisplayedMinutes,
      sessionCount: normalized.summary.sessionCount,
      calories: normalized.summary.calories,
    };
  });

  try {
    const trackerReconcile = await reconcileTrackerSourcesAdmin(db, uid, {
      dates: [normalized.date],
      fullRepair: true,
    });
    // Only a non-noop transaction created/reset the durable job. Mark it done
    // after the canonical source reconcile succeeds. A noop still runs the
    // repair check, which is how a newly deployed repair version can heal old
    // history without requiring a different screenshot.
    if (result.status !== "noop") {
      await jobDocRef.set({ status: "completed", updatedAt: now.toISOString() }, { merge: true });
    }
    return { ...result, trackerReconcile };
  } catch (reconcileError) {
    console.error("tracker source reconcile deferred after Keep sync:", reconcileError?.message);
    // For a non-noop update the durable job stays pending and the existing
    // browser sweep can retry. Never fail the Keep data/projection write just
    // because Tracker materialization is temporarily unavailable.
    return {
      ...result,
      trackerReconcile: { status: "deferred", error: reconcileError?.message || "tracker reconcile failed" },
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secret = process.env.CATKEEPER_EXERCISE_SYNC_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured (missing CATKEEPER_EXERCISE_SYNC_SECRET/CATKEEPER_FOCUS_SYNC_SECRET or CATKEEPER_USER_UID)" });
    return;
  }

  const rawBody = await readRawBody(req);
  const timestamp = req.headers["x-catkeeper-timestamp"];
  const signature = req.headers["x-catkeeper-signature"];

  if (!isTimestampFresh(timestamp)) {
    res.status(401).json({ error: "timestamp missing or outside the allowed window" });
    return;
  }
  if (!verifyHmacSignature({ secret, timestamp, rawBody, signature })) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "body is not valid JSON" });
    return;
  }

  const { valid, errors, normalized } = validateExercisePayload(body);
  if (!valid) {
    res.status(400).json({ error: "invalid request body", details: errors });
    return;
  }

  try {
    const result = await handleExerciseRecordSyncRequest({ db: getDb(), uid, normalized, body });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
