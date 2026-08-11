import assert from "node:assert/strict";
import test from "node:test";
import { buildReminderPlan } from "./buildReminderPlan.js";

test("a life.nap card gets both sleep and wake reminders", () => {
  const plan = buildReminderPlan({
    localDate: "2026-08-10",
    cards: [
      { id: "lunch", title: "午餐", start: "12:00", end: "12:40", categoryId: "life.lunch", statGroup: "life" },
      { id: "nap", title: "午睡", start: "13:00", end: "13:30", categoryId: "life.nap", statGroup: "life", systemRole: "nap" },
      { id: "dinner", title: "晚餐", start: "18:00", end: "18:40", categoryId: "life.dinner", statGroup: "life" },
    ],
  });
  const reminders = plan.reminders.filter((item) => item.sourceCardId === "nap");
  assert.equal(reminders.length, 2);

  const rest = reminders.find((item) => item.purpose === "rest");
  assert.ok(rest, "nap card should produce a start reminder");
  assert.equal(rest.anchor, "start");
  assert.match(rest.text, /午睡/);

  const wake = reminders.find((item) => item.purpose === "wake_up");
  assert.ok(wake, "nap card should produce an end reminder");
  assert.equal(wake.anchor, "end");
  assert.equal(wake.offsetMinutes, 0);
  assert.match(wake.text, /起床|起来/);
});
