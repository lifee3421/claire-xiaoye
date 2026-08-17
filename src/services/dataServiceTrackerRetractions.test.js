import test from "node:test";
import assert from "node:assert/strict";
import { deleteLatestSettlement, reviseSettlement, rollbackSettlementsTo } from "./dataService.js";
import { __batchCalls, __queueQuerySnapshot, __resetFirestoreMock } from "./__test_mocks__/firestore.mock.js";

test.beforeEach(() => {
  __resetFirestoreMock();
});

function callsForSingleBatch() {
  assert.equal(__batchCalls.length, 1);
  return __batchCalls[0];
}

function activeEvent(id, settlementId) {
  return {
    id,
    data: {
      trackerId: "family-a",
      sourceDocumentId: settlementId,
      sourceFieldKey: "health.maintenanceCompleted.family-a",
      sourceType: "maintenance",
      sourceRevision: 0,
      state: "active",
    },
  };
}

test("reviseSettlement: writes the next reconcile job with the revised settlement in one batch", async () => {
  await reviseSettlement(
    "uid-1",
    { reviewDate: "2026-08-01", pointsAdded: 8 },
    { id: "settlement-1", reviewDate: "2026-08-01", pointsAdded: 5, settlementRevision: 2 },
    100,
    { enableUnifiedTracker: true },
  );

  const calls = callsForSingleBatch();
  const settlementWrite = calls.find((call) => call.type === "set" && call.ref.path.endsWith("settlements/settlement-1"));
  const jobWrite = calls.find((call) => call.type === "set" && call.ref.path.endsWith("trackerReconcileJobs/settlement-1:3"));
  assert.equal(settlementWrite.payload.settlementRevision, 3);
  assert.equal(jobWrite.payload.settlementId, "settlement-1");
  assert.equal(jobWrite.payload.settlementRevision, 3);
});

test("deleteLatestSettlement: retracts active source events with settlement_deleted in the same batch as the deletion", async () => {
  __queueQuerySnapshot([activeEvent("event-1", "settlement-1"), { id: "old-event", data: { state: "retracted", sourceDocumentId: "settlement-1" } }]);
  await deleteLatestSettlement("uid-1", { id: "settlement-1", pointsAdded: 5 }, {}, 100);

  const calls = callsForSingleBatch();
  const retraction = calls.find((call) => call.type === "set" && call.ref.path.endsWith("completionEvents/event-1"));
  assert.equal(retraction.payload.state, "retracted");
  assert.equal(retraction.payload.retractionReason, "settlement_deleted");
  assert.ok(calls.some((call) => call.type === "delete" && call.ref.path.endsWith("settlements/settlement-1")));
  assert.equal(calls.some((call) => call.type === "set" && call.ref.path.endsWith("completionEvents/old-event")), false);
});

test("rollbackSettlementsTo: retracts only events for the deleted settlements and remains idempotent on a retry", async () => {
  const deleted = [{ id: "settlement-2", pointsAdded: 4 }, { id: "settlement-3", pointsAdded: 6 }];
  __queueQuerySnapshot([activeEvent("event-2", "settlement-2")]);
  __queueQuerySnapshot([activeEvent("event-3", "settlement-3")]);
  await rollbackSettlementsTo("uid-1", deleted, { id: "settlement-1", generatedMinutes: 0 }, 100);

  const calls = callsForSingleBatch();
  assert.ok(calls.some((call) => call.type === "set" && call.ref.path.endsWith("completionEvents/event-2")));
  assert.ok(calls.some((call) => call.type === "set" && call.ref.path.endsWith("completionEvents/event-3")));
  assert.equal(calls.some((call) => call.ref.path.endsWith("completionEvents/event-keep")), false);

  __resetFirestoreMock();
  __queueQuerySnapshot([{ id: "event-2", data: { state: "retracted", sourceDocumentId: "settlement-2" } }]);
  __queueQuerySnapshot([{ id: "event-3", data: { state: "retracted", sourceDocumentId: "settlement-3" } }]);
  await rollbackSettlementsTo("uid-1", deleted, { id: "settlement-1", generatedMinutes: 0 }, 90);
  const retryCalls = callsForSingleBatch();
  assert.equal(retryCalls.some((call) => call.type === "set" && call.ref.path.includes("completionEvents/")), false);
});
