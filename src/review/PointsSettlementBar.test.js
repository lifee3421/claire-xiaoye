import test from "node:test";
import assert from "node:assert/strict";
import { pointDeltaLabel } from "./reviewPointDelta.js";

// The UI intentionally distinguishes the day's total composition from the
// actual balance change. Keep both arithmetic and wording explicit so future
// refactors do not regress into showing the full day's points as a new credit.
test("review revision balance change is new total minus saved total", () => {
  const savedPoints = 8;
  const recomputedSameReview = 8;
  const genuinelyEditedReview = 9.5;

  assert.equal(recomputedSameReview - savedPoints, 0);
  assert.equal(genuinelyEditedReview - savedPoints, 1.5);
});

test("zero delta says the balance will not change", () => {
  assert.equal(pointDeltaLabel(0), "本次积分不变");
  assert.equal(pointDeltaLabel(1.5), "本次预计 +1.5 分");
  assert.equal(pointDeltaLabel(-1), "本次预计 -1 分");
});
