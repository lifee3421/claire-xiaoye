import test from "node:test";
import assert from "node:assert/strict";
import { buildLifeMaintenanceSummary, buildStudyComposition, buildTaskPlacementProgress, sortCategoriesByOrder, summarizePeriodUsage } from "./plannerOverview.js";

test("placement progress aggregates timeline blocks by task group, not completion", () => {
  const result = buildTaskPlacementProgress({
    taskGroups: [{ id: "math", title: "数学｜网课", category: "数学", segments: [50, 50, 50] }],
    blocks: [
      { kind: "task", taskId: "math", status: "completed" },
      { kind: "task", taskId: "math", status: "pending" },
    ],
  });
  assert.deepEqual(result.rows[0], { id: "math", title: "数学｜网课", category: "数学", categoryId: "数学", total: 3, inserted: 2, remaining: 1 });
  assert.equal(result.categories[0].inserted, 2);
});

test("face mask uses structured review history and a calendar three-day interval", () => {
  const mask = buildLifeMaintenanceSummary({
    today: "2026-07-16",
    items: [{ id: "mask", name: "面膜", intervalDays: 3, remindAheadDays: 0 }],
    settlements: [{ reviewDate: "2026-07-13", health: { maskStatus: "已敷" } }],
  }).find((item) => item.id === "mask");
  assert.equal(mask.lastCompletedDate, "2026-07-13");
  assert.equal(mask.dueAt, "2026-07-16");
  assert.equal(mask.status, "due");
});

test("maintenance without a structured completion stays unavailable rather than inventing a due date", () => {
  const mask = buildLifeMaintenanceSummary({ today: "2026-07-16", items: [{ id: "mask", name: "面膜" }], settlements: [] }).find((item) => item.id === "mask");
  assert.equal(mask.status, "unavailable");
  assert.equal(mask.dueAt, "");
});

test("category order changes display only and keeps unknown categories at the end", () => {
  const result = sortCategoriesByOrder([{ id: "unknown", label: "自定义" }, { id: "english", label: "英语" }, { id: "math", label: "数学" }], ["math", "english"]);
  assert.deepEqual(result.map((item) => item.id), ["math", "english", "unknown"]);
});

test("period usage counts only overlap from real timeline blocks", () => {
  const result = summarizePeriodUsage({ timeline: [{ start: 8 * 60, end: 9 * 60 }, { start: 12 * 60 + 30, end: 13 * 60 + 30 }], dayStart: 8 * 60, lunchStart: 12 * 60, lunchEnd: 13 * 60, eveningStart: 18 * 60, dayEnd: 22 * 60 });
  assert.deepEqual(result.morning, { scheduledMinutes: 60, availableMinutes: 240 });
  assert.deepEqual(result.afternoon, { scheduledMinutes: 30, availableMinutes: 300 });
  assert.deepEqual(result.evening, { scheduledMinutes: 0, availableMinutes: 240 });
});

test("study composition ignores fixed and non-study blocks", () => {
  const result = buildStudyComposition({ blocks: [{ kind: "task", categoryId: "math", category: "数学", studyMinutes: 50 }, { kind: "fixed", categoryId: "math", studyMinutes: 30 }, { kind: "task", categoryId: "exercise", category: "运动", studyMinutes: 40 }] }, (block) => block.categoryId === "math");
  assert.deepEqual(result, { rows: [{ id: "math", label: "数学", minutes: 50 }], totalMinutes: 50 });
});
