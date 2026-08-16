// Firebase-authenticated browser adapter for small canonical daily planner
// mutations. The browser owns intent and presentation; this endpoint owns
// neither UI nor proposal policy. It accepts only ordinary reversible edits
// and delegates the actual write semantics to canonicalPlannerCommit.js.
import { getAuth } from "firebase-admin/auth";
import { getDb } from "../src/server/adminFirestore.js";
import { validatePlannerPatchShape, PLANNER_PATCH_SCHEMA_VERSION } from "../src/agent/plannerPatch.js";
import { commitCanonicalDailyPlannerMutation } from "../src/server/canonicalPlannerCommit.js";
import { markInboxItemScheduled } from "../src/utils/plannerInbox.js";

const UI_DIRECT_TYPES = new Set([
  "move",
  "return_to_pool",
  "schedule_from_pool",
  "create_task",
  "edit_task",
  "delete_task",
  "set_pool_order",
]);
const MAX_UI_CHANGES = 64;
const OPERATION_KIND = "planner-ui-direct-edit";

export function validatePlannerUiMutation(body = {}) {
  const operationId = String(body.operationId || "").trim();
  if (!operationId) return ["operationId is required"];
  const date = String(body.date || "").trim();
  const baseRevision = String(body.baseRevision || body.expectedRevision || "").trim();
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const problems = validatePlannerPatchShape({
    schemaVersion: PLANNER_PATCH_SCHEMA_VERSION,
    date,
    baseRevision,
    changes,
  });
  if (changes.length > MAX_UI_CHANGES) problems.push(`UI direct mutation accepts at most ${MAX_UI_CHANGES} changes`);
  changes.forEach((change, index) => {
    if (!UI_DIRECT_TYPES.has(change?.type)) problems.push(`changes[${index}] type ${String(change?.type || "<missing>")} is not a direct UI timeline mutation`);
  });

  if (body.inboxTransition !== undefined) {
    const transition = body.inboxTransition;
    if (!transition || typeof transition !== "object") {
      problems.push("inboxTransition must be an object when supplied");
    } else {
      const itemId = String(transition.itemId || "").trim();
      const taskId = String(transition.taskId || "").trim();
      if (!itemId || !taskId) problems.push("inboxTransition requires itemId and taskId");
      const matchingCreate = changes.find((change) => change?.type === "create_task"
        && String(change.taskId || "") === taskId
        && String(change.originInboxItemId || change.sourceId || "") === itemId
        && String(change.source || "") === "inbox");
      if (!matchingCreate) problems.push("inboxTransition must match an inbox-sourced create_task change");
    }
  }
  return problems;
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

export async function handlePlannerUiMutationRequest({ db, uid, body = {}, now = new Date() } = {}) {
  const problems = validatePlannerUiMutation(body);
  if (problems.length) return { outcome: "rejected", reason: "invalid_ui_mutation", problems };
  const date = String(body.date || "").trim();
  const baseRevision = String(body.baseRevision || body.expectedRevision || "").trim();
  const userRef = db.collection("users").doc(uid);
  const { books, readingSessions } = await loadPlannerKernelContext(userRef);
  const inboxTransition = body.inboxTransition && typeof body.inboxTransition === "object"
    ? { itemId: String(body.inboxTransition.itemId), taskId: String(body.inboxTransition.taskId) }
    : null;

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
    ...(inboxTransition ? {
      onApplied: ({ transaction, userRef: transactionUserRef, profile }) => {
        const plannerInbox = markInboxItemScheduled(profile.plannerInbox, inboxTransition.itemId, {
          scheduledDate: date,
          scheduledTaskId: inboxTransition.taskId,
        });
        transaction.set(transactionUserRef, { plannerInbox }, { merge: true });
      },
    } : {}),
  });
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  try {
    const db = getDb();
    const token = bearerToken(req);
    if (!token) { res.status(401).json({ error: "missing bearer token" }); return; }
    const decoded = await getAuth().verifyIdToken(token);
    const uid = String(decoded?.uid || "").trim();
    if (!uid) { res.status(401).json({ error: "invalid bearer token" }); return; }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await handlePlannerUiMutationRequest({ db, uid, body });
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
    const code = String(error?.code || "");
    if (code.startsWith("auth/")) { res.status(401).json({ error: "invalid bearer token" }); return; }
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
