import test from "node:test";
import assert from "node:assert/strict";

import { createRewardChallengeRevisionEngine } from "./rewardChallengeRevisionEngine.js";

function createFakePort(seed = {}) {
  const fixedNow = new Date(seed.now || "2026-08-08T05:00:00.000Z");
  const collections = new Map();
  let autoId = 0;

  for (const [name, rows] of Object.entries(seed.collections || {})) {
    collections.set(name, new Map(rows.map((row) => [row.id, { ...row }])));
  }
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
    async runTransaction(fn) { return await fn({}); },
    async txGet(_tx, target) { return snapshot(target); },
    txSet(_tx, target, data, options) {
      const map = getCollection(target.collection);
      map.set(target.id, options?.merge ? { ...(map.get(target.id) || {}), ...data } : { ...data });
    },
    serverTimestamp: () => fixedNow.toISOString(),
    now: () => new Date(fixedNow),
  };

  return {
    port,
    rows: (name) => [...getCollection(name).entries()].map(([id, row]) => ({ id, ...row })),
  };
}

function cumulative35h(overrides = {}) {
  return {
    id: "c-old",
    title: "惊喜挑战｜35小时里程碑",
    description: "未来7天累计学习达到35小时",
    status: "active",
    state: "locked",
    startsAt: "2026-08-08T04:59:39.000Z",
    expiresAt: "2026-08-14T15:59:00.000Z",
    pointPrice: 8,
    redemptionMode: "hybrid",
    createdBy: "snowdust",
    reward: {
      name: "半天自由安排｜35小时挑战奖励",
      description: "累计35小时后解锁",
      categoryId: "challenge",
      icon: "✨",
    },
    rule: {
      schemaVersion: 1,
      mode: "cumulative",
      metric: "study_minutes",
      operator: ">=",
      threshold: 0,
      targetCount: 0,
      targetTotal: 2100,
      period: { type: "date_range", startDate: "2026-08-08", endDate: "2026-08-14" },
      trackerId: "",
      timezone: "Asia/Shanghai",
    },
    ...overrides,
  };
}

test("explicit revision supersedes the old challenge and preserves the same period", async () => {
  const fake = createFakePort({ collections: { rewardChallenges: [cumulative35h()] } });
  const engine = createRewardChallengeRevisionEngine(fake.port, { actor: "cyberboss" });

  const result = await engine.reviseRewardChallenge({
    challengeId: "c-old",
    rule: { ...cumulative35h().rule, targetTotal: 2520 },
    title: "惊喜挑战｜42小时加码",
    reason: "user explicitly asked to raise 35h to 42h",
    idempotencyKey: "wx:challenge-revise:m1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.replay, false);
  assert.equal(result.challenge.rule.targetTotal, 2520);
  assert.equal(result.challenge.startsAt, "2026-08-08T04:59:39.000Z");
  assert.equal(result.challenge.expiresAt, "2026-08-14T15:59:00.000Z");
  assert.equal(result.challenge.revisionOfChallengeId, "c-old");

  const rows = fake.rows("rewardChallenges");
  assert.equal(rows.length, 2);
  const oldRow = rows.find((row) => row.id === "c-old");
  const newRow = rows.find((row) => row.id !== "c-old");
  assert.equal(oldRow.status, "inactive");
  assert.equal(oldRow.state, "superseded");
  assert.equal(oldRow.supersededByChallengeId, newRow.id);
  assert.equal(newRow.revisionOfChallengeId, "c-old");
});

test("revision is idempotent and cannot fork two successors", async () => {
  const fake = createFakePort({ collections: { rewardChallenges: [cumulative35h()] } });
  const engine = createRewardChallengeRevisionEngine(fake.port, { actor: "cyberboss" });
  const args = {
    challengeId: "c-old",
    rule: { ...cumulative35h().rule, targetTotal: 2520 },
    idempotencyKey: "wx:challenge-revise:m2",
  };
  const first = await engine.reviseRewardChallenge(args);
  const second = await engine.reviseRewardChallenge(args);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.replay, true);
  assert.equal(fake.rows("rewardChallenges").length, 2);
});

test("claimed or already superseded challenges cannot be revised", async () => {
  for (const challenge of [
    cumulative35h({ state: "claimed", claimedRewardInstanceId: "r1" }),
    cumulative35h({ state: "superseded", status: "inactive", supersededByChallengeId: "c2" }),
  ]) {
    const fake = createFakePort({ collections: { rewardChallenges: [challenge] } });
    const engine = createRewardChallengeRevisionEngine(fake.port, { actor: "cyberboss" });
    const result = await engine.reviseRewardChallenge({
      challengeId: "c-old",
      idempotencyKey: `wx:challenge-revise:${challenge.state}`,
    });
    assert.equal(result.ok, false);
  }
});
