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
// Idempotency / same-day update semantics (spec sections 7/19.3/19.4): Keep's
// page is always "today so far, in full" — a second screenshot for the same
// date REPLACES summary+sessions, it never adds to them. A byte-identical
// screenshot (same source.sourceSnapshotHash) is a true no-op.
//
// Required env vars: CATKEEPER_USER_UID, CATKEEPER_EXERCISE_SYNC_SECRET (or
// CATKEEPER_FOCUS_SYNC_SECRET), CATKEEPER_FIREBASE_SERVICE_ACCOUNT.

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
import { resolveEffectiveTrackers } from "../src/utils/trackerDefaults.js";
import { extractEvidenceFromExerciseRecord, buildCompletionEventId } from "../src/services/completionEvents.js";

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
    const db = getDb();
    const recordRef = db.collection("users").doc(uid).collection("exerciseRecords").doc(normalized.date);
    const draftRef = db.collection("users").doc(uid).collection("dailyReviewDrafts").doc(normalized.date);

    const result = await db.runTransaction(async (transaction) => {
      const [recordSnap, draftSnap] = await Promise.all([transaction.get(recordRef), transaction.get(draftRef)]);
      const existingRecord = recordSnap.exists ? recordSnap.data() : null;
      const currentFields = draftSnap.exists ? draftSnap.data()?.fields || {} : {};

      const { fieldUpdates, exerciseSync } = buildExerciseFieldPatch(normalized);

      const sameSnapshot = isSameSnapshot(existingRecord, normalized.source.sourceSnapshotHash);
      const materialized = sameSnapshot && isProjectionMaterialized(currentFields, fieldUpdates);
      if (materialized) {
        return { status: "noop", reason: "identical screenshot already synced", sessionCount: normalized.summary.sessionCount };
      }

      const nowIso = new Date().toISOString();
      // exerciseRecords/{date} is fully OVERWRITTEN, never merged/appended —
      // Keep's page is always the day's complete snapshot so far, and a
      // stale earlier session list must not linger alongside a new one.
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
      // Only ever patches: fields (the two known exercise.* ids, reconstructed
      // above), exerciseSync. draft.ui, manual value/manuallyEdited, diary,
      // period, clientRevision, and every other existing top-level key are
      // left completely untouched by {merge:true}.
      transaction.set(draftRef, { fields: nextFields, exerciseSync }, { merge: true });

      return {
        status: existingRecord ? "updated" : "created",
        totalMinutes: normalized.summary.sourceDisplayedMinutes,
        sessionCount: normalized.summary.sessionCount,
        calories: normalized.summary.calories,
      };
    });

    // Reconcile exercise-complete CompletionEvent from the exerciseRecord.
    // Best-effort: a reconcile failure does not fail the sync — the exerciseRecord
    // write already committed above, and the CompletionEvent will be written on
    // the next Keep sync or when the user triggers a migration.
    if (result.status !== "noop") {
      try {
        const profileSnap = await db.collection("users").doc(uid).get();
        const trackers = resolveEffectiveTrackers(profileSnap.exists ? profileSnap.data() : {});
        const exerciseTracker = trackers.find((t) => t.id === "exercise-complete" && t.enabled !== false);
        if (exerciseTracker) {
          const exBindings = (Array.isArray(exerciseTracker.evidenceBindings) ? exerciseTracker.evidenceBindings : []).filter((b) => b.type === "exerciseRecord");
          if (exBindings.length) {
            const exRecord = { date: normalized.date, summary: normalized.summary };
            const evidence = extractEvidenceFromExerciseRecord({ ...exerciseTracker, evidenceBindings: exBindings }, exRecord);
            if (evidence.length) {
              const item = evidence[0];
              const eventId = await buildCompletionEventId(exerciseTracker.id, normalized.date, item.sourceFieldKey, item.sourceType);
              const eventDocRef = db.collection("users").doc(uid).collection("completionEvents").doc(eventId);
              const existingSnap = await eventDocRef.get();
              const nowIso = new Date().toISOString();
              await eventDocRef.set({
                id: eventId,
                trackerId: exerciseTracker.id,
                occurredOn: normalized.date,
                occurredAt: null,
                recordedAt: nowIso,
                value: item.value,
                unit: item.unit,
                sourceType: item.sourceType,
                ingestionType: existingSnap.exists ? (existingSnap.data()?.ingestionType || "live") : "live",
                sourceDocumentId: normalized.date,
                sourceFieldKey: item.sourceFieldKey,
                sourceRevision: 0,
                evidenceSummary: item.evidenceSummary,
                state: "active",
                retractedAt: null,
                retractionReason: null,
                createdAt: existingSnap.exists ? (existingSnap.data()?.createdAt || nowIso) : nowIso,
                updatedAt: nowIso,
              }, { merge: true });
            }
          }
        }
      } catch (reconcileError) {
        console.error("exercise-complete CompletionEvent reconcile failed:", reconcileError?.message);
      }
    }

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
