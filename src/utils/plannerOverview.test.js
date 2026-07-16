import test from "node:test";
import assert from "node:assert/strict";
import { buildLifeMaintenanceSummary, buildTaskPlacementProgress } from "./plannerOverview.js";

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
