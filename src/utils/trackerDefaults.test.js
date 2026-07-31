import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRACKERS, resolveEffectiveTrackers } from "./trackerDefaults.js";

test("resolveEffectiveTrackers: missing/empty profile.trackers falls back to the built-in defaults alone", () => {
  assert.deepEqual(resolveEffectiveTrackers(undefined), DEFAULT_TRACKERS);
  assert.deepEqual(resolveEffectiveTrackers(null), DEFAULT_TRACKERS);
  assert.deepEqual(resolveEffectiveTrackers([]), DEFAULT_TRACKERS);
});

test("resolveEffectiveTrackers: existing unrelated trackers keep the missing built-in appended, nothing removed", () => {
  const userTrackers = [{ id: "reading", title: "阅读" }];
  const result = resolveEffectiveTrackers(userTrackers);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "reading"); // original order preserved
  assert.equal(result[1].id, "family-a");
});

test("resolveEffectiveTrackers: a user tracker with the same id as a default always wins, even if disabled/edited — never overwritten", () => {
  const userOverride = { id: "family-a", title: "联系外婆（我改过）", enabled: false, schedule: { kind: "interval", every: 3, unit: "day" } };
  const result = resolveEffectiveTrackers([userOverride]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], userOverride); // exact user object, not merged/patched with the default
});

test("resolveEffectiveTrackers: does not mutate the input array or the DEFAULT_TRACKERS constant", () => {
  const userTrackers = [{ id: "reading" }];
  const before = JSON.stringify(DEFAULT_TRACKERS);
  resolveEffectiveTrackers(userTrackers);
  assert.equal(userTrackers.length, 1); // input untouched
  assert.equal(JSON.stringify(DEFAULT_TRACKERS), before); // module-level default untouched
});

test("the built-in 联系外婆 tracker matches the exact spec: interval/7/day, occurrence/1, legacyMaintenanceId family-a, reminder sticker with 📞 at 09:00", () => {
  const tracker = DEFAULT_TRACKERS.find((item) => item.id === "family-a");
  assert.equal(tracker.title, "联系外婆");
  assert.equal(tracker.enabled, true);
  assert.deepEqual(tracker.schedule, { kind: "interval", every: 7, unit: "day" });
  assert.deepEqual(tracker.goal, { aggregation: "occurrence", target: 1, unit: "times" });
  assert.deepEqual(tracker.evidenceBindings, [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }]);
  assert.deepEqual(tracker.stickerSettings, { enabled: true, emoji: "📞", title: "该联系外婆啦", time: "09:00", type: "reminder" });
});
