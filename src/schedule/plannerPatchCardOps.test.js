import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerCreatedTask, buildPlannerEditPatch, buildPlannerDeletePatch, editedOccupiedDuration } from "./plannerPatchCardOps.js";

test("create_task preserves planner classification metadata and optional timeline start", () => {
  const task = buildPlannerCreatedTask({
    title: "午睡",
    categoryId: "life.nap",
    categoryLevel2Id: "life.nap",
    categoryName: "午睡",
    categoryPrimaryId: "life",
    categoryPrimaryName: "生活",
    categoryStatGroup: "life",
    estimatedMinutes: 30,
    start: "13:00",
    priority: 2,
  }, { taskId: "nap-custom", manualOrder: 3 });
  assert.equal(task.id, "nap-custom");
  assert.equal(task.manualStart, 780);
  assert.equal(task.placement, "timeline");
  assert.equal(task.categoryLevel2Id, "life.nap");
  assert.deepEqual(task.segments, [30]);
});

test("edit_task can change title duration break and category without losing untouched values", () => {
  const segment = { title: "旧标题", duration: 50, breakAfter: 10, priority: 2, preferredPeriods: ["afternoon"] };
  const patch = buildPlannerEditPatch({ title: "新标题", estimatedMinutes: 40, breakMinutes: 5, categoryId: "study.math" }, segment);
  assert.deepEqual(patch, { title: "新标题", categoryId: "study.math", workMinutes: 40, restMinutes: 5 });
  assert.equal(editedOccupiedDuration(segment, patch), 45);
});

test("delete_task distinguishes future deletion from already-started cancellation", () => {
  assert.deepEqual(buildPlannerDeletePatch({ alreadyStarted: false }), { deleted: true, placement: "deleted", status: "cancelled", locked: false });
  assert.deepEqual(buildPlannerDeletePatch({ alreadyStarted: true }), { status: "cancelled" });
});
