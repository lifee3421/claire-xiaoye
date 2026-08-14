import crypto from "node:crypto";

export const PLANNER_BRIDGE_OPERATION_RECEIPT_LIMIT = 32;
const OPERATION_ID_RE = /^[A-Za-z0-9:_-]{8,128}$/;

export function normalizePlannerBridgeOperationId(value) {
  const operationId = typeof value === "string" ? value.trim() : "";
  if (!operationId) return { ok: true, operationId: "" };
  if (!OPERATION_ID_RE.test(operationId)) return { ok: false, reason: "invalid_operation_id" };
  return { ok: true, operationId };
}

export function stablePlannerBridgeJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stablePlannerBridgeJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stablePlannerBridgeJson(value[key])}`).join(",")}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

export function plannerBridgeRequestHash(kind, payload) {
  return crypto.createHash("sha256").update(`${String(kind || "")}\n${stablePlannerBridgeJson(payload)}`).digest("hex");
}

export function normalizePlannerBridgeReceipts(profile = {}) {
  const raw = Array.isArray(profile?.plannerBridgeOperationReceipts) ? profile.plannerBridgeOperationReceipts : [];
  return raw
    .filter((entry) => entry && typeof entry === "object" && typeof entry.operationId === "string")
    .slice(-PLANNER_BRIDGE_OPERATION_RECEIPT_LIMIT);
}

export function resolvePlannerBridgeReceipt(profile, { operationId = "", kind = "", requestHash = "" } = {}) {
  if (!operationId) return { status: "none" };
  const receipt = normalizePlannerBridgeReceipts(profile).find((entry) => entry.operationId === operationId);
  if (!receipt) return { status: "missing" };
  if (receipt.kind !== kind || receipt.requestHash !== requestHash) {
    return { status: "mismatch", reason: "operation_id_reused" };
  }
  return { status: "replay", result: jsonSafeClone(receipt.result), createdAt: receipt.createdAt || null };
}

export function appendPlannerBridgeReceipt(profile, {
  operationId = "",
  kind = "",
  requestHash = "",
  result = null,
  now = new Date(),
} = {}) {
  if (!operationId) return normalizePlannerBridgeReceipts(profile);
  const prior = normalizePlannerBridgeReceipts(profile).filter((entry) => entry.operationId !== operationId);
  prior.push({
    operationId,
    kind,
    requestHash,
    result: jsonSafeClone(result),
    createdAt: now.toISOString(),
  });
  return prior.slice(-PLANNER_BRIDGE_OPERATION_RECEIPT_LIMIT);
}

function jsonSafeClone(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
