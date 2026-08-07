import test from "node:test";
import assert from "node:assert/strict";

import { createRewardChallengeEngine } from "./rewardChallengeEngine.js";
import { createRewardSurpriseChallengeEngine } from "./rewardSurpriseChallengeEngine.js";

function createFakePort() {
  const now = new Date("2026-08-07T12:00:00.000Z");
  const collections = new Map();
  let autoId = 0;
  const getCollection = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };
  const ref = (collection, id = "") => ({ collection, id: id || `auto-${++autoId}` });
  const snapshot = (target) => {
    const row = getCollection(target.collection).get(target.id);
    return { exists: Boolean(row), id: target.id, data: row ? { ...row } : null };
  };
  const port = {
    ref,
    now: () => new Date(now),
    serverTimestamp: () => now.toISOString(),
    async runTransaction(fn) { return await fn({}); },
    async txGet(_tx, target) { return snapshot(target); },
    txSet(_tx, target, data, options) {
      const map = getCollection(target.collection);
      const existing = map.get(target.id) || {};
      map.set(target.id, options?.merge ? { ...existing, ...data } : { ...data });
    },
  };
  return {
    port,
    rows(name) {
      return [...getCollection(name).entries()].map(([id, row]) => ({ id, ...row }));
    },
  };
}

function challengeInput() {
  return {
    title: "惊喜挑战｜早睡三连",
    description: "连续3天在24:00前上床",
    rule: {
      mode: "streak",
      metric: "bedtime_minutes",
      operator: "<=",
      threshold: 1440,
      targetCount: 3,
      period: { type: "date_range", startDate: "2026-08-07", endDate: "2026-08-11" },
    },
    reward: { name: "奶茶咖啡甜品", description: "早睡挑战奖励" },
    pointPrice: 0,
    expiresAt: "2026-08-11T15:59:00.000Z",
    idempotencyKey: "system:surprise:2026-08-07:v2",
  };
}

test("surprise challenge creates exactly one challenge and one notification under replay", async () => {
  const fake = createFakePort();
  const engine = createRewardSurpriseChallengeEngine(fake.port, { actor: "cyberboss" });

  const first = await engine.createSurpriseRewardChallenge(challengeInput());
  const second = await engine.createSurpriseRewardChallenge(challengeInput());

  assert.equal(first.ok, true);
  assert.equal(first.replay, false);
  assert.equal(second.ok, true);
  assert.equal(second.replay, true);
  assert.equal(fake.rows("rewardChallenges").length, 1);
  assert.equal(fake.rows("rewardNotifications").length, 1);
  assert.equal(fake.rows("rewardNotifications")[0].status, "pending");
  assert.equal(fake.rows("rewardNotifications")[0].type, "surprise_challenge");
  assert.match(fake.rows("rewardNotifications")[0].fallbackText, /连续3天在24:00前上床/);
  assert.match(fake.rows("rewardNotifications")[0].fallbackText, /奶茶咖啡甜品/);
});

test("a retry heals challenge-created-but-notification-missing without duplicating challenge", async () => {
  const fake = createFakePort();
  const challengeEngine = createRewardChallengeEngine(fake.port, { actor: "cyberboss" });
  const createdOnly = await challengeEngine.createRewardChallenge(challengeInput());
  assert.equal(createdOnly.ok, true);
  assert.equal(fake.rows("rewardChallenges").length, 1);
  assert.equal(fake.rows("rewardNotifications").length, 0);

  const engine = createRewardSurpriseChallengeEngine(fake.port, { actor: "cyberboss", challengeEngine });
  const healed = await engine.createSurpriseRewardChallenge(challengeInput());

  assert.equal(healed.ok, true);
  assert.equal(healed.replay, false);
  assert.equal(fake.rows("rewardChallenges").length, 1);
  assert.equal(fake.rows("rewardNotifications").length, 1);
});

test("hybrid surprise challenge notification explains the co-pay", async () => {
  const fake = createFakePort();
  const engine = createRewardSurpriseChallengeEngine(fake.port, { actor: "cyberboss" });
  const result = await engine.createSurpriseRewardChallenge({ ...challengeInput(), pointPrice: 4 });

  assert.equal(result.ok, true);
  assert.match(result.notification.fallbackText, /领取时再花 4 分/);
});
