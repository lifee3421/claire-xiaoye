import test from "node:test";
import assert from "node:assert/strict";
import { aggregateActualFocusMinutesByCategory } from "./focusCategoryTotals.js";

test("daily target completion uses all settled Focus in the category, not only planner overlap", () => {
  const totals = aggregateActualFocusMinutesByCategory({
    targetDateIso: "2026-08-08",
    sessions: [
      { categoryId: "math", durationMinutes: 72, start: 9 * 60, end: 10 * 60 + 12 },
      { categoryId: "study.math", durationMinutes: 68, start: 11 * 60, end: 12 * 60 + 8 },
      { categoryId: "study.english", durationMinutes: 45, start: 13 * 60, end: 13 * 60 + 45 },
    ],
  });
  const byId = new Map(totals.map((item) => [item.categoryId, item.focusMinutes]));
  assert.equal(byId.get("study.math"), 140);
  assert.equal(byId.get("study.english"), 45);
});

test("falls back to actual session interval when durationMinutes is absent", () => {
  const totals = aggregateActualFocusMinutesByCategory({
    targetDateIso: "2026-08-08",
    sessions: [
      { categoryId: "reading", startedAt: "2026-08-08T01:00:00.000Z", endedAt: "2026-08-08T01:50:00.000Z" },
    ],
  });
  assert.deepEqual(totals, [{ categoryId: "study.reading", focusMinutes: 50 }]);
});
