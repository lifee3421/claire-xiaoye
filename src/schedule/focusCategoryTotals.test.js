import test from "node:test";
import assert from "node:assert/strict";
import { aggregateActualFocusMinutesByCategory } from "./focusCategoryTotals.js";

const categoryTree = [
  {
    id: "study",
    level: 1,
    children: [
      { id: "study.math", level: 2, children: [{ id: "study.math.calculus", level: 3 }] },
      { id: "study.english", level: 2, children: [{ id: "study.english.ielts", level: 3 }] },
      { id: "study.professional", level: 2, children: [{ id: "study.professional.corporateFinance", level: 3 }] },
      { id: "study.reading", level: 2, children: [] },
    ],
  },
];

test("daily target completion uses all settled Focus in the target category, not only planner overlap", () => {
  const totals = aggregateActualFocusMinutesByCategory({
    targetDateIso: "2026-08-08",
    categoryTree,
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

test("leaf Focus categories roll up to the level-2 daily target rows", () => {
  const totals = aggregateActualFocusMinutesByCategory({
    targetDateIso: "2026-08-08",
    categoryTree,
    sessions: [
      { categoryId: "study.math.calculus", durationMinutes: 230 },
      { categoryId: "study.english.ielts", durationMinutes: 100 },
      { categoryId: "study.professional.corporateFinance", durationMinutes: 100 },
    ],
  });
  assert.deepEqual(new Map(totals.map((item) => [item.categoryId, item.focusMinutes])), new Map([
    ["study.math", 230],
    ["study.english", 100],
    ["study.professional", 100],
  ]));
});

test("falls back to actual session interval when durationMinutes is absent", () => {
  const totals = aggregateActualFocusMinutesByCategory({
    targetDateIso: "2026-08-08",
    categoryTree,
    sessions: [
      { categoryId: "reading", startedAt: "2026-08-08T01:00:00.000Z", endedAt: "2026-08-08T01:50:00.000Z" },
    ],
  });
  assert.deepEqual(totals, [{ categoryId: "study.reading", focusMinutes: 50 }]);
});
