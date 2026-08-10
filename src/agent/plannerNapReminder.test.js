import assert from "node:assert/strict";
import test from "node:test";
import { buildReminderPlan } from "./buildReminderPlan.js";

test("a life.nap card gets a default Snow-dust nap reminder", () => {
  const plan = buildReminderPlan({
    localDate: "2026-08-10",
    cards: [
      { id: "lunch", title: "午餐", start: "12:00", end: "12:40", categoryId: "life.lunch", statGroup: "life" },
      { id: "startup", title: "午睡", start: "12:40", end: "13:20", categoryId: "life.nap", statGroup: "life" },
      { id: "dinner", title: "晚餐", start: "18:00", end: "18:40", categoryId: "life.dinner", statGroup: "life" },
    ],
  });
  const reminder = plan.reminders.find((item) => item.sourceCardId === "startup");
  assert.ok(reminder, "nap card should produce a reminder");
  assert.equal(reminder.purpose, "rest");
  assert.match(reminder.text, /午睡/);
});
