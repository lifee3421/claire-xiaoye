import assert from "node:assert/strict";
import test from "node:test";
import { isSnowDustConnectionReady, resolveSnowDustStatus } from "./snowDustStatusResolve.js";

test("isSnowDustConnectionReady requires enabled + baseUrl + token", () => {
  assert.equal(isSnowDustConnectionReady({ enabled: false, baseUrl: "http://127.0.0.1:4319", token: "x" }), false);
  assert.equal(isSnowDustConnectionReady({ enabled: true, baseUrl: "", token: "x" }), false);
  assert.equal(isSnowDustConnectionReady({ enabled: true, baseUrl: "http://127.0.0.1:4319", token: "" }), false);
  assert.equal(isSnowDustConnectionReady({ enabled: true, baseUrl: "http://127.0.0.1:4319", token: "  " }), false);
  assert.equal(isSnowDustConnectionReady({ enabled: true, baseUrl: "http://127.0.0.1:4319", token: "x" }), true);
});

test("resolveSnowDustStatus — needs_first_send when today never confirmed", () => {
  assert.equal(resolveSnowDustStatus({ connectionReady: true, todayAcceptedRevision: 0 }), "needs_first_send");
  assert.equal(resolveSnowDustStatus({ connectionReady: true, todayAcceptedRevision: undefined }), "needs_first_send");
});

test("resolveSnowDustStatus — not_connected when connection is not usable", () => {
  assert.equal(resolveSnowDustStatus({ connectionReady: false, todayAcceptedRevision: 1 }), "not_connected");
});

test("resolveSnowDustStatus — sync_failed when snapshot issue and no pending payload", () => {
  assert.equal(resolveSnowDustStatus({
    connectionReady: true,
    todayAcceptedRevision: 1,
    snapshotSyncIssue: "timeout",
    snapshotSyncPending: false,
  }), "sync_failed");
});

test("resolveSnowDustStatus — sync_failed when reminder-plan issue and no pending payload", () => {
  assert.equal(resolveSnowDustStatus({
    connectionReady: true,
    todayAcceptedRevision: 1,
    reminderPlanSyncIssue: "receiver_unavailable",
    reminderPlanSyncPending: false,
  }), "sync_failed");
});

test("resolveSnowDustStatus — pending_retry when outbox still owns a pending payload", () => {
  assert.equal(resolveSnowDustStatus({
    connectionReady: true,
    todayAcceptedRevision: 1,
    snapshotSyncPending: true,
    snapshotSyncIssue: "timeout",
  }), "pending_retry");

  assert.equal(resolveSnowDustStatus({
    connectionReady: true,
    todayAcceptedRevision: 1,
    reminderPlanSyncPending: true,
    reminderPlanSyncIssue: "timeout",
  }), "pending_retry");
});

test("resolveSnowDustStatus — syncing when actively sending", () => {
  assert.equal(resolveSnowDustStatus({ connectionReady: true, todayAcceptedRevision: 1, isSending: true }), "syncing");
});

test("resolveSnowDustStatus — synced when everything is normal", () => {
  assert.equal(resolveSnowDustStatus({
    connectionReady: true,
    todayAcceptedRevision: 1,
    snapshotSyncPending: false,
    reminderPlanSyncPending: false,
    snapshotSyncIssue: "",
    reminderPlanSyncIssue: "",
    isSending: false,
  }), "synced");
});

test("resolveSnowDustStatus — priority: needs_first_send wins over not_connected", () => {
  assert.equal(resolveSnowDustStatus({ connectionReady: false, todayAcceptedRevision: 0 }), "needs_first_send");
});

test("resolveSnowDustStatus — priority: not_connected wins over sync_failed", () => {
  assert.equal(resolveSnowDustStatus({
    connectionReady: false,
    todayAcceptedRevision: 1,
    snapshotSyncIssue: "timeout",
    snapshotSyncPending: false,
  }), "not_connected");
});

test("resolveSnowDustStatus — pending payload wins over issue wording", () => {
  assert.equal(resolveSnowDustStatus({
    connectionReady: true,
    todayAcceptedRevision: 1,
    snapshotSyncIssue: "timeout",
    snapshotSyncPending: false,
    reminderPlanSyncPending: true,
  }), "pending_retry");
});

test("resolveSnowDustStatus — syncing even when today never confirmed", () => {
  assert.equal(resolveSnowDustStatus({ connectionReady: true, todayAcceptedRevision: 0, isSending: true }), "syncing");
});

test("resolveSnowDustStatus — priority: syncing wins over pending_retry", () => {
  assert.equal(resolveSnowDustStatus({ connectionReady: true, todayAcceptedRevision: 1, snapshotSyncPending: true, isSending: true }), "syncing");
});

test("resolveSnowDustStatus — priority: syncing wins over synced", () => {
  assert.equal(resolveSnowDustStatus({ connectionReady: true, todayAcceptedRevision: 1, isSending: true }), "syncing");
});
