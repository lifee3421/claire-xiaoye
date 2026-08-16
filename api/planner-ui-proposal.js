// Firebase-authenticated Xiaoye adapter for proposal CREATE/REVISE/CANCEL.
// Proposal lifecycle stays in api/planner-proposal.js's shared core; this file
// only replaces the Snow HMAC auth adapter with Firebase browser auth.
import { getAuth } from "firebase-admin/auth";
import { getDb } from "../src/server/adminFirestore.js";
import { PLANNER_PATCH_SCHEMA_VERSION, validatePlannerPatchShape } from "../src/agent/plannerPatch.js";
import { handlePlannerProposalRequest } from "./planner-proposal.js";

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() || "";
}

export function validatePlannerUiProposal(body = {}) {
  if (typeof body.id !== "string" || !body.id.trim()) return ["id is required"];
  if (typeof body.targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) return ["targetDate must be YYYY-MM-DD"];
  if (body.action === "cancel") return [];
  return validatePlannerPatchShape({
    schemaVersion: PLANNER_PATCH_SCHEMA_VERSION,
    date: body.targetDate,
    baseRevision: body.baseRevision,
    changes: body.changes,
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
    const problems = validatePlannerUiProposal(body);
    if (problems.length) { res.status(400).json({ status: "rejected", reason: "invalid_proposal", problems }); return; }
    const result = await handlePlannerProposalRequest({ db, uid, body: { ...body, createdBy: "xiaoye-ui" } });
    if (result.status === "rejected") {
      res.status(result.reason === "not_found" ? 404 : 409).json({ status: "rejected", reason: result.reason });
      return;
    }
    res.status(200).json(result);
  } catch (error) {
    const code = String(error?.code || "");
    if (code.startsWith("auth/")) { res.status(401).json({ error: "invalid bearer token" }); return; }
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
