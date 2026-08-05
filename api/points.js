// Vercel serverless endpoint — thin wrapper around applyPointsCommand.
//
// This file only does: auth + body parsing + dispatch to applyPointsCommand.
// The transaction logic lives in src/server/applyPointsCommand.js so both
// the API and emulator concurrency tests run the same production code.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/focusReviewSyncCore.js";
import { resolveRewardShopCaller } from "../src/server/rewardShopAuth.js";
import { applyPointsCommand, SUPPORTED_ACTIONS } from "../src/server/applyPointsCommand.js";

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
    const result = await applyPointsCommand(getDb(), uid, {
      action: body.action,
      payload: body.payload || {},
      actor: caller.actor,
    });

    if (!result.ok) {
      const status = result.code === "unsupported_action" ? 400 : 500;
      return res.status(status).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error(`[points] ${body.action} (${caller.actor}) failed:`, error);
    return res.status(error.code === "INSUFFICIENT_BALANCE" ? 400 : 500).json({
      ok: false, code: error.code || "internal_error", error: error?.message || "internal error",
    });
  }
}
