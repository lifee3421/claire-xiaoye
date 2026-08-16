// Vercel serverless endpoint. Snow-dust calls this only after the user has
// confirmed the open PlannerProposal. Proposal lifecycle/confirmation remains
// here; the actual daily schedule commit is delegated to the same canonical
// transaction service used by planner-direct-edit.
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { canApplyProposal, markProposalApplied } from "../src/agent/plannerProposal.js";
import { commitCanonicalDailyPlannerMutation } from "../src/server/canonicalPlannerCommit.js";

export { plannerRevisionFingerprint, plannerRevisionsHaveSameContent } from "../src/server/canonicalPlannerCommit.js";

export const config = { api: { bodyParser: false } };

async function loadPlannerKernelContext(userRef) {
  const [booksSnap, readingSessionsSnap] = await Promise.all([
    userRef.collection("books").get(),
    userRef.collection("readingSessions").get(),
  ]);
  return {
    books: booksSnap.docs.map((doc) => doc.data()),
    readingSessions: readingSessionsSnap.docs.map((doc) => doc.data()),
  };
}

export async function handlePlannerApplyRequest({ db, uid, body, now = new Date() }) {
  const userRef = db.collection("users").doc(uid);
  const { books, readingSessions } = await loadPlannerKernelContext(userRef);

  return commitCanonicalDailyPlannerMutation({
    db,
    uid,
    books,
    readingSessions,
    now,
    loadMutation: async ({ transaction, userRef: transactionUserRef }) => {
      const proposalRef = transactionUserRef.collection("plannerProposals").doc(body.proposalId);
      const proposalSnap = await transaction.get(proposalRef);
      const proposal = proposalSnap.exists ? proposalSnap.data() : null;
      const gate = canApplyProposal(proposal);
      if (!gate.ok) {
        if (gate.reason === "already_applied") {
          return { terminalResult: { outcome: "noop", ...proposal.appliedResult } };
        }
        return { terminalResult: { outcome: "rejected", reason: gate.reason } };
      }
      return {
        date: proposal.targetDate,
        baseRevision: proposal.baseRevision,
        changes: proposal.changes,
        context: { proposal, proposalRef },
      };
    },
    onApplied: ({ transaction, context, result }) => {
      transaction.set(
        context.proposalRef,
        markProposalApplied(context.proposal, {
          changedBlockIds: result.changedBlockIds,
          summary: result.summary,
          appliedRevision: result.appliedRevision,
        }, { now })
      );
    },
  });
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
  try { body = JSON.parse(rawBody); }
  catch { res.status(400).json({ error: "body is not valid JSON" }); return; }
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
