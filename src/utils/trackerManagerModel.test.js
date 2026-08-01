import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRACKERS, resolveEffectiveTrackers } from "./trackerDefaults.js";
import { buildTrackersForProfileSave, createCustomTracker, normalizeTrackerForSave, validateTrackerDrafts } from "./trackerManagerModel.js";

function saveAndReloadFamilyA(edit) {
  const initialEffective = resolveEffectiveTrackers({});
  const editedEffective = initialEffective.map((tracker) => tracker.id === "family-a" ? edit(tracker) : tracker);
  const trackers = buildTrackersForProfileSave({ initialEffective, editedEffective, storedTrackers: [] });
  const payload = trackers.find((tracker) => tracker.id === "family-a");
  const effective = resolveEffectiveTrackers({ trackers }).find((tracker) => tracker.id === "family-a");
  return { before: initialEffective.find((tracker) => tracker.id === "family-a"), payload, effective };
}

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

test("TrackerManager model: editing only the default family-a title persists the complete effective snapshot", () => {
  const { payload, effective } = saveAndReloadFamilyA((tracker) => ({ ...tracker, title: "给外婆打电话" }));
  assert.equal(payload.title, "给外婆打电话");
  assert.equal(payload.enabled, true);
  assert.deepEqual(payload.schedule, { kind: "interval", every: 7, unit: "day" });
  assert.deepEqual(payload.goal, { aggregation: "occurrence", target: 1, unit: "times" });
  assert.deepEqual(payload.evidenceBindings, [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }]);
  assert.deepEqual(payload.stickerSettings, { enabled: false, title: "联系外婆", emoji: "📞", placementMode: "sticker_bar", time: "", type: "reminder" });
  assert.equal(payload.requiresSetup, false);
  assert.equal("createdAt" in payload, false);
  assert.equal("updatedAt" in payload, false);
  assert.deepEqual(effective, payload);
});

test("TrackerManager model: changing only emoji or schedule retains family-a evidence, goal, and sticker settings", () => {
  const emoji = saveAndReloadFamilyA((tracker) => ({ ...tracker, emoji: "☎️" })).payload;
  assert.equal(emoji.emoji, "☎️");
  assert.deepEqual(emoji.evidenceBindings, [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }]);
  assert.equal(emoji.stickerSettings.enabled, false);
  const schedule = saveAndReloadFamilyA((tracker) => ({ ...tracker, schedule: { kind: "interval", every: 9, unit: "day" } })).payload;
  assert.deepEqual(schedule.schedule, { kind: "interval", every: 9, unit: "day" });
  assert.deepEqual(schedule.goal, { aggregation: "occurrence", target: 1, unit: "times" });
  assert.deepEqual(schedule.evidenceBindings, [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }]);
  assert.equal(schedule.stickerSettings.placementMode, "sticker_bar");
});

test("TrackerManager model: explicit sticker enable and sticker_bar placement survive reload without default restoration", () => {
  const enabled = saveAndReloadFamilyA((tracker) => ({ ...tracker, stickerSettings: { ...tracker.stickerSettings, enabled: true } }));
  assert.equal(enabled.payload.stickerSettings.enabled, true);
  assert.equal(enabled.effective.stickerSettings.enabled, true);
  const bar = saveAndReloadFamilyA((tracker) => ({ ...tracker, stickerSettings: { ...tracker.stickerSettings, enabled: true, placementMode: "sticker_bar" } }));
  assert.equal(bar.payload.stickerSettings.placementMode, "sticker_bar");
  assert.equal(bar.payload.stickerSettings.time, "");
  assert.equal(bar.effective.stickerSettings.placementMode, "sticker_bar");
});

test("TrackerManager model: disabling a default tracker survives reload and does not alter its history configuration", () => {
  const { payload, effective } = saveAndReloadFamilyA((tracker) => ({ ...tracker, enabled: false }));
  assert.equal(payload.enabled, false);
  assert.equal(effective.enabled, false);
  assert.deepEqual(effective.evidenceBindings, [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }]);
  assert.deepEqual(effective, payload);
});
