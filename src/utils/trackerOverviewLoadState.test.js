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

test("tracker overview facts: a non-array loader result is coerced to empty but still ready", async () => {
  const result = await resolveTrackerOverviewFacts({ loadFacts: async () => undefined, trackers: [{ id: "family-a" }], targetDate: "2026-08-01" });
  assert.deepEqual(result, { status: "ready", facts: [], error: "" });
});

test("tracker overview facts: a missing loader is an explicit error, never a silent loading hang", async () => {
  const result = await resolveTrackerOverviewFacts({ loadFacts: undefined, trackers: [{ id: "family-a" }], targetDate: "2026-08-01" });
  assert.equal(result.status, "error");
  assert.match(result.error, /读取服务不可用/);
});
