import test from "node:test";
import assert from "node:assert/strict";
import { isAfterMidnightBedtime } from "./sleepTiming.js";

test("isAfterMidnightBedtime flags 00:00-05:59 and nothing else", () => {
  assert.equal(isAfterMidnightBedtime("23:59"), false);
  assert.equal(isAfterMidnightBedtime("00:00"), true);
  assert.equal(isAfterMidnightBedtime("00:30"), true);
  assert.equal(isAfterMidnightBedtime("05:59"), true);
  assert.equal(isAfterMidnightBedtime("06:00"), false);
  assert.equal(isAfterMidnightBedtime(""), false);
  assert.equal(isAfterMidnightBedtime(undefined), false);
  assert.equal(isAfterMidnightBedtime("not a time"), false);
});
