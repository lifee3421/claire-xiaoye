import { auth } from "./firebase";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";

export const CANONICAL_PLANNER_MUTATION_QUEUE_FIELD = "__canonicalPlannerMutations";
const ACK_STORAGE_PREFIX = "xiaoye:planner-canonical-acks:v1:";
const MAX_ACKED_OPERATIONS = 128;

export function createPlannerUiOperationId(prefix = "drag") {
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
    const result = await mutateCanonicalDailyPlanner(mutation);
    results.push(result);
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
} = {}) {
  const user = auth.currentUser;
  if (!user) throw plannerMutationError("auth_required", "请先登录后再修改排程。");
  const token = await user.getIdToken();
  const response = await fetch("/api/planner-mutate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ date, baseRevision, operationId, changes }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload?.status === "applied") return payload;
  const error = plannerMutationError(payload?.status || payload?.reason || `http_${response.status}`, payload?.error || payload?.reason || "排程修改未保存。", payload);
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
