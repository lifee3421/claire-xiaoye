import { getAuth } from "firebase-admin/auth";
import { getDb, readRawBody } from "./adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "./hmacAuth.js";
import { validatePlannerPatchShape, PLANNER_PATCH_SCHEMA_VERSION } from "../agent/plannerPatch.js";
import { commitCanonicalDailyPlannerMutation } from "./canonicalPlannerCommit.js";
import { markInboxItemScheduled } from "../utils/plannerInbox.js";
import { buildPlannerDateWritePatch, resolvePlannerDraftForDate } from "../schedule/plannerDatePersistence.js";
import {
  extractPlannerDraftSidecar,
  mergePlannerDraftSidecar,
  PLANNER_DRAFT_SIDECAR_FIELDS,
} from "../schedule/plannerDailyCanonicalState.js";
import { handlePlannerProposalRequest } from "../../api/planner-proposal.js";
import { handlePlannerApplyRequest } from "../../api/planner-apply.js";

const UI_DIRECT_TYPES = new Set([
  "move",
  "return_to_pool",
  "schedule_from_pool",
  "create_task",
  "edit_task",
  "delete_task",
  "set_pool_order",
]);
const MAX_UI_CHANGES = 3;
const UI_OPERATION_KIND = "planner-ui-direct-edit";

const DIRECT_TYPES = new Set([
  "move",
  "return_to_pool",
  "schedule_from_pool",
  "create_task",
  "edit_task",
  "delete_task",
]);
const MAX_DIRECT_CHANGES = 3;
const DIRECT_OPERATION_KIND = "planner-direct-edit";

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() || "";
}

async function requireFirebaseUid(req, res) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return "";
  }
  const decoded = await getAuth().verifyIdToken(token);
  const uid = String(decoded?.uid || "").trim();
  if (!uid) {
    res.status(401).json({ error: "invalid bearer token" });
    return "";
  }
  return uid;
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
    if (!UI_DIRECT_TYPES.has(change?.type)) {
      problems.push(`changes[${index}] type ${String(change?.type || "<missing>")} is not a direct UI timeline mutation`);
    }
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
    operationKind: UI_OPERATION_KIND,
    books,
    readingSessions,
    now,
    ...(inboxTransition ? {
      onApplied: ({ transaction, userRef: transactionUserRef, profile }) => {
        const plannerInbox = markInboxItemScheduled(profile.plannerInbox, inboxTransition.itemId, {
          targetDate: date,
          taskId: inboxTransition.taskId,
        });
        transaction.set(transactionUserRef, { plannerInbox }, { merge: true });
      },
    } : {}),
  });
}

export async function plannerMutateHandler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  try {
    const db = getDb();
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
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

export function validateDirectPlannerChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return ["changes must be a non-empty array"];
  if (changes.length > MAX_DIRECT_CHANGES) {
    return [`direct edit accepts at most ${MAX_DIRECT_CHANGES} changes; use a PlannerProposal for larger replans`];
  }
  return changes.flatMap((change, index) => DIRECT_TYPES.has(change?.type)
    ? []
    : [`changes[${index}] type ${String(change?.type || "<missing>")} requires PlannerProposal confirmation`]);
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
    operationKind: DIRECT_OPERATION_KIND,
    books,
    readingSessions,
    now,
  });
}

export async function plannerDirectEditHandler(req, res) {
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

export async function plannerDraftSidecarHandler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const db = getDb();
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
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

export function validatePlannerUiProposal(body = {}) {
  if (typeof body.id !== "string" || !body.id.trim()) return ["id is required"];
  if (typeof body.targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) {
    return ["targetDate must be YYYY-MM-DD"];
  }
  if (body.action === "cancel") return [];
  return validatePlannerPatchShape({
    schemaVersion: PLANNER_PATCH_SCHEMA_VERSION,
    date: body.targetDate,
    baseRevision: body.baseRevision,
    changes: body.changes,
  });
}

export async function plannerUiProposalHandler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const db = getDb();
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
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

export async function plannerUiProposalApplyHandler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const db = getDb();
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
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
