import test from "node:test";
import assert from "node:assert/strict";
import {
  readUnifiedTrackerFlag,
  shouldEnqueueUnifiedTrackerJob,
  shouldRunUnifiedTrackerSweep,
  shouldShowUnifiedTrackerBanner,
  readNewPlannerUiFlags,
} from "./plannerFeatureFlags.js";

// --- readUnifiedTrackerFlag: priority order ---------------------------

test("readUnifiedTrackerFlag: no param, no env -> false (default off)", () => {
  assert.equal(readUnifiedTrackerFlag("", undefined), false);
});

test("readUnifiedTrackerFlag: no param, env='true' -> true", () => {
  assert.equal(readUnifiedTrackerFlag("", "true"), true);
});

test("readUnifiedTrackerFlag: no param, env='false' -> false", () => {
  assert.equal(readUnifiedTrackerFlag("", "false"), false);
});

test("readUnifiedTrackerFlag: ?enableUnifiedTracker=1, env unset -> true", () => {
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=1", undefined), true);
});

test("readUnifiedTrackerFlag: ?enableUnifiedTracker=1, env='true' -> true", () => {
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=1", "true"), true);
});

test("readUnifiedTrackerFlag: ?enableUnifiedTracker=0 overrides env='true' -> false", () => {
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=0", "true"), false);
});

test("readUnifiedTrackerFlag: ?enableUnifiedTracker=0, env unset -> false", () => {
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=0", undefined), false);
});

test("readUnifiedTrackerFlag: unrecognized param value does not enable, even with env='true'", () => {
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=yes", "true"), false);
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=true", "true"), false);
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=2", "true"), false);
});

test("readUnifiedTrackerFlag: unrelated query params are ignored, falls back to env", () => {
  assert.equal(readUnifiedTrackerFlag("?foo=bar", "true"), true);
  assert.equal(readUnifiedTrackerFlag("?foo=bar", undefined), false);
});

// --- shouldEnqueueUnifiedTrackerJob: settlement save -> job write ------

test("shouldEnqueueUnifiedTrackerJob: default off -> save settlement does not enqueue a trackerReconcileJob", () => {
  assert.equal(shouldEnqueueUnifiedTrackerJob(false), false);
  assert.equal(shouldEnqueueUnifiedTrackerJob(undefined), false);
});

test("shouldEnqueueUnifiedTrackerJob: enabled -> save settlement enqueues a trackerReconcileJob", () => {
  assert.equal(shouldEnqueueUnifiedTrackerJob(true), true);
});

// --- shouldRunUnifiedTrackerSweep: startup/tab-entry retry sweep -------

test("shouldRunUnifiedTrackerSweep: default off -> retryPendingReconcileJobsForUser is not called", () => {
  assert.equal(shouldRunUnifiedTrackerSweep({ enableUnifiedTracker: false, isFirebaseConfigured: true, uid: "u1" }), false);
});

test("shouldRunUnifiedTrackerSweep: enabled but signed out or demo mode -> still does not run", () => {
  assert.equal(shouldRunUnifiedTrackerSweep({ enableUnifiedTracker: true, isFirebaseConfigured: false, uid: "u1" }), false);
  assert.equal(shouldRunUnifiedTrackerSweep({ enableUnifiedTracker: true, isFirebaseConfigured: true, uid: undefined }), false);
});

test("shouldRunUnifiedTrackerSweep: enabled, configured, signed in -> runs", () => {
  assert.equal(shouldRunUnifiedTrackerSweep({ enableUnifiedTracker: true, isFirebaseConfigured: true, uid: "u1" }), true);
});

// --- shouldShowUnifiedTrackerBanner: "追踪状态已同步" banner ------------

test("shouldShowUnifiedTrackerBanner: default off -> banner is not shown, even when Firebase is configured", () => {
  assert.equal(shouldShowUnifiedTrackerBanner({ enableUnifiedTracker: false, isFirebaseConfigured: true }), false);
});

test("shouldShowUnifiedTrackerBanner: enabled but demo mode (no Firebase) -> still hidden", () => {
  assert.equal(shouldShowUnifiedTrackerBanner({ enableUnifiedTracker: true, isFirebaseConfigured: false }), false);
});

test("shouldShowUnifiedTrackerBanner: enabled and configured -> shown", () => {
  assert.equal(shouldShowUnifiedTrackerBanner({ enableUnifiedTracker: true, isFirebaseConfigured: true }), true);
});

// --- readNewPlannerUiFlags: studyTargetDefaults / focusTimelineTrack / baselinePlanTrack ---

test("readNewPlannerUiFlags: default off with no params/env", () => {
  const flags = readNewPlannerUiFlags("", {});
  assert.deepEqual(flags, { studyTargetDefaultsEnabled: false, focusTimelineTrackEnabled: false, baselinePlanTrackEnabled: false });
});

test("readNewPlannerUiFlags: each flag can be independently enabled via its own URL param", () => {
  assert.equal(readNewPlannerUiFlags("?studyTargetDefaultsEnabled=1", {}).studyTargetDefaultsEnabled, true);
  assert.equal(readNewPlannerUiFlags("?focusTimelineTrackEnabled=1", {}).focusTimelineTrackEnabled, true);
  assert.equal(readNewPlannerUiFlags("?baselinePlanTrackEnabled=1", {}).baselinePlanTrackEnabled, true);
});

test("readNewPlannerUiFlags: falls back to VITE_* env vars when no URL param is present", () => {
  const flags = readNewPlannerUiFlags("", { VITE_STUDY_TARGET_DEFAULTS_ENABLED: "true", VITE_FOCUS_TIMELINE_TRACK_ENABLED: "true", VITE_BASELINE_PLAN_TRACK_ENABLED: "true" });
  assert.deepEqual(flags, { studyTargetDefaultsEnabled: true, focusTimelineTrackEnabled: true, baselinePlanTrackEnabled: true });
});

test("readNewPlannerUiFlags: ?flag=0 overrides an on env var", () => {
  const flags = readNewPlannerUiFlags("?studyTargetDefaultsEnabled=0", { VITE_STUDY_TARGET_DEFAULTS_ENABLED: "true" });
  assert.equal(flags.studyTargetDefaultsEnabled, false);
});
