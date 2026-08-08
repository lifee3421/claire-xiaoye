import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_TRACKER_BINDING_VERSION, DEFAULT_TRACKERS, resolveEffectiveTrackers } from "./trackerDefaults.js";
import { resolveTrackerEvidence } from "./trackerFacts.js";

const defaultIds = ["family-a", "family-b", "exercise-complete", "reading", "writing", "mask"];

test("resolveEffectiveTrackers: an empty profile includes all six defaults", () => {
  assert.deepEqual(resolveEffectiveTrackers({}).map((tracker) => tracker.id), defaultIds);
  assert.deepEqual(resolveEffectiveTrackers([]).map((tracker) => tracker.id), defaultIds);
});

test("resolveEffectiveTrackers: custom trackers are retained alongside every missing default", () => {
  const custom = { id: "custom-water", title: "喝水" };
  const result = resolveEffectiveTrackers({ trackers: [custom] });
  assert.equal(result[0], custom);
  assert.deepEqual(result.slice(1).map((tracker) => tracker.id), defaultIds);
});

test("resolveEffectiveTrackers: a same-id complete user configuration wins unchanged", () => {
  const userOverride = { id: "family-a", title: "我的外婆提醒", enabled: false, schedule: { kind: "interval", every: 9, unit: "day" }, goal: { aggregation: "occurrence", target: 1, unit: "times" }, evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }], evidenceBindingVersion: BUILTIN_TRACKER_BINDING_VERSION, stickerSettings: { enabled: true, title: "我的标题", emoji: "☎️", placementMode: "timeline", time: "19:30" } };
  const result = resolveEffectiveTrackers({ trackers: [userOverride] });
  assert.equal(result.find((tracker) => tracker.id === "family-a"), userOverride);
  assert.equal(result.length, 6);
});

test("resolveEffectiveTrackers: deprecated built-in light-movement is excluded even if present in stored profile", () => {
  const storedLightMovement = { id: "light-movement", title: "轻量活动", enabled: true };
  const result = resolveEffectiveTrackers({ trackers: [storedLightMovement] });
  assert.ok(!result.find((t) => t.id === "light-movement"), "light-movement must not appear in effective list");
  assert.equal(result.length, 6, "all 6 active defaults fill in for the excluded deprecated tracker");
});

test("resolveEffectiveTrackers: explicit legacy maintenance interval is mechanically inherited", () => {
  const familyB = resolveEffectiveTrackers({ healthMaintenanceItems: [{ id: "family-b", name: "家人", intervalDays: 5 }] }).find((tracker) => tracker.id === "family-b");
  assert.deepEqual(familyB.schedule, { kind: "interval", every: 5, unit: "day" });
  assert.deepEqual(familyB.goal, { aggregation: "occurrence", target: 1, unit: "times" });
  assert.equal(familyB.requiresSetup, false);
});

test("defaults with unknown cadence require setup and are never reported overdue", () => {
  const tracker = resolveEffectiveTrackers({}).find((item) => item.id === "writing");
  assert.equal(tracker.requiresSetup, true);
  assert.equal(tracker.stickerSettings.enabled, false);
  const facts = resolveTrackerEvidence(tracker, { events: [], today: "2026-08-01", todaySettlementExists: false });
  assert.equal(facts.scheduleStatus, "requires_setup");
  assert.equal(facts.todayReviewStatus, "not_applicable");
});

test("known defaults retain only confirmed cadence without forcing a family-a-only reminder time", () => {
  const byId = new Map(DEFAULT_TRACKERS.map((tracker) => [tracker.id, tracker]));
  assert.deepEqual(byId.get("family-a").schedule, { kind: "interval", every: 7, unit: "day" });
  assert.deepEqual(byId.get("mask").schedule, { kind: "interval", every: 3, unit: "day" });
  assert.equal(byId.get("exercise-complete").title, "运动");
  assert.deepEqual(byId.get("exercise-complete").goal, { aggregation: "active_days", target: 4, unit: "days" });
  assert.deepEqual(byId.get("reading").goal, { aggregation: "sum", target: 720, unit: "minutes" });
  assert.deepEqual(byId.get("family-a").stickerSettings, { enabled: false, title: "联系外婆", emoji: "📞", placementMode: "sticker_bar", time: "", type: "reminder" });
});
