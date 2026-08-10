import assert from "node:assert/strict";
import test from "node:test";
import { applyPlannerLifeCardCompletion } from "./plannerLifeCardCompletion.js";

const base = { targetDate: "2026-08-10", todaySegmentOverrides: {} };

test("lunch can be completed directly from a user-stated fact", () => {
  const result = applyPlannerLifeCardCompletion(base, { date: "2026-08-10", cardId: "lunch", completed: true, now: new Date("2026-08-10T04:30:00Z") });
  assert.equal(result.ok, true);
  assert.equal(result.nextDraft.todaySegmentOverrides.lunch.status, "completed");
  assert.equal(result.nextDraft.todaySegmentOverrides.lunch.completionSource, "snowdust_user_statement");
});

test("safe direct completion is limited to meal/nap life cards", () => {
  const result = applyPlannerLifeCardCompletion(base, { date: "2026-08-10", cardId: "math-lecture", completed: true });
  assert.deepEqual(result, { ok: false, reason: "unsupported_life_card" });
});

test("wrong date never mutates another day's planner", () => {
  const result = applyPlannerLifeCardCompletion(base, { date: "2026-08-11", cardId: "lunch", completed: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "wrong_date");
});

test("repeating the same completion is idempotent", () => {
  const done = { ...base, todaySegmentOverrides: { lunch: { status: "completed" } } };
  const result = applyPlannerLifeCardCompletion(done, { date: "2026-08-10", cardId: "lunch", completed: true });
  assert.equal(result.ok, true);
  assert.equal(result.noop, true);
  assert.equal(result.nextDraft, done);
});
