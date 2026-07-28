import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduledTaskBlockFromSegment, flattenPlannerTasks } from "./plannerTimelineBlocks.js";

function studyTaskGroup(id, { manualStart, segmentOverrides = {} } = {}) {
  return {
    id,
    title: `晨间学习 ${id}`,
    categoryId: "study.math",
    category: "数学",
    categoryStatGroup: "study",
    segments: [50],
    breakMinutes: 10,
    priority: 2,
    preferredPeriods: ["morning"],
    manualStart,
    locked: true,
    segmentOverrides,
  };
}

test("flattenPlannerTasks resolves snowdustReminder/deskVerification with segment override > task default > inherit(null)", () => {
  const overrides = { "b-1": { snowdustReminder: { mode: "on", advanceMinutes: 7 } } };
  const groups = [studyTaskGroup("a", { manualStart: 540, segmentOverrides: overrides }), studyTaskGroup("b", { manualStart: 600, segmentOverrides: overrides })];
  const segments = flattenPlannerTasks(groups, []);
  const a = segments.find((segment) => segment.blockId === "a-1");
  const b = segments.find((segment) => segment.blockId === "b-1");
  assert.equal(a.snowdustReminder, null);
  assert.deepEqual(b.snowdustReminder, { mode: "on", advanceMinutes: 7 });
});

test("buildScheduledTaskBlockFromSegment carries snowdustReminder and deskVerification onto the final timeline block — this is the exact field passthrough that was previously dropped", () => {
  const overrides = { "card-1": { snowdustReminder: { mode: "on", advanceMinutes: 3 }, deskVerification: { mode: "on" } } };
  const [segment] = flattenPlannerTasks([studyTaskGroup("card", { manualStart: 600, segmentOverrides: overrides })], []);
  const block = buildScheduledTaskBlockFromSegment(segment, { start: segment.manualStart });
  assert.deepEqual(block.snowdustReminder, { mode: "on", advanceMinutes: 3 });
  assert.deepEqual(block.deskVerification, { mode: "on" });
  // Every other field addTaskBlock previously constructed must still be present.
  assert.equal(block.id, "card-1");
  assert.equal(block.studyMinutes, 50);
  assert.equal(block.categoryStatGroup, "study");
});

test("an inherited (no override) segment produces a block with snowdustReminder/deskVerification === null, never undefined-that-happens-to-look-falsy", () => {
  const [segment] = flattenPlannerTasks([studyTaskGroup("solo", { manualStart: 540 })], []);
  const block = buildScheduledTaskBlockFromSegment(segment, { start: segment.manualStart });
  assert.equal(block.snowdustReminder, null);
  assert.equal(block.deskVerification, null);
});
