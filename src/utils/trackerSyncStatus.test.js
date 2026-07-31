import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACKER_SYNC_PHASES,
  TRACKER_SYNC_STAGES,
  bannerTextForFailure,
  buildTrackerSyncFailure,
  classifyErrorCode,
  extractErrorMessage,
  recordTrackerSyncFailure,
  resolveRetryMode,
} from "./trackerSyncStatus.js";

test("classifyErrorCode: reads a Firestore-style .code, falls back to unknown", () => {
  assert.equal(classifyErrorCode({ code: "failed-precondition" }), "failed-precondition");
  assert.equal(classifyErrorCode({ code: "permission-denied" }), "permission-denied");
  assert.equal(classifyErrorCode(new Error("plain error, no code")), "unknown");
  assert.equal(classifyErrorCode("a thrown string"), "unknown");
  assert.equal(classifyErrorCode(undefined), "unknown");
});

test("extractErrorMessage: never fabricates content, uses the real Error/string message", () => {
  assert.equal(extractErrorMessage(new Error("The query requires an index.")), "The query requires an index.");
  assert.equal(extractErrorMessage("raw string error"), "raw string error");
  assert.equal(extractErrorMessage(undefined), "未知错误");
});

test("resolveRetryMode: settlement_reconcile WITH a jobId retries that exact job", () => {
  assert.equal(resolveRetryMode(TRACKER_SYNC_PHASES.SETTLEMENT_RECONCILE, "s1:0"), "reconcile_job");
});

test("resolveRetryMode: settlement_reconcile WITHOUT a jobId falls back to a full sweep (the save's own transaction never enqueued one)", () => {
  assert.equal(resolveRetryMode(TRACKER_SYNC_PHASES.SETTLEMENT_RECONCILE, null), "sweep");
});

test("resolveRetryMode: startup/tab sweep failures always retry the sweep, regardless of jobId", () => {
  assert.equal(resolveRetryMode(TRACKER_SYNC_PHASES.STARTUP_SWEEP, null), "sweep");
  assert.equal(resolveRetryMode(TRACKER_SYNC_PHASES.TAB_SWEEP, "some-job"), "sweep");
});

test("resolveRetryMode: sticker_sync failures only retry the sticker step, never the reconcile", () => {
  assert.equal(resolveRetryMode(TRACKER_SYNC_PHASES.STICKER_SYNC, "s1:0"), "sticker_only");
  assert.equal(resolveRetryMode(TRACKER_SYNC_PHASES.STICKER_SYNC, null), "sticker_only");
});

test("bannerTextForFailure: distinct copy per phase — a startup sweep failure is never described as a settlement-save failure", () => {
  assert.equal(bannerTextForFailure(TRACKER_SYNC_PHASES.SETTLEMENT_RECONCILE), "复盘已保存，但追踪数据同步失败");
  assert.equal(bannerTextForFailure(TRACKER_SYNC_PHASES.STARTUP_SWEEP), "追踪数据刷新失败");
  assert.equal(bannerTextForFailure(TRACKER_SYNC_PHASES.TAB_SWEEP), "追踪数据刷新失败");
  assert.equal(bannerTextForFailure(TRACKER_SYNC_PHASES.STICKER_SYNC), "追踪贴纸刷新失败");
  // distinct strings — a caller can never confuse "settlement save failed" with "background refresh failed"
  const texts = new Set(Object.values(TRACKER_SYNC_PHASES).map(bannerTextForFailure));
  assert.equal(texts.size, 3); // sweep + tab share one string by design, reconcile and sticker each have their own
});

test("buildTrackerSyncFailure: assembles the full structured shape the UI/retry logic needs", () => {
  const failure = buildTrackerSyncFailure({
    phase: TRACKER_SYNC_PHASES.SETTLEMENT_RECONCILE,
    error: Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }),
    jobId: "2026-07-27:0",
    date: "2026-07-27",
  });
  assert.deepEqual(failure, {
    status: "sync_failed",
    phase: "settlement_reconcile",
    stage: "reconcile_failed",
    code: "permission-denied",
    message: "Missing or insufficient permissions.",
    jobId: "2026-07-27:0",
    date: "2026-07-27",
    retryMode: "reconcile_job",
  });
});

test("buildTrackerSyncFailure: an explicit stage (e.g. tracker_facts_failed) overrides the phase-based default", () => {
  const failure = buildTrackerSyncFailure({
    phase: TRACKER_SYNC_PHASES.STICKER_SYNC,
    stage: TRACKER_SYNC_STAGES.TRACKER_FACTS_FAILED,
    error: Object.assign(new Error("The query requires an index."), { code: "failed-precondition" }),
    date: "2026-08-03",
  });
  assert.equal(failure.stage, "tracker_facts_failed");
  assert.equal(failure.phase, "sticker_sync");
  assert.equal(failure.retryMode, "sticker_only");
});

test("recordTrackerSyncFailure: logs structured, PII-free diagnostics and returns the failure object — never review text, tokens, or other user content", () => {
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const error = Object.assign(new Error("The query requires an index. You can create it here: https://console.firebase.google.com/..."), { code: "failed-precondition" });
    const failure = recordTrackerSyncFailure({ phase: TRACKER_SYNC_PHASES.TAB_SWEEP, error, jobId: null, date: "2026-07-29" });
    assert.equal(failure.code, "failed-precondition");
    assert.equal(failure.phase, "tab_sweep");
    assert.equal(logs.length, 1);
    const [tag, payload] = logs[0];
    assert.equal(tag, "[trackerSync]");
    assert.deepEqual(Object.keys(payload).sort(), ["code", "date", "jobId", "message", "phase", "stage"]);
    // exactly these 6 diagnostic fields — nothing else was logged (no
    // settlement/draft/review content, no auth token, no arbitrary object)
  } finally {
    console.error = originalConsoleError;
  }
});
