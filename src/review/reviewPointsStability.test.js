import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft } from "./dailyReviewSchema.js";
import { buildSettlementInputFromReview, resolveReviewTimelinessReferenceDate } from "./reviewPointsAdapter.js";

function filledDraft(date) {
  const draft = createReviewDraft(date);
  draft.fields["study.math.totalMinutes"].value = 120;
  draft.fields["sleep.yesterday.bedtime"].value = "23:00";
  draft.fields["entertainment.today.totalMinutes"].value = 30;
  return draft;
}

test("same-day review keeps its +1 archive bonus when reopened tomorrow", () => {
  const draft = filledDraft("2026-08-08");
  const first = buildSettlementInputFromReview(draft, {}, "2026-08-08");
  assert.equal(first.reviewTimelinessBonus, 1);

  draft.submittedAt = "2026-08-08T22:15:00+08:00";
  const reopenedTomorrow = buildSettlementInputFromReview(draft, {}, "2026-08-09");
  assert.equal(reopenedTomorrow.reviewTimelinessBonus, 1);
  assert.equal(reopenedTomorrow.pointsAdded, first.pointsAdded,
    "calendar rollover alone must never change an already-submitted day's total points");
});

test("late review keeps its original +0.5 archive bonus on later reopens", () => {
  const draft = filledDraft("2026-08-07");
  draft.submittedAt = "2026-08-08T09:00:00+08:00";

  const reopenedDaysLater = buildSettlementInputFromReview(draft, {}, "2026-08-12");
  assert.equal(reopenedDaysLater.reviewTimelinessBonus, 0.5);
  assert.equal(resolveReviewTimelinessReferenceDate(draft, "2026-08-12"), "2026-08-08");
});

test("Firestore Timestamp-like submittedAt freezes the same reference date", () => {
  const draft = filledDraft("2026-08-08");
  draft.submittedAt = { toDate: () => new Date("2026-08-08T14:00:00.000Z") }; // 22:00 Beijing

  assert.equal(resolveReviewTimelinessReferenceDate(draft, "2026-08-09"), "2026-08-08");
  assert.equal(buildSettlementInputFromReview(draft, {}, "2026-08-09").reviewTimelinessBonus, 1);
});
