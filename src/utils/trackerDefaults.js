import { buildLegacyTrackerCandidates } from "./trackerLegacyAdapters.js";

function stickerSettings(title, emoji) {
  return { enabled: false, title, emoji, placementMode: "sticker_bar", time: "", type: "reminder" };
}

// Bumped whenever built-in tracker evidence bindings change in a way that
// requires overwriting whatever is stored in the user's profile. Only
// evidenceBindings and this version field are touched — user settings
// (title, schedule, goal, enabled, stickerSettings) are never overwritten.
export const BUILTIN_TRACKER_BINDING_VERSION = 3;

// Tracker IDs that have been retired from the built-in set. They no longer
// appear in the effective tracker list, migration preview, PlannerContext, or
// scheduler. Existing CompletionEvents for these IDs are left untouched in
// Firestore — only new event generation stops. If a retired ID is still
// present in profile.trackers it is silently excluded from resolveEffectiveTrackers.
export const DEPRECATED_BUILTIN_IDS = new Set(["light-movement"]);

// Canonical evidence bindings for each active built-in tracker. Derived from
// the authoritative review schema (dailyReviewSchema.js). Fields are flat-map
// keys in reviewData.fields, so ["fields", "family.contact.grandmother.duration"]
// reads reviewData.fields["family.contact.grandmother.duration"] — the dot is
// part of the key string, not a path separator.
//
// Ordering within each array matters: extractEvidenceFromSettlement short-
// circuits on the first match (OR semantics), so higher-priority sources
// come first. For trackers with legacy + new schema sources, the canonical
// new-schema binding comes first so fresh settlements resolve correctly, and
// the legacy binding acts as a fallback for older settlements.
export const BUILTIN_EVIDENCE_BINDINGS = {
  // family.contact.grandmother.duration / family.contact.parent.duration are
  // static schema fields under reviewData.fields, not dynamic categoryEntries.
  "family-a": [
    { type: "reviewFieldPath", path: ["fields", "family.contact.grandmother.duration"], valueType: "duration" },
    { type: "legacyMaintenanceId", maintenanceId: "family-a" },
  ],
  "family-b": [
    { type: "reviewFieldPath", path: ["fields", "family.contact.parent.duration"], valueType: "duration" },
    { type: "legacyMaintenanceId", maintenanceId: "family-b" },
  ],
  // Mask uses two sources because the field moved between schema versions:
  //   old (pre-schema-v2): health.maskStatus = "已敷"  → legacyMaskField
  //   new (schema-v2+):    reviewData.fields["selfcare.today.mask"] = "是" → reviewFieldPath
  // "未确认" / "否/未确认" / "否" are never evidence — legacyMaskField already
  // rejects them, and select-matcher "是" only matches the exact string "是".
  "mask": [
    { type: "legacyMaskField" },
    { type: "reviewFieldPath", path: ["fields", "selfcare.today.mask"], valueType: "select", matcher: "是" },
  ],
  // Single exercise tracker: any exercise.today.totalMinutes > 0 counts.
  // Legacy exerciseMinutes direct field is covered as a fallback.
  "exercise-complete": [
    { type: "reviewFieldPath", path: ["fields", "exercise.today.totalMinutes"], valueType: "duration" },
    { type: "reviewFieldPath", path: ["exerciseMinutes"], valueType: "duration" },
    { type: "legacyMaintenanceId", maintenanceId: "exercise-complete" },
  ],
  "reading": [
    { type: "reviewFieldPath", path: ["fields", "study.reading.totalMinutes"], valueType: "duration" },
  ],
  // "写作/创作" maps to hobby.creativeWriting.duration ("小说创作").
  // Singing/guitar/perler-beads are separate hobby fields and are not covered.
  "writing": [
    { type: "reviewFieldPath", path: ["fields", "hobby.creativeWriting.duration"], valueType: "duration" },
    { type: "legacyMaintenanceId", maintenanceId: "writing" },
  ],
};

const BUILTIN_IDS = new Set(Object.keys(BUILTIN_EVIDENCE_BINDINGS));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Applies the canonical evidence bindings to a stored built-in tracker when
// its evidenceBindingVersion is behind BUILTIN_TRACKER_BINDING_VERSION.
// Only evidenceBindings and evidenceBindingVersion are updated; every other
// user-configurable field (title, schedule, goal, enabled, stickerSettings)
// is left exactly as stored. Deprecated trackers are left as-is (they are
// filtered out by resolveEffectiveTrackers, not modified).
function applyBuiltinBindingUpgrade(stored) {
  if (!stored?.id || !BUILTIN_IDS.has(stored.id)) return stored;
  if ((stored.evidenceBindingVersion || 0) >= BUILTIN_TRACKER_BINDING_VERSION) return stored;
  return {
    ...stored,
    evidenceBindings: clone(BUILTIN_EVIDENCE_BINDINGS[stored.id]),
    evidenceBindingVersion: BUILTIN_TRACKER_BINDING_VERSION,
  };
}

// 6 active built-in trackers. exercise-complete is the single exercise tracker
// (title: "运动"). light-movement is retired — see DEPRECATED_BUILTIN_IDS.
export const DEFAULT_TRACKERS = [
  { id: "family-a", title: "联系外婆", emoji: "📞", enabled: true, schedule: { kind: "interval", every: 7, unit: "day" }, goal: { aggregation: "occurrence", target: 1, unit: "times" }, evidenceBindings: clone(BUILTIN_EVIDENCE_BINDINGS["family-a"]), evidenceBindingVersion: BUILTIN_TRACKER_BINDING_VERSION, stickerSettings: stickerSettings("联系外婆", "📞") },
  { id: "family-b", title: "联系其他家人", emoji: "👨‍👩‍👧", enabled: true, requiresSetup: true, schedule: null, goal: null, evidenceBindings: clone(BUILTIN_EVIDENCE_BINDINGS["family-b"]), evidenceBindingVersion: BUILTIN_TRACKER_BINDING_VERSION, stickerSettings: stickerSettings("联系其他家人", "👨‍👩‍👧") },
  { id: "exercise-complete", title: "运动", emoji: "🏃", enabled: true, schedule: { kind: "period", period: "week" }, goal: { aggregation: "active_days", target: 4, unit: "days" }, evidenceBindings: clone(BUILTIN_EVIDENCE_BINDINGS["exercise-complete"]), evidenceBindingVersion: BUILTIN_TRACKER_BINDING_VERSION, stickerSettings: stickerSettings("运动", "🏃") },
  { id: "reading", title: "阅读", emoji: "📚", enabled: true, schedule: { kind: "period", period: "month" }, goal: { aggregation: "sum", target: 720, unit: "minutes" }, evidenceBindings: clone(BUILTIN_EVIDENCE_BINDINGS["reading"]), evidenceBindingVersion: BUILTIN_TRACKER_BINDING_VERSION, stickerSettings: stickerSettings("阅读", "📚") },
  { id: "writing", title: "写作/创作", emoji: "✍️", enabled: true, requiresSetup: true, schedule: null, goal: null, evidenceBindings: clone(BUILTIN_EVIDENCE_BINDINGS["writing"]), evidenceBindingVersion: BUILTIN_TRACKER_BINDING_VERSION, stickerSettings: stickerSettings("写作/创作", "✍️") },
  { id: "mask", title: "面膜", emoji: "🧖", enabled: true, schedule: { kind: "interval", every: 3, unit: "day" }, goal: { aggregation: "occurrence", target: 1, unit: "times" }, evidenceBindings: clone(BUILTIN_EVIDENCE_BINDINGS["mask"]), evidenceBindingVersion: BUILTIN_TRACKER_BINDING_VERSION, stickerSettings: stickerSettings("该敷面膜啦", "🧖") },
];

function resolveDefaultWithLegacy(defaultTracker, legacyCandidate) {
  if (!legacyCandidate) return clone(defaultTracker);
  const merged = {
    ...clone(defaultTracker),
    ...legacyCandidate,
    schedule: legacyCandidate.schedule || clone(defaultTracker.schedule),
    goal: legacyCandidate.goal || clone(defaultTracker.goal),
    // Built-in bindings are managed by the system upgrade path; legacy adapter
    // data is only used for truly missing built-ins.
    evidenceBindings: clone(defaultTracker.evidenceBindings),
    evidenceBindingVersion: BUILTIN_TRACKER_BINDING_VERSION,
  };
  if (merged.requiresSetup && merged.schedule && merged.goal) merged.requiresSetup = false;
  return merged;
}

// Accepts either the legacy array signature or the complete profile object.
// Stored same-id tracker objects win on all user-configurable fields but
// have their evidence bindings upgraded in memory when behind
// BUILTIN_TRACKER_BINDING_VERSION. Trackers in DEPRECATED_BUILTIN_IDS are
// silently excluded from the result regardless of whether they are in the
// user's stored profile or the default set. Their CompletionEvents in Firestore
// are not affected — only new event generation stops.
export function resolveEffectiveTrackers(profileOrTrackers) {
  const profile = Array.isArray(profileOrTrackers) ? { trackers: profileOrTrackers } : profileOrTrackers || {};
  const rawUserTrackers = Array.isArray(profile.trackers) ? profile.trackers : [];
  const userTrackers = rawUserTrackers
    .filter((t) => !DEPRECATED_BUILTIN_IDS.has(t?.id))
    .map(applyBuiltinBindingUpgrade);
  const userIds = new Set(userTrackers.map((tracker) => tracker?.id));
  const legacyCandidates = buildLegacyTrackerCandidates(profile);
  const missingDefaults = DEFAULT_TRACKERS
    .filter((tracker) => !userIds.has(tracker.id))
    .map((tracker) => resolveDefaultWithLegacy(tracker, legacyCandidates.get(tracker.id)));
  return [...userTrackers, ...missingDefaults];
}
