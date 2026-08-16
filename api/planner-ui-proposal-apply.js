// Firebase-authenticated Xiaoye adapter for applying an already-confirmed
// PlannerProposal. The proposal gate + canonical transaction remain entirely
// in api/planner-apply.js's shared handlePlannerApplyRequest().
import { getAuth } from "firebase-admin/auth";
import { getDb } from "../src/server/adminFirestore.js";
import { handlePlannerApplyRequest } from "./planner-apply.js";

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() || "";
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
    if (typeof body.proposalId !== "string" || !body.proposalId.trim()) {
      res.status(400).json({ status: "rejected", reason: "proposal_id_required" });
      return;
    }
    const result = await handlePlannerApplyRequest({ db, uid, body: { proposalId: body.proposalId.trim() } });
    if (result.outcome === "stale") { res.status(409).json({ status: "stale", currentRevision: result.currentRevision }); return; }
    if (result.outcome === "conflict") { res.status(409).json({ status: "conflict", conflicts: result.conflicts }); return; }
    if (result.outcome === "rejected") { res.status(result.reason === "not_found" ? 404 : 409).json({ status: "rejected", reason: result.reason, problems: result.problems }); return; }
    if (result.outcome === "noop") {
      res.status(200).json({ status: "noop", idempotent: true, changedBlockIds: result.changedBlockIds, summary: result.summary, appliedRevision: result.appliedRevision });
      return;
    }
    res.status(200).json({
      status: "applied",
      changedBlockIds: result.changedBlockIds,
      summary: result.summary,
      appliedRevision: result.appliedRevision,
      ...(result.rebasedEquivalentRevision ? { rebasedEquivalentRevision: true } : {}),
    });
  } catch (error) {
    const code = String(error?.code || "");
    if (code.startsWith("auth/")) { res.status(401).json({ error: "invalid bearer token" }); return; }
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
