// Vercel serverless endpoint: the ONLY way Cyberboss (and therefore 雪尘 in
// WeChat) can read or change 小猫管家's points, shop and rewards.
//
// Existing points/shop/reward decisions still live in rewardShopEngine.js.
// rewardShopFeatureEngine composes that proven engine with the challenge /
// surprise extension without forking the old redemption implementation.
//
// Auth: two credentials, one authority (see src/server/rewardShopAuth.js).
//   * Cyberboss signs the raw body — HMAC-SHA256 over
//     `${x-catkeeper-timestamp}.${rawBody}`, timing-safe, +/-5min window.
//   * The web app sends `Authorization: Bearer <firebase id token>`, the token
//     it already has from the Google popup login. No shared secret ever
//     reaches the browser.
// The uid comes ONLY from CATKEEPER_USER_UID (server env) or from a verified
// token claim that matches it — never from the body — so neither credential
// can address another account.
//
// Env: CATKEEPER_USER_UID, CATKEEPER_FIREBASE_SERVICE_ACCOUNT, and
// CATKEEPER_REWARD_SHOP_SECRET (falls back to CATKEEPER_FOCUS_SYNC_SECRET so
// an existing deployment works without provisioning a second secret).

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/focusReviewSyncCore.js";
import { createRewardShopAdminPort } from "../src/server/rewardShopAdminPort.js";
import { createRewardShopFeatureEngine } from "../src/server/rewardShopFeatureEngine.js";
import { runRewardShopAction, isRewardShopAction, statusForResult, REWARD_SHOP_ACTIONS } from "../src/server/rewardShopActions.js";
import { resolveRewardShopCaller } from "../src/server/rewardShopAuth.js";
import { canCallRewardShopAction } from "../src/server/rewardShopAccess.js";

// HMAC needs the exact bytes that were signed, not a re-serialized copy.
export const config = { api: { bodyParser: false } };

let firestoreSingleton = null;
function ensureApp() {
  if (!getApps().length) {
    const raw = process.env.CATKEEPER_FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("CATKEEPER_FIREBASE_SERVICE_ACCOUNT is not configured");
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
}

function getDb() {
  if (firestoreSingleton) return firestoreSingleton;
  ensureApp();
  firestoreSingleton = getFirestore();
  return firestoreSingleton;
}

// Same Admin credential as Firestore, so token verification needs no extra
// configuration beyond what the endpoint already requires.
function verifyIdToken(token) {
  ensureApp();
  return getAuth().verifyIdToken(token, true);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  const secret = process.env.CATKEEPER_REWARD_SHOP_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const expectedUid = process.env.CATKEEPER_USER_UID;

  const rawBody = await readRawBody(req);
  const caller = await resolveRewardShopCaller({
    headers: req.headers,
    rawBody,
    secret,
    expectedUid,
    verifyIdToken,
    verifyHmac: verifyHmacSignature,
    isTimestampFresh,
  });
  if (!caller.ok) {
    res.status(caller.status).json({ ok: false, error: caller.error });
    return;
  }
  const uid = caller.uid;

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ ok: false, error: "body is not valid JSON" });
    return;
  }
  if (!body || typeof body !== "object" || typeof body.action !== "string") {
    res.status(400).json({ ok: false, error: "body must be an object with a string action", supported: Object.keys(REWARD_SHOP_ACTIONS) });
    return;
  }
  if (!isRewardShopAction(body.action)) {
    res.status(400).json({ ok: false, error: `unsupported action: ${body.action}`, supported: Object.keys(REWARD_SHOP_ACTIONS) });
    return;
  }
  if (!canCallRewardShopAction(caller, body.action)) {
    res.status(403).json({ ok: false, code: "action_forbidden", error: "this caller is not allowed to perform that reward-shop action" });
    return;
  }

  try {
    const port = createRewardShopAdminPort({ db: getDb(), uid });
    // `actor` is recorded on every ledger row, so the audit trail keeps saying
    // whether a change came from WeChat or from the web page.
    const engine = createRewardShopFeatureEngine(port, { actor: caller.actor });
    const result = await runRewardShopAction(engine, body.action, body.payload || {});
    res.status(statusForResult(result)).json(result);
  } catch (error) {
    console.error(`[reward-shop] ${body.action} (${caller.actor}) failed:`, error);
    res.status(500).json({ ok: false, code: "internal_error", error: error?.message || "internal error" });
  }
}
