import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSurpriseNotification,
  canLeaseRewardNotification,
  normalizeSurpriseMetadata,
  planRewardNotificationAck,
  planRewardNotificationLease,
  surpriseAvailability,
} from "./rewardSurpriseCore.js";

test("normalizes a limited surprise and defaults notification on", () => {
  const surprise = normalizeSurpriseMetadata({
    enabled: true,
    kind: "limited_time",
    expiresAt: "2026-08-08T15:59:59+08:00",
    publishedBy: "snowdust",
  }, { now: new Date("2026-08-07T12:00:00.000Z") });
  assert.equal(surprise.enabled, true);
  assert.equal(surprise.kind, "limited_time");
  assert.equal(surprise.notifyOnPublish, true);
  assert.equal(surprise.publishedBy, "snowdust");
});

test("mystery surprise hides description in notification snapshot", () => {
  const notification = buildSurpriseNotification({
    notificationId: "n1",
    itemId: "item-1",
    item: { name: "雪尘的神秘礼物", description: "真正内容不能提前说", price: 5 },
    surprise: { revealMode: "after_claim", expiresAt: "2026-08-08T16:00:00.000Z" },
  });
  assert.equal(notification.eventId, "reward-surprise:n1");
  assert.equal(notification.itemSnapshot.mystery, true);
  assert.equal(notification.itemSnapshot.description, "完成兑换后揭晓。");
  assert.doesNotMatch(notification.fallbackText, /真正内容不能提前说/);
});

test("surprise availability obeys start and expiry window", () => {
  const item = {
    status: "active",
    stock: 1,
    surprise: {
      enabled: true,
      availableFrom: "2026-08-07T12:00:00.000Z",
      expiresAt: "2026-08-07T14:00:00.000Z",
    },
  };
  assert.equal(surpriseAvailability(item, { now: new Date("2026-08-07T11:59:00.000Z") }).reason, "not_started");
  assert.equal(surpriseAvailability(item, { now: new Date("2026-08-07T13:00:00.000Z") }).available, true);
  assert.equal(surpriseAvailability(item, { now: new Date("2026-08-07T14:00:00.000Z") }).reason, "expired");
});

test("notification fetch does not acknowledge it", () => {
  const notification = { status: "pending", attemptCount: 0 };
  assert.equal(canLeaseRewardNotification(notification, { now: new Date("2026-08-07T12:00:00.000Z") }), true);
  assert.equal(notification.status, "pending");
  assert.equal(notification.acknowledgedAt, undefined);
});

test("lease is finite and a crashed delivery becomes leaseable after expiry", () => {
  const now = new Date("2026-08-07T12:00:00.000Z");
  const lease = planRewardNotificationLease({ status: "pending", attemptCount: 0 }, { owner: "cyberboss-a", now, leaseMs: 60_000 });
  assert.equal(lease.ok, true);
  const leased = { status: "leased", ...lease.patch };
  assert.equal(canLeaseRewardNotification(leased, { now: new Date("2026-08-07T12:00:30.000Z") }), false);
  assert.equal(canLeaseRewardNotification(leased, { now: new Date("2026-08-07T12:01:01.000Z") }), true);
});

test("same worker replays an active lease after response loss", () => {
  const leased = {
    status: "leased",
    leaseOwner: "cyberboss-a",
    leaseUntil: "2026-08-07T12:02:00.000Z",
    attemptCount: 1,
  };
  const replay = planRewardNotificationLease(leased, {
    owner: "cyberboss-a",
    now: new Date("2026-08-07T12:01:00.000Z"),
    leaseMs: 60_000,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.patch, {});
});

test("different worker cannot steal an active lease", () => {
  const leased = {
    status: "leased",
    leaseOwner: "cyberboss-a",
    leaseUntil: "2026-08-07T12:02:00.000Z",
    attemptCount: 1,
  };
  const result = planRewardNotificationLease(leased, {
    owner: "cyberboss-b",
    now: new Date("2026-08-07T12:01:00.000Z"),
  });
  assert.deepEqual(result, { ok: false, reason: "not_leaseable" });
});

test("ack requires matching lease owner and is idempotent", () => {
  const leased = {
    status: "leased",
    leaseOwner: "cyberboss-a",
    leaseUntil: "2026-08-07T12:02:00.000Z",
  };
  assert.deepEqual(planRewardNotificationAck(leased, { owner: "cyberboss-b", now: new Date("2026-08-07T12:01:00.000Z") }), {
    ok: false,
    reason: "lease_mismatch",
  });
  const first = planRewardNotificationAck(leased, { owner: "cyberboss-a", now: new Date("2026-08-07T12:01:00.000Z") });
  assert.equal(first.ok, true);
  assert.equal(first.replay, false);
  const acknowledged = { ...leased, ...first.patch };
  const replay = planRewardNotificationAck(acknowledged, { owner: "cyberboss-a", now: new Date("2026-08-07T12:02:00.000Z") });
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
});