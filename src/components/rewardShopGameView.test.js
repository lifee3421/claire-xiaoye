import test from "node:test";
import assert from "node:assert/strict";
import {
  challengeProgressText,
  challengeRewardText,
  challengeRuleText,
  challengeStatus,
  progressPercent,
  surpriseDescription,
  surpriseMetaText,
} from "./rewardShopGameView.js";

test("formats count-in-period study challenge for the mall", () => {
  const challenge = {
    rule: {
      mode: "count_in_period",
      metric: "study_minutes",
      operator: ">=",
      threshold: 420,
      targetCount: 4,
      period: { type: "calendar_week" },
    },
    progress: { status: "in_progress", current: 3, target: 4, ratio: 0.75 },
    reward: { name: "半天自由安排" },
    pointPrice: 8,
  };
  assert.equal(challengeRuleText(challenge), "本周任意 4 天学习达到7h");
  assert.equal(challengeProgressText(challenge), "3 / 4");
  assert.equal(challengeRewardText(challenge), "半天自由安排 · 解锁后 8 分领取");
  assert.deepEqual(challengeStatus(challenge), { key: "in_progress", label: "🟡 进行中", claimable: false });
  assert.equal(progressPercent(challenge), 75);
});

test("formats bedtime streak and free claim state", () => {
  const challenge = {
    state: "locked",
    rule: {
      mode: "streak",
      metric: "bedtime_minutes",
      operator: "<=",
      threshold: 1440,
      targetCount: 3,
      period: { type: "rolling_days", days: 3 },
    },
    progress: { status: "claimable", completed: true, current: 3, target: 3, ratio: 1 },
    reward: { name: "甜品自由券" },
    pointPrice: 0,
  };
  assert.equal(challengeRuleText(challenge), "连续 3 天上床时间不晚于00:00");
  assert.equal(challengeRewardText(challenge), "甜品自由券 · 完成后免费领取");
  assert.equal(challengeStatus(challenge).claimable, true);
  assert.equal(progressPercent(challenge), 100);
});

test("claimed challenge cannot be claimed again", () => {
  assert.deepEqual(challengeStatus({ state: "claimed" }), { key: "claimed", label: "✅ 已领取", claimable: false });
});

test("mystery surprise never leaks its private description", () => {
  const item = {
    description: "真正奖励是秘密",
    stock: 1,
    surprise: { revealMode: "after_claim", expiresAt: "2026-08-08T16:00:00.000Z" },
  };
  assert.equal(surpriseDescription(item), "神秘奖励：兑换后揭晓 ✨");
  assert.match(surpriseMetaText(item), /库存 1/);
  assert.doesNotMatch(surpriseDescription(item), /真正奖励/);
});
