/**
 * Derive a single human-readable Snow-dust sync status from the actual
 * underlying state sources — never invents a second status vocabulary.
 *
 * Priority (highest wins):
 *   1. syncing             — an in-flight send is active (must win over needs_first_send)
 *   2. needs_first_send    — today's ReminderPlan has never been confirmed
 *   3. not_connected       — Cyberboss not configured or unreachable
 *   4. sync_failed         — confirmed failure, no active retry
 *   5. pending_retry       — transient failure, outbox is retrying
 *   6. synced              — everything is up to date
 */
export function resolveSnowDustStatus({
  connectionEnabled,
  connectionLastStatus,
  todayAcceptedRevision,
  snapshotSyncPending,
  reminderPlanSyncPending,
  snapshotSyncIssue,
  isSending,
} = {}) {
  // 1. Active send — always wins, even during first send
  if (isSending) {
    return "syncing";
  }
  // 2. Today never confirmed → needs manual first send
  if (!todayAcceptedRevision || todayAcceptedRevision < 1) {
    return "needs_first_send";
  }
  // 3. Not connected at all
  if (!connectionEnabled) {
    return "not_connected";
  }
  // 4. Confirmed failure (not just pending retry)
  if (snapshotSyncIssue && !snapshotSyncPending) {
    return "sync_failed";
  }
  // 5. Pending retry (transient)
  if (snapshotSyncPending || reminderPlanSyncPending) {
    return "pending_retry";
  }
  // 6. All good
  return "synced";
}
