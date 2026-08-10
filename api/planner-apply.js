// Vercel serverless endpoint. Snow-dust calls this only after the user has
// confirmed the open PlannerProposal. The target date is date-isolated: if it
// is today's live draft we update it in place; if it is another date we update
// that archived/prepared draft without hijacking the page currently open on a
// different date.
//
// A PlannerContext revision contains BOTH updatedAt and a hash of the mutable
// planner content. Re-saving byte-equivalent planner content changes updatedAt
// but not that hash. Such timestamp-only churn is safe to rebase inside this
// transaction; a genuinely different content hash still returns stale and is
// never silently overwritten.
//
// Idempotent: calling this again with the SAME proposalId after it already
// applied returns the original result without touching the draft a second time.

import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { PLANNER_PATCH_SCHEMA_VERSION } from "../src/agent/plannerPatch.js";
import { canApplyProposal, markProposalApplied } from "../src/agent/plannerProposal.js";
import { applyPlannerPatch } from "../src/schedule/plannerPatchApply.js";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";
import { resolvePlannerDraftForDate, buildPlannerDateWritePatch } from "../src/schedule/plannerDatePersistence.js";

export const config = { api: { bodyParser: false } };

/** Extract the semantic content fingerprint from a PlannerContext revision. */
export function plannerRevisionFingerprint(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^v(\d+):.*:([0-9a-f]{8})$/i.exec(text);
  return match ? { schemaVersion: match[1], contentHash: match[2].toLowerCase() } : null;
}

export function plannerRevisionsHaveSameContent(left, right) {
  if (left === right && typeof left === "string" && left) return true;
  const a = plannerRevisionFingerprint(left);
  const b = plannerRevisionFingerprint(right);
  return Boolean(a && b && a.schemaVersion === b.schemaVersion && a.contentHash === b.contentHash);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured (missing CATKEEPER_PLANNER_BRIDGE_SECRET/CATKEEPER_FOCUS_SYNC_SECRET or CATKEEPER_USER_UID)" });
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
      res.status(409).json({ status: "conflict", conflicts: result.conflicts });
      return;
    }
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
    res.status(500).json({ error: error?.message || "internal error" });
  }
}

/** Actual transaction, exported for fake-Firestore tests. */
export async function handlePlannerApplyRequest({ db, uid, body, now = new Date() }) {
  const userRef = db.collection("users").doc(uid);
  const proposalRef = userRef.collection("plannerProposals").doc(body.proposalId);

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
      if (gate.reason === "already_applied") return { outcome: "noop", ...proposal.appliedResult };
      return { outcome: "rejected", reason: gate.reason };
    }

    const userSnap = await transaction.get(userRef);
    const userData = userSnap.exists ? userSnap.data() : {};
    const { draft: targetDraft } = resolvePlannerDraftForDate(userData, proposal.targetDate);
    const settings = userData?.scheduleAssistantSettings || {};

    const currentRevision = computePlannerContextBaseRevision({ draft: targetDraft });
    const rebasedEquivalentRevision = proposal.baseRevision !== currentRevision
      && plannerRevisionsHaveSameContent(proposal.baseRevision, currentRevision);

    // Only timestamp-only churn gets this safe rebase. Any content-hash
    // difference still returns stale before a single draft mutation occurs.
    const patchBaseRevision = rebasedEquivalentRevision ? currentRevision : proposal.baseRevision;
    const patch = {
      schemaVersion: PLANNER_PATCH_SCHEMA_VERSION,
      date: proposal.targetDate,
      baseRevision: patchBaseRevision,
      changes: proposal.changes,
    };
    const applyResult = applyPlannerPatch({ draft: targetDraft, settings, books, readingSessions, patch, now });

    if (!applyResult.ok) {
      if (applyResult.reason === "stale") return { outcome: "stale", currentRevision: applyResult.currentRevision };
      if (applyResult.reason === "conflict") return { outcome: "conflict", conflicts: applyResult.conflicts };
      return { outcome: "rejected", reason: applyResult.reason, problems: applyResult.problems };
    }

    const nextDraft = { ...applyResult.nextDraft, targetDate: proposal.targetDate, savedOn: proposal.targetDate, updatedAt: now.toISOString() };
    const appliedRevision = computePlannerContextBaseRevision({ draft: nextDraft });
    const plannerWritePatch = buildPlannerDateWritePatch(userData, proposal.targetDate, nextDraft);

    transaction.set(userRef, plannerWritePatch, { merge: true });
    transaction.set(proposalRef, markProposalApplied(proposal, { changedBlockIds: applyResult.changedBlockIds, summary: applyResult.summary, appliedRevision }, { now }));

    return {
      outcome: "applied",
      changedBlockIds: applyResult.changedBlockIds,
      summary: applyResult.summary,
      appliedRevision,
      rebasedEquivalentRevision,
    };
  });
}
