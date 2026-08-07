import test from "node:test";
import assert from "node:assert/strict";

import { createRewardChallengeEngine } from "./rewardChallengeEngine.js";

function createFakePort(seed = {}) {
  const fixedNow = new Date(seed.now || "2026-08-07T12:00:00.000Z");
  const collections = new Map();
  let autoId = 0;
  let profile = { points: 20, rewardTotalSpent: 0, rewardTotalEarned: 0, ...(seed.profile || {}) };

  for (const [name, rows] of Object.entries(seed.collections || {})) {
    const map = new Map();
    for (const row of rows) map.set(row.id, { ...row });
    collections.set(name, map);
  }

  const getCollection = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };
  const profileRef = { kind: "profile", id: "profile" };
  const ref = (collection, id = "") => ({ kind: "doc", collection, id: id || `auto-${++autoId}` });
  const snapshot = (target) => {
    if (target.kind === "profile") return { exists: true, id: "profile", data: { ...profile } };
    const row = getCollection(target.collection).get(target.id);
    return { exists: Boolean(row), id: target.id, data: row ? { ...row } : null };
  };
  const merge = (base, patch) => ({ ...(base || {}), ...patch });

  const port = {
    profileRef: () => profileRef,
    async getProfile() { return { exists: true, id: "profile", data: { ...profile } }; },
    ref,
    async getDoc(collection, id) { return snapshot(ref(collection, id)); },
    async listDocs(collection) {
      return [...getCollection(collection).entries()].map(([id, row]) => ({ id, ...row }));
    },
    async runTransaction(fn) { return await fn({}); },
    async txGet(_tx, target) { return snapshot(target); },
    txSet(_tx, target, data, options) {
      if (target.kind === "profile") {
        profile = options?.merge ? merge(profile, data) : { ...data };
        return;
      }
      const map = getCollection(target.collection);
      map.set(target.id, options?.merge ? merge(map.get(target.id), data) : { ...data });
    },
    txDelete(_tx, target) { getCollection(target.collection).delete(target.id); },
    serverTimestamp: () => fixedNow.toISOString(),
    now: () => new Date(fixedNow),
  };

  return {
    port,
    getProfile: () => ({ ...profile }),
    rows: (name) => [...getCollection(name).entries()].map(([id, row]) => ({ id, ...row })),
  };
}

function fourDayStudyChallenge(overrides = {}) {
  return {
    id: "c1",
    title: "本周高质量学习周",
    description: "本周任意4天学习至少7小时",
    status: "active",
    state: "locked",
    startsAt: "2026-08-03T00:00:00.000Z",
    expiresAt: "2026-08-10T00:00:00.000Z",
    pointPrice: 0,
    redemptionMode: "challenge",
    reward: { name: "奶茶奖励", description: "挑战奖励", categoryId: "challenge", icon: "🧋" },
    rule: {
      schemaVersion: 1,
      mode: "count_in_period",
      metric: "study_minutes",
      operator: ">=",
      threshold: 420,
      targetCount: 4,
      targetTotal: 0,
      period: { type: "calendar_week" },
      trackerId: "",
      timezone: "Asia/Shanghai",
    },
    ...overrides,
  };
}

function qualifyingSettlements() {
  return [
    { id: "s1", reviewDate: "2026-08-03", studyMinutes: 430, settlementRevision: 1 },
    { id: "s2", reviewDate: "2026-08-04", studyMinutes: 200, settlementRevision: 1 },
    { id: "s3", reviewDate: "2026-08-05", studyMinutes: 440, settlementRevision: 1 },
    { id: "s4", reviewDate: "2026-08-06", studyMinutes: 450, settlementRevision: 1 },
    { id: "s5", reviewDate: "2026-08-07", studyMinutes: 470, settlementRevision: 1 },
  ];
}

test("listRewardChallenges recomputes 4-of-7 study progress from settlements", async () => {
  const fake = createFakePort({
    collections: {
      rewardChallenges: [fourDayStudyChallenge()],
      settlements: qualifyingSettlements(),
    },
  });
  const engine = createRewardChallengeEngine(fake.port, { actor: "cyberboss" });
  const result = await engine.listRewardChallenges();
  assert.equal(result.ok, true);
  assert.equal(result.challenges.length, 1);
  assert.equal(result.challenges[0].progress.current, 4);
  assert.equal(result.challenges[0].progress.completed, true);
  assert.equal(result.challenges[0].progress.status, "claimable");
});

test("createRewardChallenge replays same idempotency key", async () => {
  const fake = createFakePort();
  const engine = createRewardChallengeEngine(fake.port, { actor: "cyberboss" });
  const input = {
    title: "早睡三连",
    rule: {
      mode: "streak",
      metric: "bedtime_minutes",
      threshold: 1440,
      targetCount: 3,
      period: { type: "rolling_days", days: 7 },
    },
    reward: { name: "甜品券" },
    idempotencyKey: "wechat:create-challenge:abc123",
  };
  const first = await engine.createRewardChallenge(input);
  const second = await engine.createRewardChallenge(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.replay, true);
  assert.equal(fake.rows("rewardChallenges").length, 1);
});

test("challenge-only claim creates one available reward and charges zero points", async () => {
  const fake = createFakePort({
    profile: { points: 20 },
    collections: {
      rewardChallenges: [fourDayStudyChallenge()],
      settlements: qualifyingSettlements(),
    },
  });
  const engine = createRewardChallengeEngine(fake.port, { actor: "cyberboss" });
  const first = await engine.claimRewardChallenge({ challengeId: "c1", idempotencyKey: "wechat:claim:abc123" });
  const replay = await engine.claimRewardChallenge({ challengeId: "c1", idempotencyKey: "wechat:claim:abc123" });
  assert.equal(first.ok, true);
  assert.equal(first.pointsSpent, 0);
  assert.equal(first.balanceAfter, 20);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(fake.getProfile().points, 20);
  assert.equal(fake.rows("rewardInstances").length, 1);
  assert.equal(fake.rows("pointTransactions").length, 0);
  assert.equal(fake.rows("rewardChallengeClaims").length, 1);
  assert.equal(fake.rows("rewardInstances")[0].status, "available");
});

test("a second distinct message cannot claim an already claimed challenge twice", async () => {
  const fake = createFakePort({
    collections: {
      rewardChallenges: [fourDayStudyChallenge()],
      settlements: qualifyingSettlements(),
    },
  });
  const engine = createRewardChallengeEngine(fake.port, { actor: "cyberboss" });
  const first = await engine.claimRewardChallenge({ challengeId: "c1", idempotencyKey: "wechat:claim:first1" });
  const second = await engine.claimRewardChallenge({ challengeId: "c1", idempotencyKey: "wechat:claim:second2" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, "challenge_already_claimed");
  assert.equal(fake.rows("rewardInstances").length, 1);
});

test("hybrid challenge deducts point co-pay exactly once", async () => {
  const fake = createFakePort({
    profile: { points: 20, rewardTotalSpent: 2 },
    collections: {
      rewardChallenges: [fourDayStudyChallenge({ pointPrice: 8, redemptionMode: "hybrid" })],
      settlements: qualifyingSettlements(),
    },
  });
  const engine = createRewardChallengeEngine(fake.port, { actor: "cyberboss" });
  const first = await engine.claimRewardChallenge({ challengeId: "c1", idempotencyKey: "wechat:hybrid:abc123" });
  const replay = await engine.claimRewardChallenge({ challengeId: "c1", idempotencyKey: "wechat:hybrid:abc123" });
  assert.equal(first.ok, true);
  assert.equal(first.balanceAfter, 12);
  assert.equal(replay.replay, true);
  assert.equal(fake.getProfile().points, 12);
  assert.equal(fake.getProfile().rewardTotalSpent, 10);
  assert.equal(fake.rows("pointTransactions").length, 1);
  assert.equal(fake.rows("rewardInstances").length, 1);
});

test("publishSurpriseDrop creates one item and one pending notification under retry", async () => {
  const fake = createFakePort();
  const engine = createRewardChallengeEngine(fake.port, { actor: "cyberboss" });
  const input = {
    name: "今晚甜品惊喜",
    price: 3,
    description: "今晚限定",
    stock: 1,
    surprise: {
      kind: "limited_time",
      expiresAt: "2026-08-08T12:00:00.000Z",
      publishedBy: "snowdust",
      notifyOnPublish: true,
    },
    idempotencyKey: "system:surprise:abc123",
  };
  const first = await engine.publishSurpriseDrop(input);
  const replay = await engine.publishSurpriseDrop(input);
  assert.equal(first.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(fake.rows("products").length, 1);
  assert.equal(fake.rows("rewardNotifications").length, 1);
  assert.equal(fake.rows("rewardNotifications")[0].status, "pending");
});

test("notification lease does not ack; matching worker can ack after delivery", async () => {
  const fake = createFakePort({
    collections: {
      rewardNotifications: [{
        id: "n1",
        type: "surprise_drop",
        status: "pending",
        eventId: "reward-surprise:n1",
        itemId: "p1",
        fallbackText: "✨ 惊喜上新",
        attemptCount: 0,
        createdAt: "2026-08-07T11:00:00.000Z",
      }],
    },
  });
  const engine = createRewardChallengeEngine(fake.port, { actor: "cyberboss" });
  const leased = await engine.leaseRewardNotification({ workerId: "worker-a", leaseMs: 60000 });
  assert.equal(leased.ok, true);
  assert.equal(leased.notification.status, "leased");
  assert.equal(fake.rows("rewardNotifications")[0].acknowledgedAt, undefined);

  const wrong = await engine.ackRewardNotification({ notificationId: "n1", workerId: "worker-b" });
  assert.equal(wrong.ok, false);
  const acked = await engine.ackRewardNotification({ notificationId: "n1", workerId: "worker-a" });
  assert.equal(acked.ok, true);
  assert.equal(acked.notification.status, "acknowledged");
});
