// Firebase-authenticated browser endpoint for NON-SCHEDULE fields that live
// beside a dated planner draft (stickers, reminder sync metadata, baseline
// snapshot, etc.). It never accepts canonical daily state fields and never
// changes the planner revision/updatedAt, so it cannot overwrite a concurrent
// Snow/Xiaoye schedule mutation.
import { getAuth } from "firebase-admin/auth";
import { getDb } from "../src/server/adminFirestore.js";
import { buildPlannerDateWritePatch, resolvePlannerDraftForDate } from "../src/schedule/plannerDatePersistence.js";
import { extractPlannerDraftSidecar, mergePlannerDraftSidecar, PLANNER_DRAFT_SIDECAR_FIELDS } from "../src/schedule/plannerDailyCanonicalState.js";

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() || "";
}

export function validatePlannerDraftSidecarRequest(body = {}) {
  const date = String(body.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ["date must be YYYY-MM-DD"];
  if (!body.sidecar || typeof body.sidecar !== "object" || Array.isArray(body.sidecar)) return ["sidecar must be an object"];
  const unknown = Object.keys(body.sidecar).filter((key) => !PLANNER_DRAFT_SIDECAR_FIELDS.has(key));
  return unknown.map((key) => `sidecar.${key} is not an allowed non-schedule field`);
}

export async function handlePlannerDraftSidecarRequest({ db, uid, body = {} } = {}) {
  const problems = validatePlannerDraftSidecarRequest(body);
  if (problems.length) return { outcome: "rejected", problems };
  const targetDate = String(body.date).trim();
  const requestedSidecar = extractPlannerDraftSidecar(body.sidecar);
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const profile = userSnap.exists ? userSnap.data() : {};
    const { draft } = resolvePlannerDraftForDate(profile, targetDate);
    const nextDraft = mergePlannerDraftSidecar(draft, requestedSidecar);
    const writePatch = buildPlannerDateWritePatch(profile, targetDate, nextDraft);
    transaction.set(userRef, writePatch, { merge: true });
    return { outcome: "saved", date: targetDate, sidecar: requestedSidecar };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const db = getDb();
    const token = bearerToken(req);
    if (!token) { res.status(401).json({ error: "missing bearer token" }); return; }
    const decoded = await getAuth().verifyIdToken(token);
    const uid = String(decoded?.uid || "").trim();
    if (!uid) { res.status(401).json({ error: "invalid bearer token" }); return; }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await handlePlannerDraftSidecarRequest({ db, uid, body });
    if (result.outcome === "rejected") { res.status(400).json({ status: "rejected", problems: result.problems }); return; }
    res.status(200).json({ status: "saved", date: result.date });
  } catch (error) {
    const code = String(error?.code || "");
    if (code.startsWith("auth/")) { res.status(401).json({ error: "invalid bearer token" }); return; }
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
