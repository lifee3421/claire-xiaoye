import test from "node:test";
import assert from "node:assert/strict";
import { calculateSleepDuration, applyAutomaticSleepDuration } from "./sleepDuration.js";

test("calculates overnight and same-day sleep in minutes", () => {
  assert.deepEqual(calculateSleepDuration({ bedtime: "23:40", wakeTime: "07:10" }), { valid: true, durationMinutes: 450, durationText: "7h30min" });
  assert.deepEqual(calculateSleepDuration({ bedtime: "00:40", wakeTime: "08:10" }), { valid: true, durationMinutes: 450, durationText: "7h30min" });
});
test("does not turn equal clocks into 24 hours and handles incomplete input", () => {
  assert.equal(calculateSleepDuration({ bedtime: "22:30", wakeTime: "22:30" }).reason, "out_of_range");
  assert.equal(calculateSleepDuration({ bedtime: "22:30", wakeTime: "" }).reason, "incomplete");
});
test("manual duration survives clock edits until automatic calculation is restored", () => {
  const manual = { "sleep.yesterday.bedtime": { value: "23:40" }, "sleep.yesterday.wakeTime": { value: "07:10" }, "sleep.yesterday.durationText": { value: "8h", manuallyEdited: true } };
  assert.equal(applyAutomaticSleepDuration(manual).fields["sleep.yesterday.durationText"].value, "8h");
  const restored = applyAutomaticSleepDuration({ ...manual, "sleep.yesterday.durationText": { value: "8h", manuallyEdited: false } });
  assert.equal(restored.fields["sleep.yesterday.durationText"].value, "7h30min");
});
