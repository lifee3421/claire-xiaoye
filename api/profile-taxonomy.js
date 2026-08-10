import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { extractBearerToken } from "../src/server/rewardShopAuth.js";
import { validateClassificationTaxonomy } from "../src/server/profileTaxonomyCore.js";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  const expectedUid = process.env.CATKEEPER_USER_UID;
  if (!expectedUid) {
    res.status(500).json({ ok: false, error: "server is not configured (missing CATKEEPER_USER_UID)" });
    return;
  }

  const token = extractBearerToken(req.headers);
  if (!token) {
    res.status(401).json({ ok: false, error: "missing Authorization bearer token" });
    return;
  }

  let decoded;
  try {
    ensureApp();
    decoded = await getAuth().verifyIdToken(token, true);
  } catch (error) {
    res.status(401).json({ ok: false, error: `invalid or expired id token: ${error?.message || "verification failed"}` });
    return;
  }
  const uid = decoded?.uid || decoded?.sub || "";
  if (!uid || uid !== expectedUid) {
    res.status(403).json({ ok: false, error: "this account is not allowed to update the taxonomy" });
    return;
  }

  const result = validateClassificationTaxonomy(req.body?.classificationTaxonomy);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }

  try {
    await getDb().collection("users").doc(uid).set({
      classificationTaxonomy: result.taxonomy,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(200).json({ ok: true, nodeCount: result.nodeCount });
  } catch (error) {
    console.error("[profile-taxonomy] save failed:", error);
    res.status(500).json({ ok: false, error: error?.message || "taxonomy save failed" });
  }
}
