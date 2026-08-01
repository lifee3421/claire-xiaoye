import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRACKERS, resolveEffectiveTrackers } from "./trackerDefaults.js";
import { buildTrackersForProfileSave, createCustomTracker, normalizeTrackerForSave, validateTrackerDrafts } from "./trackerManagerModel.js";

test("TrackerManager model: seven defaults render from an empty profile and setup items remain explicit", () => {
  const trackers = resolveEffectiveTrackers({});
  assert.equal(trackers.length, 7);
  assert.equal(trackers.find((tracker) => tracker.id === "writing").requiresSetup, true);
});

test("TrackerManager model: stored same-id override and custom tracker coexist with defaults", () => {
  const profile = { trackers: [{ id: "family-a", title: "我的外婆", enabled: false }, { id: "custom-water", title: "喝水" }] };
  const trackers = resolveEffectiveTrackers(profile);
  assert.equal(trackers.find((tracker) => tracker.id === "family-a").title, "我的外婆");
  assert.ok(trackers.some((tracker) => tracker.id === "custom-water"));
  assert.equal(trackers.length, 8);
});

test("TrackerManager model: schedule forms serialize interval, period and deadline", () => {
  const base = DEFAULT_TRACKERS[0];
  assert.deepEqual(normalizeTrackerForSave({ ...base, schedule: { kind: "interval", every: 2, unit: "week" } }).schedule, { kind: "interval", every: 2, unit: "week" });
  assert.deepEqual(normalizeTrackerForSave({ ...base, schedule: { kind: "period", period: "month" } }).schedule, { kind: "period", period: "month" });
  assert.deepEqual(normalizeTrackerForSave({ ...base, schedule: { kind: "deadline", dueDate: "2026-12-31" } }).schedule, { kind: "deadline", dueDate: "2026-12-31" });
});

test("TrackerManager model: sticker_bar has no time requirement, timeline requires legal HH:mm", () => {
  const base = DEFAULT_TRACKERS[0];
  assert.deepEqual(validateTrackerDrafts([{ ...base, stickerSettings: { enabled: true, placementMode: "sticker_bar", title: "x", emoji: "✨", time: "" } }]), []);
  assert.match(validateTrackerDrafts([{ ...base, stickerSettings: { enabled: true, placementMode: "timeline", title: "x", emoji: "✨", time: "" } }]).join(" "), /HH:mm/);
  assert.deepEqual(validateTrackerDrafts([{ ...base, stickerSettings: { enabled: true, placementMode: "timeline", title: "x", emoji: "✨", time: "18:30" } }]), []);
});

test("TrackerManager model: custom ids are stable and save only explicit overrides/custom trackers", () => {
  const custom = createCustomTracker({ idFactory: () => "tracker-stable-1" });
  assert.equal(custom.id, "tracker-stable-1");
  const initial = resolveEffectiveTrackers({});
  const edited = initial.map((tracker) => tracker.id === "family-a" ? { ...tracker, title: "外婆电话" } : tracker).concat({ ...custom, title: "喝水", evidenceBindings: [{ type: "manualReviewField", fieldId: "water" }] });
  const saved = buildTrackersForProfileSave({ initialEffective: initial, editedEffective: edited, storedTrackers: [] });
  assert.deepEqual(saved.map((tracker) => tracker.id), ["family-a", "tracker-stable-1"]);
});

test("TrackerManager model: normalization removes undefined and marks incomplete tracker configuration", () => {
  const tracker = normalizeTrackerForSave({ id: "x", title: "x", emoji: "✨", schedule: null, goal: null, evidenceBindings: [], stickerSettings: { enabled: false, ignored: undefined }, ignored: undefined });
  assert.equal(tracker.requiresSetup, true);
  assert.equal(JSON.stringify(tracker).includes("undefined"), false);
});
