import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft } from "./dailyReviewSchema.js";
import { buildSettlementInputFromReview } from "./reviewPointsAdapter.js";

test("structured review adapts its final values through the existing point functions", () => {
  const draft = createReviewDraft("2026-07-23");
  draft.fields["study.math.totalMinutes"].value = 120;
  draft.fields["work.redCross.totalMinutes"].value = 50;
  draft.fields["exercise.today.totalMinutes"].value = 30;
  draft.fields["exercise.today.intensity"].value = "低强度";
  draft.fields["sleep.yesterday.bedtime"].value = "23:00";
  draft.fields["entertainment.today.totalMinutes"].value = 30;

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-07-23");
  assert.equal(settlement.studyMinutes, 120);
  assert.equal(settlement.workMinutes, 50);
  assert.equal(settlement.exerciseIntensity, "low");
  assert.equal(settlement.sleepAdjustment, 2);
  assert.equal(settlement.reviewTimelinessBonus, 1);
  assert.ok(settlement.pointsAdded > 0);
});

test("travel-day setting remains opt-in and affects only the existing day classification", () => {
  const draft = createReviewDraft("2026-07-23");
  draft.fields["summary.isTravelDay"].value = "是";
  const settlement = buildSettlementInputFromReview(draft, { travelDayBonusPoints: 2 }, "2026-07-23");
  assert.equal(settlement.isTravelDay, true);
  assert.equal(settlement.travelDayBonusPoints, 2);
});
