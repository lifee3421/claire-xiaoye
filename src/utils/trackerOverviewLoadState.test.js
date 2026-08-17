import test from "node:test";
import assert from "node:assert/strict";
import { canApplyTrackerOverviewResult, resolveTrackerOverviewFacts } from "./trackerOverviewLoadState.js";

test("tracker overview facts: an empty CompletionEvent result is ready, not loading", async () => {
  const result = await resolveTrackerOverviewFacts({ trackers: [{ id: "family-a" }], targetDate: "2026-08-01", loadFacts: async () => [] });
  assert.deepEqual(result, { status: "ready", facts: [], error: "" });
});

test("tracker overview facts: rejection is a visible error state, never loading", async () => {
  const result = await resolveTrackerOverviewFacts({ loadFacts: async () => { throw Object.assign(new Error("Missing index"), { code: "failed-precondition" }); } });
  assert.deepEqual(result, { status: "error", facts: [], error: "Missing index" });
});

test("tracker overview facts: date change or unmount rejects stale state updates", () => {
  assert.equal(canApplyTrackerOverviewResult({ active: true, requestId: 2, currentRequestId: 3 }), false);
  assert.equal(canApplyTrackerOverviewResult({ active: false, requestId: 3, currentRequestId: 3 }), false);
  assert.equal(canApplyTrackerOverviewResult({ active: true, requestId: 3, currentRequestId: 3 }), true);
});
