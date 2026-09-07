import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  verifyHmacSignature,
  isTimestampFresh,
} from "../src/server/exerciseRecordSyncCore.js";
import {
  normalizeStoredExerciseRecord,
  validateExerciseExportRange,
} from "../src/server/exerciseRecordExportCore.js";

export const config = { api: { bodyParser: false } };

let firestoreSingleton = null;
function getDb() {
  if (firestoreSingleton) return firestoreSingleton;
  if (!getApps().length) {
    const raw = process.env.CATKEEPER_FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("CATKEEPER_FIREBASE_SERVICE_ACCOUNT is not configured");
    initializeApp({ credential: cert(JSON.parse(raw)) });
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
  const secret = process.env.CATKEEPER_EXERCISE_SYNC_SECRET
    || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured" });
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
  try { body = JSON.parse(rawBody); }
  catch {
    res.status(400).json({ error: "body is not valid JSON" });
    return;
  }
  const range = validateExerciseExportRange(body);
  if (!range.valid) {
    res.status(400).json({ error: "invalid request body", details: [range.error] });
    return;
  }

  try {
    const db = getDb();
    const collection = db.collection("users").doc(uid).collection("exerciseRecords");
    const refs = range.dates.map((date) => collection.doc(date));
    const snapshots = await db.getAll(...refs);
    const records = snapshots
      .filter((snap) => snap.exists)
      .map((snap) => normalizeStoredExerciseRecord(snap.data()))
      .filter(Boolean);
    res.status(200).json({
      ok: true,
      from: range.from,
      to: range.to,
      recordCount: records.length,
      records,
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
