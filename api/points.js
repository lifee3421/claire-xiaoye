// Vercel serverless endpoint — thin wrapper around applyPointsCommand.
//
// This file does auth + body parsing + dispatch to applyPointsCommand, then
// performs a best-effort server-authoritative Tracker source reconcile for
// settlement writes. Tracker sync must never depend on a browser being allowed
// to create a trackerReconcileJob document.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/focusReviewSyncCore.js";
import { resolveRewardShopCaller } from "../src/server/rewardShopAuth.js";
import { applyPointsCommand, SUPPORTED_ACTIONS } from "../src/server/applyPointsCommand.js";
import { reconcileTrackerSourcesAdmin } from "../src/server/trackerSourceReconcileAdmin.js";

export const config = { api: { bodyParser: false } };

// ─── Admin SDK boilerplate ─────────────────────────────────────────────────

let firestoreSingleton = null;
function ensureApp() {
  if (!getApps().length) {
    const raw = process.env.CATKEEPER_FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("CATKEEPER_FIREBASE_SERVICE_ACCOUNT missing");
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
}
function getDb() { if (!firestoreSingleton) { ensureApp(); firestoreSingleton = getFirestore(); } return firestoreSingleton; }
function verifyIdToken(token) { ensureApp(); return getAuth().verifyIdToken(token, true); }
async function readRawBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString("utf8"); }

function settlementReviewDate(action, payload = {}) {
  if (action === "apply_settlement" || action === "create_settlement") return payload?.settlement?.reviewDate || "";
  if (action === "revise_settlement") return payload?.settlement?.reviewDate || payload?.previousSettlement?.reviewDate || "";
  return "";
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method not allowed" });

  const secret = process.env.CATKEEPER_REWARD_SHOP_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const expectedUid = process.env.CATKEEPER_USER_UID;
  if (!secret || !expectedUid) return res.status(500).json({ ok: false, error: "server not configured" });

  const rawBody = await readRawBody(req);

  // ── Auth ──────────────────────────────────────────────────────────────
  const caller = await resolveRewardShopCaller({
    headers: req.headers, rawBody, secret, expectedUid, verifyIdToken,
    verifyHmac: verifyHmacSignature, isTimestampFresh,
  });
  if (!caller.ok) return res.status(caller.status).json({ ok: false, error: caller.error });
  const uid = caller.uid;
  // uid is ALWAYS from the verified token/HMAC — NEVER from the request body

  // ── Parse & validate ───────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(400).json({ ok: false, error: "not valid JSON" }); }
  if (!body?.action || !SUPPORTED_ACTIONS.includes(body.action)) {
    return res.status(400).json({ ok: false, error: `unsupported action: ${body.action}`, supported: SUPPORTED_ACTIONS });
  }

  // ── Dispatch to shared production code ─────────────────────────────────
  try {
    const db = getDb();
    const result = await applyPointsCommand(db, uid, {
      action: body.action,
      payload: body.payload || {},
      actor: caller.actor,
    });

    if (!result.ok) {
      const status = result.code === "unsupported_action" ? 400 : 500;
      return res.status(status).json(result);
    }

    const reviewDate = settlementReviewDate(body.action, body.payload || {});
    if (reviewDate) {
      try {
        // First successful call after a repair-version bump materializes all
        // historical explicit evidence once. Normal calls thereafter only
        // reconcile this date. Failure here must never roll back a settlement
        // or its points transaction; the next save retries the self-heal.
        const trackerReconcile = await reconcileTrackerSourcesAdmin(db, uid, {
          dates: [reviewDate],
          fullRepair: true,
        });
        return res.status(200).json({ ...result, trackerReconcile });
      } catch (trackerError) {
        console.error(`[points] tracker source reconcile deferred (${reviewDate}):`, trackerError);
        return res.status(200).json({
          ...result,
          trackerReconcile: { status: "deferred", error: trackerError?.message || "tracker reconcile failed" },
        });
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error(`[points] ${body.action} (${caller.actor}) failed:`, error);
    return res.status(error.code === "INSUFFICIENT_BALANCE" ? 400 : 500).json({
      ok: false, code: error.code || "internal_error", error: error?.message || "internal error",
    });
  }
}
