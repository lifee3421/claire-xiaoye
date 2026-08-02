/**
 * Return whether the browser-local Cyberboss connection is actually usable.
 * `enabled` alone is not enough: the sender also requires baseUrl + token.
 */
export function isSnowDustConnectionReady(settings = {}) {
  return settings?.enabled === true
    && Boolean(String(settings?.baseUrl || "").trim())
    && Boolean(String(settings?.token || "").trim());
}

/**
 * Derive a single human-readable Snow-dust sync status from the actual
 * underlying state sources — never invents a second status vocabulary.
 *
 * Priority (highest wins):
 *   1. syncing             — an in-flight send is active (must win over needs_first_send)
 *   2. partial_success     — Cyberboss accepted ReminderPlan, but accepted revision
 *                            couldn't be persisted to Firestore.  The plan IS
 *                            received by 雪尘; only the local record is stale.
 *   3. needs_first_send    — today's ReminderPlan has never been confirmed
 *   4. not_connected       — Cyberboss connection is not usable
 *   5. sync_failed         — confirmed failure, no active retry
 *   6. pending_retry       — transient failure, outbox is retrying / waiting to retry
 *   7. synced              — everything is up to date
 */
export function resolveSnowDustStatus({
  connectionReady,
  connectionEnabled,
  todayAcceptedRevision,
  snapshotSyncPending,
  reminderPlanSyncPending,
  snapshotSyncIssue,
  reminderPlanSyncIssue,
  isSending,
  partialSuccess = false,
} = {}) {
  // Backward-compatible fallback for callers/tests that only provide enabled.
  const ready = typeof connectionReady === "boolean" ? connectionReady : connectionEnabled === true;

  // 1. Active send — always wins, even during first send.
  if (isSending) return "syncing";

  // 2. Cyberboss accepted ReminderPlan but revision persist failed —
  //    higher priority than needs_first_send so "已接收" is shown,
  //    not "未发送"
  if (partialSuccess) return "partial_success";

  // 3. Today never confirmed → needs manual first send.
  if (!todayAcceptedRevision || todayAcceptedRevision < 1) return "needs_first_send";

  // 4. Config isn't actually sendable.
  if (!ready) return "not_connected";

  // 5. A non-pending error needs attention.
  const hasIssue = Boolean(snapshotSyncIssue || reminderPlanSyncIssue);
  const hasPending = Boolean(snapshotSyncPending || reminderPlanSyncPending);
  if (hasIssue && !hasPending) return "sync_failed";

  // 6. Pending payload remains in the retry/outbox. This wording is
  // intentionally "待同步", not "正在重试", because the outbox may have
  // exhausted timed retries and be waiting for visibility / the next edit.
  if (hasPending) return "pending_retry";

  // 7. All good.
  return "synced";
}
