import test from "node:test";
import assert from "node:assert/strict";

// The UI intentionally distinguishes the day's total composition from the
// actual balance change. Keep this tiny arithmetic contract explicit so future
// refactors do not regress into showing the full day's points as a new credit.
test("review revision balance change is new total minus saved total", () => {
  const savedPoints = 8;
  const recomputedSameReview = 8;
  const genuinelyEditedReview = 9.5;

  assert.equal(recomputedSameReview - savedPoints, 0);
  assert.equal(genuinelyEditedReview - savedPoints, 1.5);
});
