import { buildLegacyTrackerCandidates } from "./trackerLegacyAdapters.js";

function stickerSettings(title, emoji, enabled = false) {
  return { enabled, title, emoji, placementMode: "timeline", time: enabled ? "09:00" : "", type: "reminder" };
}

export const DEFAULT_TRACKERS = [
  { id: "family-a", title: "联系外婆", emoji: "📞", enabled: true, schedule: { kind: "interval", every: 7, unit: "day" }, goal: { aggregation: "occurrence", target: 1, unit: "times" }, evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }], stickerSettings: stickerSettings("该联系外婆啦", "📞", true) },
  { id: "family-b", title: "联系其他家人", emoji: "👨‍👩‍👧", enabled: true, requiresSetup: true, schedule: null, goal: null, evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "family-b" }], stickerSettings: stickerSettings("联系其他家人", "👨‍👩‍👧") },
  { id: "exercise-complete", title: "完整运动", emoji: "🏃", enabled: true, schedule: { kind: "period", period: "week" }, goal: { aggregation: "active_days", target: 4, unit: "days" }, evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "exercise-complete" }], stickerSettings: stickerSettings("完整运动", "🏃") },
  { id: "light-movement", title: "轻量活动", emoji: "🚶", enabled: true, requiresSetup: true, schedule: null, goal: null, evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "light-movement" }], stickerSettings: stickerSettings("轻量活动", "🚶") },
  { id: "reading", title: "阅读", emoji: "📚", enabled: true, schedule: { kind: "period", period: "month" }, goal: { aggregation: "sum", target: 720, unit: "minutes" }, evidenceBindings: [{ type: "reviewFieldPath", path: ["fields", "study.reading.totalMinutes"], valueType: "duration" }], stickerSettings: stickerSettings("阅读", "📚") },
  { id: "writing", title: "写作/创作", emoji: "✍️", enabled: true, requiresSetup: true, schedule: null, goal: null, evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "writing" }], stickerSettings: stickerSettings("写作/创作", "✍️") },
  { id: "mask", title: "面膜", emoji: "🧖", enabled: true, schedule: { kind: "interval", every: 3, unit: "day" }, goal: { aggregation: "occurrence", target: 1, unit: "times" }, evidenceBindings: [{ type: "legacyMaskField" }], stickerSettings: stickerSettings("该敷面膜啦", "🧖") },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveDefaultWithLegacy(defaultTracker, legacyCandidate) {
  if (!legacyCandidate) return clone(defaultTracker);
  const merged = {
    ...clone(defaultTracker),
    ...legacyCandidate,
    schedule: legacyCandidate.schedule || clone(defaultTracker.schedule),
    goal: legacyCandidate.goal || clone(defaultTracker.goal),
    evidenceBindings: legacyCandidate.evidenceBindings || clone(defaultTracker.evidenceBindings),
  };
  if (merged.requiresSetup && merged.schedule && merged.goal) merged.requiresSetup = false;
  return merged;
}

// Accepts either the legacy array signature or the complete profile object.
// Stored same-id tracker objects win unchanged; legacy data only fills a
// missing built-in tracker and is never inferred from a title.
export function resolveEffectiveTrackers(profileOrTrackers) {
  const profile = Array.isArray(profileOrTrackers) ? { trackers: profileOrTrackers } : profileOrTrackers || {};
  const userTrackers = Array.isArray(profile.trackers) ? profile.trackers : [];
  const userIds = new Set(userTrackers.map((tracker) => tracker?.id));
  const legacyCandidates = buildLegacyTrackerCandidates(profile);
  const missingDefaults = DEFAULT_TRACKERS.filter((tracker) => !userIds.has(tracker.id)).map((tracker) => resolveDefaultWithLegacy(tracker, legacyCandidates.get(tracker.id)));
  return [...userTrackers, ...missingDefaults];
}
