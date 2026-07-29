import assert from "node:assert/strict";
import test from "node:test";
import { canConfirmReminderPlan } from "./reminderPlanPreview.js";

test("invalid reminder-plan previews disable confirmation and are blocked by the same guard", () => {
  assert.equal(canConfirmReminderPlan({ plan: { reminders: [] }, configErrors: ["missing startVerification"] }), false);
  assert.equal(canConfirmReminderPlan({ plan: { reminders: [] }, configErrors: [] }), true);
  assert.equal(canConfirmReminderPlan(null), false);
});
