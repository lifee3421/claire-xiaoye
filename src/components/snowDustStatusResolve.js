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
 *   4. not_connected       — Cyberboss not configured or unreachable
 *   5. sync_failed         — confirmed failure, no active retry
 *   6. pending_retry       — transient failure, outbox is retrying
 *   7. synced              — everything is up to date
 */
export function resolveSnowDustStatus({
  connectionEnabled,
  todayAcceptedRevision,
  snapshotSyncPending,
  reminderPlanSyncPending,
  snapshotSyncIssue,
  isSending,
  partialSuccess = false,
} = {}) {
  // 1. Active send — always wins, even during first send
  if (isSending) {
    return "syncing";
  }
  // 2. Cyberboss accepted ReminderPlan but revision persist failed —
  //    higher priority than needs_first_send so "已接收" is shown,
  //    not "未发送"
  if (partialSuccess) {
    return "partial_success";
  }
  // 3. Today never confirmed → needs manual first send
  if (!todayAcceptedRevision || todayAcceptedRevision < 1) {
    return "needs_first_send";
  }
  // 4. Not connected at all
  if (!connectionEnabled) {
    return "not_connected";
  }
  // 5. Confirmed failure (not just pending retry)
  if (snapshotSyncIssue && !snapshotSyncPending) {
    return "sync_failed";
  }
  // 6. Pending retry (transient)
  if (snapshotSyncPending || reminderPlanSyncPending) {
    return "pending_retry";
  }
  // 7. All good
  return "synced";
}
