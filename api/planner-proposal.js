// Vercel serverless endpoint. Snow-dust calls this to CREATE or REVISE a
// PlannerProposal while discussing a day's schedule with the user over
// WeChat. This endpoint NEVER writes scheduleAssistantDraft — the only
// Firestore writes it ever performs are to users/{uid}/plannerProposals/*.
// That is what makes "讨论态绝不能写正式排程" true by construction, not by
// convention: there is no code path from here to the plan document.
//
// Auth: same HMAC-SHA256 scheme as api/focus-review-sync.js (see
// src/server/hmacAuth.js), over `${x-catkeeper-timestamp}.${rawBody}`, using
// CATKEEPER_PLANNER_BRIDGE_SECRET. The target user's uid comes ONLY from
// CATKEEPER_USER_UID (server env) — never from the request body.
//
// Required env vars: CATKEEPER_USER_UID, CATKEEPER_PLANNER_BRIDGE_SECRET,
// CATKEEPER_FIREBASE_SERVICE_ACCOUNT.
//
// Request body, create/revise (default):
//   { id, targetDate, baseRevision, changes, summary }
// `id` is caller-supplied (Snow-dust generates it) and is the SAME id across
// a create + any number of revisions of the same discussion thread — send
// the same id again with new baseRevision/changes/summary to revise; send a
// NEW id to start a fresh proposal (which supersedes any other open
// proposal for the same targetDate). See src/agent/plannerProposal.js for
// the full status-machine rationale.
//
// Request body, cancel (e.g. the user says "算了"/"不用了"):
//   { id, targetDate, action: "cancel" }
// Only valid while the proposal is still "open"; like create/revise, this
// NEVER touches scheduleAssistantDraft — cancelling a discussion is exactly
// as inert to the real plan as never having proposed it.

import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { PLANNER_PATCH_SCHEMA_VERSION, validatePlannerPatchShape } from "../src/agent/plannerPatch.js";
import { cancelPlannerProposal, createPlannerProposal, revisePlannerProposal, supersedeOpenProposalsForDate } from "../src/agent/plannerProposal.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured (missing CATKEEPER_PLANNER_BRIDGE_SECRET or CATKEEPER_USER_UID)" });
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
  if (!body || typeof body !== "object" || typeof body.id !== "string" || !body.id || typeof body.targetDate !== "string") {
    res.status(400).json({ error: "invalid request body", details: ["body must be an object with a string id and targetDate"] });
    return;
  }

  // Cancel skips the PlannerPatch shape validation below entirely — a
  // cancel body carries no changes/baseRevision to validate.
  if (body.action !== "cancel") {
    // Validate the changes/baseRevision shape using the SAME rules the apply
    // endpoint will eventually enforce — catches a malformed proposal at
    // discussion time rather than only surfacing the problem when the user
    // finally says "执行".
    const shapeProblems = validatePlannerPatchShape({
      schemaVersion: PLANNER_PATCH_SCHEMA_VERSION,
      date: body.targetDate,
      baseRevision: body.baseRevision,
      changes: body.changes,
    });
    if (shapeProblems.length) {
      res.status(400).json({ error: "invalid proposal", details: shapeProblems });
      return;
    }
  }

  try {
    const result = await handlePlannerProposalRequest({ db: getDb(), uid, body });
    if (result.status === "rejected") {
      const status = result.reason === "not_found" ? 404 : 409;
      res.status(status).json({ error: `proposal "${body.id}" ${result.reason === "not_found" ? "does not exist" : "is not open"}`, reason: result.reason });
      return;
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}

/**
 * The actual create-or-revise transaction, factored out of the HTTP handler
 * so it's testable against a fake Firestore-Admin-shaped `db` without a real
 * service account (see api/planner-proposal.test.js). `db` only needs
 * `.collection(name).doc(id)` / `.collection(name).where(...)` and
 * `.runTransaction(fn)` with a `transaction` exposing `.get`/`.set` — the
 * exact subset of the firebase-admin Firestore API this function uses.
 */
export async function handlePlannerProposalRequest({ db, uid, body, now = new Date() }) {
  const proposalsRef = db.collection("users").doc(uid).collection("plannerProposals");
  const targetRef = proposalsRef.doc(body.id);

  if (body.action === "cancel") {
    return db.runTransaction(async (transaction) => {
      const targetSnap = await transaction.get(targetRef);
      if (!targetSnap.exists) return { status: "rejected", reason: "not_found" };
      const cancellation = cancelPlannerProposal(targetSnap.data(), { now });
      if (!cancellation.ok) return { status: "rejected", reason: cancellation.reason };
      transaction.set(targetRef, cancellation.proposal, { merge: false });
      return { status: "cancelled", proposal: cancellation.proposal };
    });
  }

  return db.runTransaction(async (transaction) => {
    const [targetSnap, sameDaySnap] = await Promise.all([
      transaction.get(targetRef),
      transaction.get(proposalsRef.where("targetDate", "==", body.targetDate).where("status", "==", "open")),
    ]);

    if (targetSnap.exists) {
      const existing = targetSnap.data();
      const revision = revisePlannerProposal(existing, { baseRevision: body.baseRevision, changes: body.changes, summary: body.summary }, { now });
      if (!revision.ok) return { status: "rejected", reason: revision.reason };
      transaction.set(targetRef, revision.proposal, { merge: false });
      return { status: "revised", proposal: revision.proposal };
    }

    const created = createPlannerProposal({ id: body.id, targetDate: body.targetDate, baseRevision: body.baseRevision, changes: body.changes, summary: body.summary, createdBy: body.createdBy, now });
    transaction.set(targetRef, created);

    const supersedePatches = supersedeOpenProposalsForDate(sameDaySnap.docs.map((doc) => doc.data()), body.targetDate, { excludeId: body.id, newProposalId: body.id, now });
    supersedePatches.forEach(({ id, patch }) => transaction.set(proposalsRef.doc(id), patch, { merge: true }));

    return { status: "created", proposal: created, supersededIds: supersedePatches.map((entry) => entry.id) };
  });
}
