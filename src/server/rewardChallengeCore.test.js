import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRewardChallenge,
  normalizeBedtimeMinutes,
  normalizeRewardChallengeRule,
  resolveRewardChallengePeriod,
} from "./rewardChallengeCore.js";

test("normalizes after-midnight bedtime onto the same logical night clock", () => {
  assert.equal(normalizeBedtimeMinutes("23:50"), 1430);
  assert.equal(normalizeBedtimeMinutes("24:00"), 1440);
  assert.equal(normalizeBedtimeMinutes("00:20"), 1460);
  assert.equal(normalizeBedtimeMinutes("05:59"), 1799);
  assert.equal(normalizeBedtimeMinutes("06:00"), 360);
});

test("calendar week is Monday through Sunday", () => {
  const rule = normalizeRewardChallengeRule({
    mode: "count_in_period",
    metric: "study_minutes",
    threshold: 420,
    targetCount: 4,
    period: { type: "calendar_week" },
  });
  assert.deepEqual(resolveRewardChallengePeriod(rule, { today: "2026-08-07" }), {
    startDate: "2026-08-03",
    endDate: "2026-08-09",
  });
});

test("3-day bedtime streak completes only with three confirmed consecutive days", () => {
  const rule = {
    mode: "streak",
    metric: "bedtime_minutes",
    operator: "<=",
    threshold: 1440,
    targetCount: 3,
    period: { type: "date_range", startDate: "2026-08-01", endDate: "2026-08-05" },
  };
  const progress = evaluateRewardChallenge(rule, {
    "2026-08-01": "23:50",
    "2026-08-02": "23:55",
    "2026-08-03": "23:40",
    "2026-08-04": "00:10",
  });
  assert.equal(progress.completed, true);
  assert.equal(progress.status, "claimable");
  assert.equal(progress.detail.longestStreak, 3);
  assert.equal(progress.detail.currentStreak, 0);
});

test("confirmed late bedtime resets a streak", () => {
  const rule = {
    mode: "streak",
    metric: "bedtime_minutes",
    operator: "<=",
    threshold: 1440,
    targetCount: 3,
    period: { type: "date_range", startDate: "2026-08-01", endDate: "2026-08-04" },
  };
  const progress = evaluateRewardChallenge(rule, {
    "2026-08-01": "23:50",
    "2026-08-02": "00:20",
    "2026-08-03": "23:30",
    "2026-08-04": "23:20",
  });
  assert.equal(progress.completed, false);
  assert.equal(progress.detail.longestStreak, 2);
  assert.equal(progress.detail.currentStreak, 2);
});

test("unknown day never falsely bridges a streak", () => {
  const rule = {
    mode: "streak",
    metric: "study_minutes",
    operator: ">=",
    threshold: 420,
    targetCount: 3,
    period: { type: "date_range", startDate: "2026-08-01", endDate: "2026-08-03" },
  };
  const progress = evaluateRewardChallenge(rule, {
    "2026-08-01": 450,
    "2026-08-03": 480,
  });
  assert.equal(progress.completed, false);
  assert.equal(progress.detail.longestStreak, 1);
  assert.deepEqual(progress.unknownDates, ["2026-08-02"]);
});

test("4-of-7 study challenge does not require consecutive days", () => {
  const rule = {
    mode: "count_in_period",
    metric: "study_minutes",
    threshold: 420,
    targetCount: 4,
    period: { type: "calendar_week" },
  };
  const progress = evaluateRewardChallenge(rule, {
    "2026-08-03": 430,
    "2026-08-04": 200,
    "2026-08-05": 421,
    "2026-08-06": 500,
    "2026-08-07": 100,
    "2026-08-08": 440,
  }, { today: "2026-08-07" });
  assert.equal(progress.completed, true);
  assert.equal(progress.current, 4);
  assert.deepEqual(progress.qualifyingDates, ["2026-08-03", "2026-08-05", "2026-08-06", "2026-08-08"]);
});

test("weekly cumulative challenge uses the sum and exposes unknown dates", () => {
  const rule = {
    mode: "cumulative",
    metric: "study_minutes",
    threshold: 0,
    targetTotal: 2100,
    period: { type: "calendar_week" },
  };
  const progress = evaluateRewardChallenge(rule, {
    "2026-08-03": 400,
    "2026-08-04": 500,
    "2026-08-05": 450,
    "2026-08-06": 420,
    "2026-08-07": 330,
  }, { today: "2026-08-07" });
  assert.equal(progress.current, 2100);
  assert.equal(progress.completed, true);
  assert.deepEqual(progress.unknownDates, ["2026-08-08", "2026-08-09"]);
});

test("challenge progress is recomputed from facts instead of an incrementing counter", () => {
  const rule = {
    mode: "count_in_period",
    metric: "study_minutes",
    threshold: 420,
    targetCount: 2,
    period: { type: "date_range", startDate: "2026-08-01", endDate: "2026-08-02" },
  };
  const before = evaluateRewardChallenge(rule, { "2026-08-01": 450, "2026-08-02": 440 });
  const afterCorrection = evaluateRewardChallenge(rule, { "2026-08-01": 450, "2026-08-02": 300 });
  assert.equal(before.completed, true);
  assert.equal(afterCorrection.completed, false);
  assert.equal(afterCorrection.current, 1);
});

test("tracker challenges require a stable tracker id", () => {
  assert.throws(() => normalizeRewardChallengeRule({
    mode: "count_in_period",
    metric: "tracker_completion",
    targetCount: 3,
    threshold: 1,
    period: { type: "rolling_days", days: 7 },
  }), /trackerId/);
});
