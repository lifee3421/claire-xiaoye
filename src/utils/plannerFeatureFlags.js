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

// Default ON for this personal/single-user deployment — the unified tracker
// fact layer (trackerReconcileJobs / completionEvents / TrackerFacts) is now
// the live path, not an opt-in trial. VITE_ENABLE_UNIFIED_TRACKER is no
// longer consulted at all; ?enableUnifiedTracker=0 is kept purely as an
// emergency per-tab kill switch.
//
// Priority (highest first):
//   1. ?enableUnifiedTracker=0  -> forced off (emergency rollback)
//   2. ?enableUnifiedTracker=1  -> forced on (explicit, same as default)
//   3. no recognized URL param (including none at all)  -> on by default
//
// The URL param only takes effect in the browser tab where that URL was
// opened — it is a per-tab query-string switch, NOT a uid allowlist; it
// does not persist across tabs, reloads without the param, or other
// accounts, and does not touch Firestore user data or auth in any way.
export function readUnifiedTrackerFlag(search = typeof window === "undefined" ? "" : window.location.search) {
  const param = new URLSearchParams(search).get("enableUnifiedTracker");
  if (param === "0") return false;
  return true; // "1", any other value, or absent — all default to on
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
