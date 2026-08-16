// Lightweight HMAC planner mutation endpoint for small, reversible day-to-day
// edits. Unlike PlannerProposal it commits immediately, but it intentionally
// accepts only a tiny patch (<= 3 ordinary-card operations).
//
// The actual revision/idempotency/PlannerPatch/Firestore transaction semantics
// live in canonicalPlannerCommit.js and are shared with planner-apply.
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { commitCanonicalDailyPlannerMutation } from "../src/server/canonicalPlannerCommit.js";

export const config = { api: { bodyParser: false } };

const DIRECT_TYPES = new Set(["move", "return_to_pool", "schedule_from_pool", "create_task", "edit_task", "delete_task"]);
const MAX_DIRECT_CHANGES = 3;
const OPERATION_KIND = "planner-direct-edit";

export function validateDirectPlannerChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return ["changes must be a non-empty array"];
  if (changes.length > MAX_DIRECT_CHANGES) return [`direct edit accepts at most ${MAX_DIRECT_CHANGES} changes; use a PlannerProposal for larger replans`];
  return changes.flatMap((change, index) => DIRECT_TYPES.has(change?.type)
    ? []
    : [`changes[${index}] type ${String(change?.type || "<missing>")} requires PlannerProposal confirmation`]);
}

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

export async function handlePlannerDirectEditRequest({ db, uid, body = {}, now = new Date() } = {}) {
  const date = String(body.date || "").trim();
  const baseRevision = String(body.baseRevision || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { outcome: "rejected", reason: "invalid_date" };
  if (!baseRevision) return { outcome: "rejected", reason: "base_revision_required" };
  const shapeProblems = validateDirectPlannerChanges(body.changes);
  if (shapeProblems.length) return { outcome: "rejected", reason: "direct_edit_too_broad", problems: shapeProblems };

  const userRef = db.collection("users").doc(uid);
  const { books, readingSessions } = await loadPlannerKernelContext(userRef);
  return commitCanonicalDailyPlannerMutation({
    db,
    uid,
    date,
    baseRevision,
    changes: body.changes,
    operationId: body.operationId,
    operationKind: OPERATION_KIND,
    books,
    readingSessions,
    now,
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
    res.status(500).json({ error: "server is not configured" });
    return;
  }
  const rawBody = await readRawBody(req);
  const timestamp = req.headers["x-catkeeper-timestamp"];
  const signature = req.headers["x-catkeeper-signature"];
  if (!isTimestampFresh(timestamp) || !verifyHmacSignature({ secret, timestamp, rawBody, signature })) {
    res.status(401).json({ error: "invalid or expired signature" });
    return;
  }
  let body;
  try { body = JSON.parse(rawBody); }
  catch { res.status(400).json({ error: "body is not valid JSON" }); return; }

  try {
    const result = await handlePlannerDirectEditRequest({ db: getDb(), uid, body });
    if (result.outcome === "stale") { res.status(409).json({ status: "stale", currentRevision: result.currentRevision }); return; }
    if (result.outcome === "conflict") { res.status(409).json({ status: "conflict", conflicts: result.conflicts }); return; }
    if (result.outcome === "rejected") { res.status(400).json({ status: "rejected", reason: result.reason, problems: result.problems, rejections: result.rejections }); return; }
    res.status(200).json({
      status: "applied",
      changedBlockIds: result.changedBlockIds,
      summary: result.summary,
      appliedRevision: result.appliedRevision,
      ...(result.rebasedEquivalentRevision ? { rebasedEquivalentRevision: true } : {}),
      ...(result.idempotentReplay ? { idempotentReplay: true } : {}),
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
