const flagNames = [
  "agentSnapshot",
  "autosave",
  "localRecovery",
  "catkeeperSender",
  "lifeMaintenance",
  "newStatistics",
  "dynamicContinuousBlocks",
];

/** Development-only isolation: append ?plannerDisable=agentSnapshot,autosave to a local Vite URL. */
export function readPlannerFeatureFlags(search = typeof window === "undefined" ? "" : window.location.search) {
  const isDev = Boolean(import.meta.env?.DEV);
  const disabled = isDev ? new Set(new URLSearchParams(search).get("plannerDisable")?.split(",").map((item) => item.trim()).filter(Boolean)) : new Set();
  return Object.fromEntries(flagNames.map((name) => [name, !disabled.has(name)]));
}

// Opt-IN (default OFF), unlike the flags above. Guards the unified tracker
// fact layer (trackerReconcileJobs / completionEvents / TrackerFacts) — a
// new Firestore write path added alongside the pre-existing review tracker,
// not yet verified in production.
//
// Priority (highest first):
//   1. ?enableUnifiedTracker=1  -> on
//   2. ?enableUnifiedTracker=0  -> off, overrides VITE_ENABLE_UNIFIED_TRACKER
//   3. no recognized URL param  -> falls back to VITE_ENABLE_UNIFIED_TRACKER
//   4. anything else (missing env, or an unrecognized param value)  -> off
//
// The URL param only takes effect in the browser tab where that URL was
// opened — it is a per-tab query-string switch, NOT a uid allowlist; it
// does not persist across tabs, reloads without the param, or other
// accounts, and does not touch Firestore user data or auth in any way.
// `envValue` is injectable so this stays testable under plain `node:test`
// (import.meta.env isn't populated outside a Vite build).
export function readUnifiedTrackerFlag(search = typeof window === "undefined" ? "" : window.location.search, envValue = import.meta.env?.VITE_ENABLE_UNIFIED_TRACKER) {
  const param = new URLSearchParams(search).get("enableUnifiedTracker");
  if (param === "1") return true;
  if (param === "0") return false;
  if (param === null) return envValue === "true";
  return false; // unrecognized param value — never falls through to env
}

// Pure gating predicates for the three places the unified tracker layer's
// on/off switch matters — kept here (Firestore/React-free) so they're
// directly unit-testable, mirroring how trackerReconcilePlanner.js keeps
// its decision logic separate from trackerReconcileFirestore.js's wiring.
export function shouldEnqueueUnifiedTrackerJob(enableUnifiedTracker) {
  return enableUnifiedTracker === true;
}

export function shouldRunUnifiedTrackerSweep({ enableUnifiedTracker, isFirebaseConfigured, uid } = {}) {
  return Boolean(enableUnifiedTracker && isFirebaseConfigured && uid);
}

export function shouldShowUnifiedTrackerBanner({ enableUnifiedTracker, isFirebaseConfigured } = {}) {
  return Boolean(enableUnifiedTracker && isFirebaseConfigured);
}

// Default-OFF, opt-in UI flags for the study-target / baseline-plan /
// Focus-timeline feature set (still being verified). Same priority order as
// readUnifiedTrackerFlag: URL param wins (both directions), otherwise falls
// back to the matching VITE_ env var, otherwise off. Kept as one shared
// reader (readOptInPlannerFlag) instead of three near-duplicate functions.
function readOptInPlannerFlag(paramName, search, envValue) {
  const param = new URLSearchParams(search).get(paramName);
  if (param === "1") return true;
  if (param === "0") return false;
  if (param === null) return envValue === "true";
  return false;
}

export function readNewPlannerUiFlags(search = typeof window === "undefined" ? "" : window.location.search, env = typeof import.meta !== "undefined" ? import.meta.env : {}) {
  return {
    studyTargetDefaultsEnabled: readOptInPlannerFlag("studyTargetDefaultsEnabled", search, env?.VITE_STUDY_TARGET_DEFAULTS_ENABLED),
    focusTimelineTrackEnabled: readOptInPlannerFlag("focusTimelineTrackEnabled", search, env?.VITE_FOCUS_TIMELINE_TRACK_ENABLED),
    baselinePlanTrackEnabled: readOptInPlannerFlag("baselinePlanTrackEnabled", search, env?.VITE_BASELINE_PLAN_TRACK_ENABLED),
  };
}
