// Vercel serverless endpoint. Snow-dust calls this ONLY after the user has
// explicitly confirmed ("就这样/按这个排/发上去/执行") — this is the single
// place a PlannerProposal can actually become a real scheduleAssistantDraft
// write. Everything it does is inside one Firestore transaction: read the
// proposal, read the CURRENT draft, verify baseRevision still matches, apply
// via src/schedule/plannerPatchApply.js (which itself reuses
// resolveSegmentMove/resolveSegmentRemoval and the exact merge logic
// ScheduleAssistant's commitTimelinePositions uses client-side), then write
// both the updated draft and the proposal's new "applied" status atomically.
//
// Idempotent: calling this again with the SAME proposalId after it already
// applied returns the ORIGINAL result without touching the draft a second
// time (see plannerProposal.markProposalApplied/appliedResult) — "发上去"
// sent twice by a flaky WeChat round-trip can never double-move a block.
//
// Auth: same HMAC-SHA256 scheme as api/planner-proposal.js.
// Required env vars: CATKEEPER_USER_UID, CATKEEPER_PLANNER_BRIDGE_SECRET,
// CATKEEPER_FIREBASE_SERVICE_ACCOUNT.
//
// Request body: { proposalId }

import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { PLANNER_PATCH_SCHEMA_VERSION } from "../src/agent/plannerPatch.js";
import { canApplyProposal, markProposalApplied } from "../src/agent/plannerProposal.js";
import { applyPlannerPatch } from "../src/schedule/plannerPatchApply.js";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";

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
  if (!body || typeof body !== "object" || typeof body.proposalId !== "string" || !body.proposalId) {
    res.status(400).json({ error: "invalid request body", details: ["body must be an object with a string proposalId"] });
    return;
  }

  try {
    const result = await handlePlannerApplyRequest({ db: getDb(), uid, body });

    if (result.outcome === "rejected") {
      const status = result.reason === "not_found" ? 404 : 409;
      res.status(status).json({ status: "rejected", reason: result.reason, problems: result.problems });
      return;
    }
    if (result.outcome === "stale") {
      res.status(409).json({ status: "stale", currentRevision: result.currentRevision });
      return;
    }
    if (result.outcome === "conflict") {
      // Structured, machine-readable conflict details Snow-dust can turn into
      // "这个方案和 18:00–18:40 晚饭冲突，我重新给你排一下" — never auto-resolved
      // server-side; the draft is untouched and the proposal stays open.
      res.status(409).json({ status: "conflict", conflicts: result.conflicts });
      return;
    }
    if (result.outcome === "noop") {
      res.status(200).json({ status: "noop", idempotent: true, changedBlockIds: result.changedBlockIds, summary: result.summary, appliedRevision: result.appliedRevision });
      return;
    }
    res.status(200).json({ status: "applied", changedBlockIds: result.changedBlockIds, summary: result.summary, appliedRevision: result.appliedRevision });
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}

/**
 * The actual apply transaction, factored out of the HTTP handler so it's
 * testable against a fake Firestore-Admin-shaped `db` (see
 * api/planner-apply.test.js). Same `db` contract as
 * handlePlannerProposalRequest in api/planner-proposal.js.
 */
export async function handlePlannerApplyRequest({ db, uid, body, now = new Date() }) {
  const userRef = db.collection("users").doc(uid);
  const proposalRef = userRef.collection("plannerProposals").doc(body.proposalId);

  // Prefetched OUTSIDE the transaction — recentReadingTitle (the only thing
  // these feed, via resolveMovableSegments -> resolveRecentReadingTitle) is
  // not conflict/staleness-critical, so it doesn't need transactional
  // read consistency with the draft/proposal reads below.
  const [booksSnap, readingSessionsSnap] = await Promise.all([
    userRef.collection("books").get(),
    userRef.collection("readingSessions").get(),
  ]);
  const books = booksSnap.docs.map((doc) => doc.data());
  const readingSessions = readingSessionsSnap.docs.map((doc) => doc.data());

  return db.runTransaction(async (transaction) => {
    const proposalSnap = await transaction.get(proposalRef);
    const proposal = proposalSnap.exists ? proposalSnap.data() : null;

    const gate = canApplyProposal(proposal);
    if (!gate.ok) {
      if (gate.reason === "already_applied") {
        // Idempotent re-confirm: return the ORIGINAL result, no writes.
        return { outcome: "noop", ...proposal.appliedResult };
      }
      return { outcome: "rejected", reason: gate.reason };
    }

    const userSnap = await transaction.get(userRef);
    const userData = userSnap.exists ? userSnap.data() : {};
    const currentDraft = userData?.scheduleAssistantDraft || {};
    const settings = userData?.scheduleAssistantSettings || {};

    const patch = { schemaVersion: PLANNER_PATCH_SCHEMA_VERSION, date: proposal.targetDate, baseRevision: proposal.baseRevision, changes: proposal.changes };
    const applyResult = applyPlannerPatch({ draft: currentDraft, settings, books, readingSessions, patch, now });

    if (!applyResult.ok) {
      if (applyResult.reason === "stale") return { outcome: "stale", currentRevision: applyResult.currentRevision };
      if (applyResult.reason === "conflict") return { outcome: "conflict", conflicts: applyResult.conflicts };
      return { outcome: "rejected", reason: applyResult.reason, problems: applyResult.problems };
    }

    const nextDraft = { ...applyResult.nextDraft, updatedAt: now.toISOString() };
    const appliedRevision = computePlannerContextBaseRevision({ draft: nextDraft });

    transaction.set(userRef, { scheduleAssistantDraft: nextDraft }, { merge: true });
    transaction.set(proposalRef, markProposalApplied(proposal, { changedBlockIds: applyResult.changedBlockIds, summary: applyResult.summary, appliedRevision }, { now }));

    return { outcome: "applied", changedBlockIds: applyResult.changedBlockIds, summary: applyResult.summary, appliedRevision };
  });
}
