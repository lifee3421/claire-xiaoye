import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDailyStatesEqual, extractCanonicalDailyState, extractPlannerDraftSidecar, replaceCanonicalDailyState } from "./plannerDailyCanonicalState.js";

test("sidecar changes do not count as canonical schedule changes", () => {
  const a = { targetDate: "2026-08-16", todaySegmentOverrides: { a: { manualStart: 600 } }, stickers: [] };
  const b = { ...a, stickers: [{ id: "s1" }], generatedPrompt: "x" };
  assert.equal(canonicalDailyStatesEqual(a, b), true);
  assert.deepEqual(Object.keys(extractPlannerDraftSidecar(b)).sort(), ["generatedPrompt", "stickers"]);
});

test("planner inputs and timeline fields fail closed into canonical state", () => {
  const a = { targetDate: "2026-08-16", targetBedTime: "23:20", todaySegmentOverrides: {} };
  const b = { ...a, targetBedTime: "23:40" };
  assert.equal(canonicalDailyStatesEqual(a, b), false);
  assert.equal(extractCanonicalDailyState(b).targetBedTime, "23:40");
});

test("replace canonical state preserves sidecar and identity", () => {
  const current = { targetDate: "2026-08-16", updatedAt: "old", stickers: [{ id: "s" }], targetBedTime: "23:20", todaySegmentOverrides: { a: {} } };
  const result = replaceCanonicalDailyState(current, { targetBedTime: "23:40", todaySegmentOverrides: {} });
  assert.equal(result.ok, true);
  assert.equal(result.draft.targetDate, "2026-08-16");
  assert.deepEqual(result.draft.stickers, [{ id: "s" }]);
  assert.equal(result.draft.targetBedTime, "23:40");
});
