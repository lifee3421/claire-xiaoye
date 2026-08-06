// Shared firebase-admin Firestore singleton for every inbound Vercel
// endpoint (api/focus-review-sync.js, api/planner-proposal.js,
// api/planner-apply.js). Originally inlined per-file in
// api/focus-review-sync.js; extracted once a second/third endpoint needed
// the identical service-account init, so there is exactly one place that
// reads CATKEEPER_FIREBASE_SERVICE_ACCOUNT and calls initializeApp.
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let firestoreSingleton = null;

export function getDb() {
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

/** Reads a Vercel Node request's raw body bytes as a utf8 string — needed
 * whenever an endpoint verifies an HMAC signature over the exact bytes sent
 * (a re-serialized JSON.stringify of the parsed body is not guaranteed to
 * match byte-for-byte). Callers must set `export const config = { api: {
 * bodyParser: false } }` so Vercel doesn't consume the stream first. */
export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
