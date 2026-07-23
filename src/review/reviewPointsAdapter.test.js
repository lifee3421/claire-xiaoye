import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft } from "./dailyReviewSchema.js";
import { buildSettlementInputFromReview } from "./reviewPointsAdapter.js";

test("structured review adapts its final values through the existing point functions", () => {
  const draft = createReviewDraft("2026-07-23");
  draft.fields["study.math.总时长"].value = 120;
  draft.fields["work.redcross.总时长"].value = 50;
  draft.fields["exercise.总时长"].value = 30;
  draft.fields["exercise.系统计分强度"].value = "低强度";
  draft.fields["sleep.入睡时间"].value = "23:00";
  draft.fields["entertainment.总时长"].value = 30;

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-07-23");
  assert.equal(settlement.studyMinutes, 120);
  assert.equal(settlement.workMinutes, 50);
  assert.equal(settlement.exerciseIntensity, "low");
  assert.equal(settlement.sleepAdjustment, 2);
  assert.equal(settlement.reviewTimelinessBonus, 1);
  assert.ok(settlement.pointsAdded > 0);
});
