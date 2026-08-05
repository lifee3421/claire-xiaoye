import test from "node:test";
import assert from "node:assert/strict";
import { deleteLatestSettlement, reviseSettlement, rollbackSettlementsTo } from "./dataService.js";
import { __queueQuerySnapshot, __resetFirestoreMock } from "./__test_mocks__/firestore.mock.js";

// We capture API calls by mocking the entry points.
// Since dataService.js imports from "./pointsApi.js" directly, we mock the
// underlying fetch-based `callPoints` but that's hard in ESM. Instead, we
// mock at the transport layer: we override globalThis.fetch which IS mutable,
// and we give the pointsApi a valid base URL so it actually tries to fetch.
let _apiCalls = [];

test.beforeEach(() => {
  __resetFirestoreMock();
  _apiCalls = [];
  // Set global fetch to a mock that records calls and returns realistic results
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body || "{}");
    _apiCalls.push({ url: String(url), action: body.action, payload: body.payload });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        balanceBefore: 100,
        balanceAfter: body.action === "rollback_settlement"
          ? 100 - (body.payload.pointsToRemove || 0)
          : body.action === "rollback_redemption"
            ? 100 + (body.payload.priceToRefund || 0)
            : 103,
        delta: 3,
        action: body.action,
        settlementRevision: 3,
      }),
    };
  };
  // Set a valid base URL so the fetch call doesn't fail parsing
  process.env.__POINTS_API_BASE = "http://test.local";
});

test.afterEach(() => {
  globalThis.fetch = undefined;
  delete process.env.__POINTS_API_BASE;
});

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

test("reviseSettlement: calls points API with settlement + previousSettlement", async () => {
  await reviseSettlement(
    "uid-1",
    { reviewDate: "2026-08-01", pointsAdded: 8 },
    { id: "settlement-1", reviewDate: "2026-08-01", pointsAdded: 5, settlementRevision: 2 },
    100,
    { enableUnifiedTracker: false },
  );

  const call = _apiCalls.find((c) => c.action === "revise_settlement");
  assert.ok(call, "必须有 revise_settlement API 调用，实际调用: " + JSON.stringify(_apiCalls.map(c => c.action)));
  assert.equal(call.payload.settlement.pointsAdded, 8);
  assert.equal(call.payload.previousSettlement.pointsAdded, 5);
});

test("deleteLatestSettlement: calls rollback_settlement API with correct points and IDs", async () => {
  __queueQuerySnapshot([activeEvent("event-1", "settlement-1"), { id: "old-event", data: { state: "retracted", sourceDocumentId: "settlement-1" } }]);
  await deleteLatestSettlement("uid-1", { id: "settlement-1", reviewDate: "2026-08-01", pointsAdded: 5 }, {}, 100);

  const call = _apiCalls.find((c) => c.action === "rollback_settlement");
  assert.ok(call, "必须有 rollback_settlement API 调用: " + JSON.stringify(_apiCalls.map(c => c.action)));
  assert.equal(call.payload.pointsToRemove, 5);
  assert.ok(call.payload.settlementIds.includes("settlement-1"));
  assert.ok(call.payload.eventRetractions.length > 0);
});

test("rollbackSettlementsTo: calls rollback_settlement API with correct settlement IDs", async () => {
  const deleted = [{ id: "settlement-2", pointsAdded: 4 }, { id: "settlement-3", pointsAdded: 6 }];
  __queueQuerySnapshot([activeEvent("event-2", "settlement-2")]);
  __queueQuerySnapshot([activeEvent("event-3", "settlement-3")]);
  await rollbackSettlementsTo("uid-1", deleted, { id: "settlement-1", generatedMinutes: 0 }, 100);

  const call = _apiCalls.find((c) => c.action === "rollback_settlement");
  assert.ok(call, "必须有 rollback_settlement API 调用: " + JSON.stringify(_apiCalls.map(c => c.action)));
  assert.equal(call.payload.pointsToRemove, 10);
  assert.deepEqual(call.payload.settlementIds.sort(), ["settlement-2", "settlement-3"]);
});
