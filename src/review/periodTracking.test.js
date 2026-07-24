import test from "node:test";
import assert from "node:assert/strict";
import { calculatePeriodDay } from "./periodTracking.js";

test("calculatePeriodDay: the start date itself is day 1, the next day is day 2", () => {
  assert.equal(calculatePeriodDay("2026-07-24", "2026-07-24"), 1);
  assert.equal(calculatePeriodDay("2026-07-24", "2026-07-25"), 2);
  assert.equal(calculatePeriodDay("2026-07-24", "2026-07-27"), 4);
});

test("calculatePeriodDay returns null for missing inputs or a review date before the start", () => {
  assert.equal(calculatePeriodDay("", "2026-07-24"), null);
  assert.equal(calculatePeriodDay("2026-07-24", ""), null);
  assert.equal(calculatePeriodDay(null, null), null);
});
