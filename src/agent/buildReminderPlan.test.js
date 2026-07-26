import assert from "node:assert/strict";
import test from "node:test";
import { buildReminderPlan } from "./buildReminderPlan.js";

test("builds exact semantic reminders and a conditional follow-up", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-25", revision: 7, cards: [{ id: "math", title: "数学", start: "17:00", end: "17:50", systemRole: "evening_study" }] });
  assert.equal(plan.reminders[0].scheduledAt, "2026-07-25T17:00:00+08:00");
  assert.equal(plan.reminders[0].followUpPolicy.delayMinutes, 10);
  assert.equal(plan.reminders[0].deliveryMode, "must_send");
});

test("does not infer defaults from a display title", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-25", cards: [{ id: "x", title: "起床", start: "07:00", end: "07:20" }] });
  assert.equal(plan.reminders.length, 0);
});
