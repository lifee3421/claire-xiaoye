// Vercel serverless endpoint. Narrow, single-purpose: accepts a signed daily
// Focus projection from Cyberboss and merges it into ONE date's
// dailyReviewDraft, writing only autoValue fields it itself derives from
// categoryId — never an arbitrary Firestore path or fieldId supplied by the
// caller. See src/server/focusReviewSyncCore.js for the fully unit-tested
// pure logic this handler wires up to a real Firestore transaction.
//
// Auth: HMAC-SHA256 over `${x-catkeeper-timestamp}.${rawBody}`, using
// CATKEEPER_FOCUS_SYNC_SECRET, verified with a timing-safe compare, with a
// +/-5min timestamp window. The target user's uid comes ONLY from
// CATKEEPER_USER_UID (server env) — never from the request body.
//
// Required env vars (see docs/focus-review-sync-setup.md for exact Vercel
// setup steps): CATKEEPER_USER_UID, CATKEEPER_FOCUS_SYNC_SECRET,
// CATKEEPER_FIREBASE_SERVICE_ACCOUNT (the full service-account JSON, as a
// single-line string).

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  verifyHmacSignature,
  isTimestampFresh,
  validateProjectionPayload,
  aggregateSessionsByCategory,
  buildFieldPatches,
  computeRollbackPatches,
  buildFocusSummary,
  buildFocusSync,
} from "../src/server/focusReviewSyncCore.js";
import { normalizeReviewConfig, REVIEW_BINDINGS } from "../src/taxonomy/taxonomyContract.js";

// Vercel auto-parses JSON bodies by default — HMAC verification needs the
// exact raw bytes that were signed, not a re-serialized copy, so parsing
// must be disabled here.
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

  const secret = process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured (missing CATKEEPER_FOCUS_SYNC_SECRET or CATKEEPER_USER_UID)" });
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

  const { valid, errors, sessions } = validateProjectionPayload(body, { date: body?.date });
  if (!valid) {
    res.status(400).json({ error: "invalid request body", details: errors });
    return;
  }

  try {
    const db = getDb();
    const draftRef = db.collection("users").doc(uid).collection("dailyReviewDrafts").doc(body.date);
    const categoriesSnap = await db.collection("users").doc(uid).collection("categories").get();

    // Only categories WITHOUT a static REVIEW_BINDINGS entry need a live
    // reviewConfig lookup — bound leaves' fields are already fully known
    // from REVIEW_BINDINGS itself.
    const liveReviewConfigById = {};
    categoriesSnap.forEach((doc) => {
      const node = { id: doc.id, ...doc.data() };
      if (REVIEW_BINDINGS[node.id]) return;
      liveReviewConfigById[node.id] = normalizeReviewConfig(node);
    });

    const result = await db.runTransaction(async (transaction) => {
      const draftSnap = await transaction.get(draftRef);
      const existing = draftSnap.exists ? draftSnap.data() : null;
      const previousSourceRevision = existing?.focusSync?.sourceRevision || null;

      if (previousSourceRevision && previousSourceRevision === body.sourceRevision) {
        return { status: "noop", reason: "unchanged sourceRevision" };
      }

      const isSettled = existing?.status === "submitted";
      const { byCategory, unmapped } = aggregateSessionsByCategory(sessions);
      const { patch, fieldProjection } = buildFieldPatches({ byCategory, liveReviewConfigById });
      const rollbackPatch = computeRollbackPatches({
        previousFieldProjection: existing?.focusSync?.fieldProjection || null,
        nextFieldProjection: fieldProjection,
      });

      const focusSummary = buildFocusSummary({ byCategory, unmapped, sessions });
      const focusSync = {
        ...buildFocusSync({ date: body.date, timezone: body.timezone, sourceRevision: body.sourceRevision, sessions, byCategory, unmapped, isSettled }),
        fieldProjection,
      };

      // Only ever patches: allowed autoValue leaves, focusSummary, focusSync.
      // set(..., {merge:true}) with dot-path keys deep-merges into existing
      // nested maps (and creates the doc if this is the very first write for
      // that date) without touching any sibling field — draft.ui, manual
      // `value`/`manuallyEdited`, diary, period, clientRevision, and every
      // other existing key are left completely untouched.
      transaction.set(draftRef, { ...patch, ...rollbackPatch, focusSummary, focusSync }, { merge: true });

      return { status: "ok", sessionCount: sessions.length, mappedSessionCount: focusSync.mappedSessionCount, unmappedSessionCount: focusSync.unmappedSessionCount, hasPostSettlementChanges: focusSync.hasPostSettlementChanges === true };
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
