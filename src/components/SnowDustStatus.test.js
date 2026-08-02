import assert from "node:assert/strict";
import test from "node:test";
import { resolveSnowDustStatus } from "./snowDustStatusResolve.js";

test("resolveSnowDustStatus — needs_first_send when today never confirmed", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 0,
  }), "needs_first_send");

  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: undefined,
  }), "needs_first_send");
});

test("resolveSnowDustStatus — not_connected when cyberboss not enabled", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: false,
    todayAcceptedRevision: 1,
  }), "not_connected");
});

test("resolveSnowDustStatus — sync_failed when snapshot issue and no pending retry", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    snapshotSyncIssue: "timeout",
    snapshotSyncPending: false,
  }), "sync_failed");
});

test("resolveSnowDustStatus — pending_retry when outbox is retrying", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    snapshotSyncPending: true,
    snapshotSyncIssue: "timeout",
  }), "pending_retry");

  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    reminderPlanSyncPending: true,
  }), "pending_retry");
});

test("resolveSnowDustStatus — syncing when actively sending", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    isSending: true,
  }), "syncing");
});

test("resolveSnowDustStatus — synced when everything is normal", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    snapshotSyncPending: false,
    reminderPlanSyncPending: false,
    snapshotSyncIssue: "",
    isSending: false,
  }), "synced");
});

test("resolveSnowDustStatus — priority: needs_first_send wins over not_connected", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: false,
    todayAcceptedRevision: 0,
  }), "needs_first_send");
});

test("resolveSnowDustStatus — priority: not_connected wins over sync_failed", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: false,
    todayAcceptedRevision: 1,
    snapshotSyncIssue: "timeout",
    snapshotSyncPending: false,
  }), "not_connected");
});

test("resolveSnowDustStatus — priority: sync_failed wins over pending_retry", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    snapshotSyncIssue: "timeout",
    snapshotSyncPending: false,
    reminderPlanSyncPending: true,
  }), "sync_failed");
});

test("resolveSnowDustStatus — syncing even when today never confirmed (first-time send in progress)", () => {
  // Critical: during first send, isSending must win over needs_first_send
  // so the user sees "同步中" instead of the "发送今日计划" CTA
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 0,
    isSending: true,
  }), "syncing");
});

test("resolveSnowDustStatus — priority: syncing wins over pending_retry", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    snapshotSyncPending: true,
    isSending: true,
  }), "syncing");
});

test("resolveSnowDustStatus — priority: syncing wins over synced", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    isSending: true,
  }), "syncing");
});

// ── partial_success ──────────────────────────────────────────────────────

test("resolveSnowDustStatus — partial_success: Cyberboss accepted but revision not persisted", () => {
  // This is the "雪尘已接收 · 云端记录待保存" state —
  // todayAcceptedRevision is 0 (persist failed), but partialSuccess
  // tells us the plan was actually accepted by Cyberboss.
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 0,
    partialSuccess: true,
  }), "partial_success");
});

test("resolveSnowDustStatus — partial_success wins over needs_first_send", () => {
  // Without partialSuccess, todayAcceptedRevision=0 returns needs_first_send.
  // With partialSuccess=true, it must return partial_success instead.
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 0,
  }), "needs_first_send");
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 0,
    partialSuccess: true,
  }), "partial_success");
});

test("resolveSnowDustStatus — syncing still wins over partial_success", () => {
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 0,
    partialSuccess: true,
    isSending: true,
  }), "syncing");
});

test("resolveSnowDustStatus — partial_success wins over not_connected and sync_failed", () => {
  // Even if connection is reported as not enabled, partial_success
  // (we know Cyberboss just accepted our plan) should be shown.
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: false,
    todayAcceptedRevision: 0,
    partialSuccess: true,
  }), "partial_success");
});

test("resolveSnowDustStatus — partial_success with existing acceptedRevision uses synced/normal flow", () => {
  // If a later retry succeeds and todayAcceptedRevision >= 1,
  // partialSuccess should be cleared and we get synced.
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    partialSuccess: false,
    isSending: false,
  }), "synced");
  // partialSuccess=true with acceptedRevision>=1 shouldn't happen in
  // practice (it's cleared on success), but if it does, partial_success
  // still wins — the user deserves to know something is pending.
  assert.equal(resolveSnowDustStatus({
    connectionEnabled: true,
    todayAcceptedRevision: 1,
    partialSuccess: true,
  }), "partial_success");
});
