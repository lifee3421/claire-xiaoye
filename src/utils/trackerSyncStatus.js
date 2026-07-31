// Structured tracker-sync failure/banner state — replaces the old blind
// `.catch(() => setTrackerSyncStatus("sync_failed"))` pattern that
// discarded the real error object entirely, making a genuine production
// failure (e.g. a missing Firestore composite index, a denied-by-rules
// read/write) indistinguishable from any other failure and impossible to
// diagnose from the UI or even the browser console.
//
// Pure/React-free so the classification and copy-selection logic is
// directly unit-testable.

export const TRACKER_SYNC_PHASES = {
  STARTUP_SWEEP: "startup_sweep", // app-startup retryPendingReconcileJobsForUser
  TAB_SWEEP: "tab_sweep", // entering settlement/schedule tab's retryPendingReconcileJobsForUser
  SETTLEMENT_RECONCILE: "settlement_reconcile", // runSettlementReconcileJob right after a save
  STICKER_SYNC: "sticker_sync", // syncTrackerStickersForDate / fetchTrackerFacts / applyTrackerStickerSync
};

// Firestore SDK errors carry a machine-readable `.code` (e.g.
// "permission-denied", "failed-precondition" for a missing composite
// index, "unavailable"). Falls back to "unknown" for anything else (a
// thrown string, a plain Error with no .code, etc).
export function classifyErrorCode(error) {
  if (error && typeof error === "object" && typeof error.code === "string" && error.code) return error.code;
  return "unknown";
}

// Never includes review text, tokens, or any user-authored content — only
// the Firestore/JS error's own message, which is a fixed, generic string
// (e.g. "Missing or insufficient permissions.", "The query requires an
// index...") with no user data in it.
export function extractErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "未知错误";
}

// Which retry action a failure of this phase should trigger — see
// App.jsx's handleRetryTrackerSync. A settlement_reconcile failure with a
// real jobId re-runs exactly that job; anything else (startup/tab sweep,
// or a settlement_reconcile failure that never even got a jobId — e.g. the
// save's own transaction never enqueued one) re-runs the general sweep +
// resync; a sticker-only failure only re-tries the sticker step, since the
// reconcile itself may have already succeeded.
export function resolveRetryMode(phase, jobId) {
  if (phase === TRACKER_SYNC_PHASES.SETTLEMENT_RECONCILE && jobId) return "reconcile_job";
  if (phase === TRACKER_SYNC_PHASES.STICKER_SYNC) return "sticker_only";
  return "sweep";
}

export function bannerTextForFailure(phase) {
  switch (phase) {
    case TRACKER_SYNC_PHASES.SETTLEMENT_RECONCILE:
      return "复盘已保存，但追踪数据同步失败";
    case TRACKER_SYNC_PHASES.STICKER_SYNC:
      return "追踪贴纸刷新失败";
    case TRACKER_SYNC_PHASES.STARTUP_SWEEP:
    case TRACKER_SYNC_PHASES.TAB_SWEEP:
      return "追踪数据刷新失败";
    default:
      return "追踪同步失败";
  }
}

// Fine-grained diagnostic label, distinct from `phase` (which only exists
// to route the retry button — see resolveRetryMode). `stage` is what
// actually answers "which step broke": reconcile_failed (settlement
// reconcile itself, whether triggered by a save or a sweep),
// tracker_facts_failed (fetchTrackerFacts), sticker_apply_failed (the
// planTrackerSticker/applyTrackerStickerPlan decision), draft_persist_failed
// (the commitDraftChange write that actually lands the sticker in the
// schedule draft).
export const TRACKER_SYNC_STAGES = {
  RECONCILE_FAILED: "reconcile_failed",
  TRACKER_FACTS_FAILED: "tracker_facts_failed",
  STICKER_APPLY_FAILED: "sticker_apply_failed",
  DRAFT_PERSIST_FAILED: "draft_persist_failed",
};

export function buildTrackerSyncFailure({ phase, stage, error, jobId = null, date = null } = {}) {
  return {
    status: "sync_failed",
    phase,
    stage: stage || (phase === TRACKER_SYNC_PHASES.STICKER_SYNC ? TRACKER_SYNC_STAGES.STICKER_APPLY_FAILED : TRACKER_SYNC_STAGES.RECONCILE_FAILED),
    code: classifyErrorCode(error),
    message: extractErrorMessage(error),
    jobId: jobId || null,
    date: date || null,
    retryMode: resolveRetryMode(phase, jobId),
  };
}

/**
 * Records a tracker-sync failure for diagnostics (console.error with
 * structured, PII-free fields — phase/code/message/jobId/date only, never
 * review content or tokens) and returns the structured failure object for
 * the caller to put into React state. This is the ONE place a tracker-sync
 * catch block should funnel into — never a bare `.catch(() => {})` that
 * discards the real error.
 */
export function recordTrackerSyncFailure({ phase, stage, error, jobId = null, date = null } = {}) {
  const failure = buildTrackerSyncFailure({ phase, stage, error, jobId, date });
  // eslint-disable-next-line no-console -- intentional structured diagnostic, not a UI leak
  console.error("[trackerSync]", { phase: failure.phase, stage: failure.stage, code: failure.code, message: failure.message, jobId: failure.jobId, date: failure.date });
  return failure;
}
