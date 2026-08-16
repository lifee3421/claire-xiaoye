import { auth } from "./firebase";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";
import { extractPlannerDraftSidecar } from "../schedule/plannerDailyCanonicalState.js";

export const CANONICAL_PLANNER_MUTATION_QUEUE_FIELD = "__canonicalPlannerMutations";
const ACK_STORAGE_PREFIX = "xiaoye:planner-canonical-acks:v1:";
const MAX_ACKED_OPERATIONS = 128;

export function createPlannerUiOperationId(prefix = "edit") {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `xiaoye:${prefix}:${id}`;
}

export function stripCanonicalPlannerMutationQueue(draft = {}) {
  if (!draft || typeof draft !== "object") return draft;
  const { [CANONICAL_PLANNER_MUTATION_QUEUE_FIELD]: _pending, ...clean } = draft;
  return clean;
}

export function pendingCanonicalPlannerMutations(draft = {}) {
  const rows = draft?.[CANONICAL_PLANNER_MUTATION_QUEUE_FIELD];
  return Array.isArray(rows) ? rows.filter((item) => item && typeof item === "object" && item.operationId) : [];
}

export function draftContainsOnlyStagedCanonicalScheduleChanges(draft = {}) {
  const pending = pendingCanonicalPlannerMutations(draft);
  if (!pending.length) return false;
  const last = pending[pending.length - 1];
  const currentRevision = computePlannerContextBaseRevision({ draft: stripCanonicalPlannerMutationQueue(draft) });
  return plannerRevisionContentHash(currentRevision) === plannerRevisionContentHash(last.afterRevision);
}

export async function flushCanonicalPlannerMutations(draft = {}) {
  const user = auth.currentUser;
  if (!user) throw plannerMutationError("auth_required", "请先登录后再修改排程。");
  const pending = pendingCanonicalPlannerMutations(draft);
  if (!pending.length) return [];
  const acknowledged = readAcknowledgedOperations(user.uid);
  const results = [];
  for (const mutation of pending) {
    if (acknowledged.has(mutation.operationId)) continue;
    const result = mutation.mode === "proposal"
      ? await applyCanonicalPlannerProposalMutation(mutation)
      : await mutateCanonicalDailyPlanner(mutation);
    results.push({ ...result, operationId: mutation.operationId, mode: mutation.mode === "proposal" ? "proposal" : "direct" });
    acknowledged.add(mutation.operationId);
    writeAcknowledgedOperations(user.uid, acknowledged);
  }
  return results;
}

export async function mutateCanonicalDailyPlanner({
  date,
  baseRevision,
  operationId,
  changes,
  requestMeta = null,
} = {}) {
  return postPlannerJson("/api/planner-mutate", {
    date,
    baseRevision,
    operationId,
    changes,
    ...(requestMeta && typeof requestMeta === "object" ? requestMeta : {}),
  }, { acceptedStatuses: new Set(["applied"]) });
}

export async function applyCanonicalPlannerProposalMutation({
  date,
  baseRevision,
  proposalId,
  operationId,
  changes,
  summary = "",
} = {}) {
  const id = proposalId || `proposal:${operationId || createPlannerUiOperationId("proposal")}`;
  const create = await postPlannerJson("/api/planner-ui-proposal", {
    id,
    targetDate: date,
    baseRevision,
    changes,
    summary,
  }, { allowConflict: true });
  // An already-applied proposal is expected when the browser retries after it
  // lost the response. In that case proposal creation/revision may report a
  // non-open conflict; applying the SAME proposal id is the idempotent replay.
  if (create?.conflict && !["not_open", "already_applied"].includes(create.reason)) {
    throw plannerMutationError(create.reason || "proposal_conflict", "排程提案状态已经变化，请刷新后重试。", create);
  }
  return postPlannerJson("/api/planner-ui-proposal-apply", { proposalId: id }, { acceptedStatuses: new Set(["applied", "noop"]) });
}

export async function savePlannerDraftSidecar(draft = {}) {
  const date = String(draft?.targetDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: "skipped" };
  const sidecar = extractPlannerDraftSidecar(stripCanonicalPlannerMutationQueue(draft));
  if (!Object.keys(sidecar).length) return { status: "skipped" };
  return postPlannerJson("/api/planner-draft-sidecar", { date, sidecar }, { acceptedStatuses: new Set(["saved"]) });
}

async function postPlannerJson(url, body, { acceptedStatuses = null, allowConflict = false } = {}) {
  const user = auth.currentUser;
  if (!user) throw plannerMutationError("auth_required", "请先登录后再修改排程。");
  const token = await user.getIdToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok && (!acceptedStatuses || acceptedStatuses.has(payload?.status))) return payload;
  if (allowConflict && response.status === 409) return { ...payload, conflict: true };
  const code = payload?.status || payload?.reason || `http_${response.status}`;
  const friendly = code === "stale"
    ? "日程刚刚有更新，需要刷新后再试。"
    : (payload?.error || payload?.reason || "排程修改未保存。");
  const error = plannerMutationError(code, friendly, payload);
  error.httpStatus = response.status;
  throw error;
}

function plannerRevisionContentHash(value) {
  const match = /^v\d+:.*:([0-9a-f]{8})$/i.exec(String(value || ""));
  return match?.[1]?.toLowerCase() || "";
}

function readAcknowledgedOperations(uid) {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const rows = JSON.parse(localStorage.getItem(`${ACK_STORAGE_PREFIX}${uid}`) || "[]");
    return new Set(Array.isArray(rows) ? rows.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeAcknowledgedOperations(uid, values) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${ACK_STORAGE_PREFIX}${uid}`, JSON.stringify([...values].slice(-MAX_ACKED_OPERATIONS)));
  } catch {
    // Local ack cache is only a replay optimization; server idempotency remains authoritative.
  }
}

function plannerMutationError(code, message, data = null) {
  const error = new Error(message || code || "planner_mutation_failed");
  error.code = code || "planner_mutation_failed";
  error.data = data;
  return error;
}
