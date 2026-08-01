import test from "node:test";
import assert from "node:assert/strict";
import {
  readUnifiedTrackerFlag,
  shouldEnqueueUnifiedTrackerJob,
  shouldRunUnifiedTrackerSweep,
  shouldShowUnifiedTrackerBanner,
  readNewPlannerUiFlags,
} from "./plannerFeatureFlags.js";

// --- readUnifiedTrackerFlag: priority order (default ON, personal deploy) -

test("readUnifiedTrackerFlag: no param at all -> true (default on)", () => {
  assert.equal(readUnifiedTrackerFlag(""), true);
});

test("readUnifiedTrackerFlag: ?enableUnifiedTracker=1 -> true (explicit, same as default)", () => {
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=1"), true);
});

test("readUnifiedTrackerFlag: ?enableUnifiedTracker=0 -> false (emergency rollback, highest priority)", () => {
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=0"), false);
});

test("readUnifiedTrackerFlag: an unrecognized param value still defaults to on, never falls back to off", () => {
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=yes"), true);
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=true"), true);
  assert.equal(readUnifiedTrackerFlag("?enableUnifiedTracker=2"), true);
});

test("readUnifiedTrackerFlag: unrelated query params are ignored -> still on", () => {
  assert.equal(readUnifiedTrackerFlag("?foo=bar"), true);
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
// Default ON for this personal/single-user deployment (matches
// readUnifiedTrackerFlag's priority order) — must render with no URL param
// and without depending on any Vercel/VITE_ env var being configured.

test("readNewPlannerUiFlags: no param at all -> all three default to true", () => {
  const flags = readNewPlannerUiFlags("");
  assert.deepEqual(flags, { studyTargetDefaultsEnabled: true, focusTimelineTrackEnabled: true, baselinePlanTrackEnabled: true });
});

test("readNewPlannerUiFlags: each flag can be independently disabled via ?flag=0", () => {
  assert.equal(readNewPlannerUiFlags("?studyTargetDefaultsEnabled=0").studyTargetDefaultsEnabled, false);
  assert.equal(readNewPlannerUiFlags("?focusTimelineTrackEnabled=0").focusTimelineTrackEnabled, false);
  assert.equal(readNewPlannerUiFlags("?baselinePlanTrackEnabled=0").baselinePlanTrackEnabled, false);
});

test("readNewPlannerUiFlags: ?flag=1 is explicit, same as the default", () => {
  assert.equal(readNewPlannerUiFlags("?studyTargetDefaultsEnabled=1").studyTargetDefaultsEnabled, true);
  assert.equal(readNewPlannerUiFlags("?focusTimelineTrackEnabled=1").focusTimelineTrackEnabled, true);
  assert.equal(readNewPlannerUiFlags("?baselinePlanTrackEnabled=1").baselinePlanTrackEnabled, true);
});

test("readNewPlannerUiFlags: unrelated query params are ignored -> still all on", () => {
  const flags = readNewPlannerUiFlags("?foo=bar");
  assert.deepEqual(flags, { studyTargetDefaultsEnabled: true, focusTimelineTrackEnabled: true, baselinePlanTrackEnabled: true });
});

test("readNewPlannerUiFlags: only the disabled flag is turned off, the other two stay on", () => {
  const flags = readNewPlannerUiFlags("?focusTimelineTrackEnabled=0");
  assert.deepEqual(flags, { studyTargetDefaultsEnabled: true, focusTimelineTrackEnabled: false, baselinePlanTrackEnabled: true });
});
