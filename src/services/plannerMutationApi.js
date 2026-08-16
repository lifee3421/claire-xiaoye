import { auth } from "./firebase";

export function createPlannerUiOperationId(prefix = "drag") {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `xiaoye:${prefix}:${id}`;
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

function plannerMutationError(code, message, data = null) {
  const error = new Error(message || code || "planner_mutation_failed");
  error.code = code || "planner_mutation_failed";
  error.data = data;
  return error;
}
