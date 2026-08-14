import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNER_BRIDGE_OPERATION_RECEIPT_LIMIT,
  appendPlannerBridgeReceipt,
  normalizePlannerBridgeOperationId,
  plannerBridgeRequestHash,
  resolvePlannerBridgeReceipt,
} from "./plannerBridgeIdempotency.js";

test("operation ids are optional for backwards compatibility but malformed ids are rejected", () => {
  assert.deepEqual(normalizePlannerBridgeOperationId(undefined), { ok: true, operationId: "" });
  assert.deepEqual(normalizePlannerBridgeOperationId(""), { ok: true, operationId: "" });
  assert.deepEqual(normalizePlannerBridgeOperationId("snowdust:edit:12345678"), { ok: true, operationId: "snowdust:edit:12345678" });
  assert.equal(normalizePlannerBridgeOperationId("short").ok, false);
  assert.equal(normalizePlannerBridgeOperationId("bad id with spaces").reason, "invalid_operation_id");
});

test("request hashes are stable across object key order but change with payload semantics", () => {
  const a = plannerBridgeRequestHash("planner-ledger", { action: "create", item: { title: "数学", priority: 2 } });
  const b = plannerBridgeRequestHash("planner-ledger", { item: { priority: 2, title: "数学" }, action: "create" });
  const c = plannerBridgeRequestHash("planner-ledger", { action: "create", item: { title: "英语", priority: 2 } });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("same operation id and request hash replays the stored result, while reuse for another request is rejected", () => {
  const now = new Date("2026-08-14T01:00:00.000Z");
  const operationId = "snowdust:ledger:00000001";
  const requestHash = plannerBridgeRequestHash("planner-ledger", { action: "create", item: { title: "数学" } });
  const receipts = appendPlannerBridgeReceipt({}, {
    operationId,
    kind: "planner-ledger",
    requestHash,
    result: { ok: true, id: "ledger-1" },
    now,
  });
  const profile = { plannerBridgeOperationReceipts: receipts };
  const replay = resolvePlannerBridgeReceipt(profile, { operationId, kind: "planner-ledger", requestHash });
  assert.equal(replay.status, "replay");
  assert.deepEqual(replay.result, { ok: true, id: "ledger-1" });

  const mismatch = resolvePlannerBridgeReceipt(profile, {
    operationId,
    kind: "planner-ledger",
    requestHash: plannerBridgeRequestHash("planner-ledger", { action: "create", item: { title: "英语" } }),
  });
  assert.deepEqual(mismatch, { status: "mismatch", reason: "operation_id_reused" });
});

test("receipt history stays bounded on the user document", () => {
  let profile = {};
  for (let index = 0; index < PLANNER_BRIDGE_OPERATION_RECEIPT_LIMIT + 7; index += 1) {
    const operationId = `snowdust:op:${String(index).padStart(8, "0")}`;
    const receipts = appendPlannerBridgeReceipt(profile, {
      operationId,
      kind: "planner-direct-edit",
      requestHash: plannerBridgeRequestHash("planner-direct-edit", { index }),
      result: { outcome: "applied", index },
      now: new Date(1_786_000_000_000 + index * 1_000),
    });
    profile = { plannerBridgeOperationReceipts: receipts };
  }
  assert.equal(profile.plannerBridgeOperationReceipts.length, PLANNER_BRIDGE_OPERATION_RECEIPT_LIMIT);
  assert.equal(profile.plannerBridgeOperationReceipts[0].result.index, 7);
  assert.equal(profile.plannerBridgeOperationReceipts.at(-1).result.index, PLANNER_BRIDGE_OPERATION_RECEIPT_LIMIT + 6);
});
