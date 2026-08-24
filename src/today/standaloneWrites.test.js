import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { validateStandaloneMutation, MAX_STANDALONE_CHANGES, sanitizeContentGoals, sanitizeChecklistItems } from "../server/plannerStandaloneEndpoints.js";
import { validatePatchConflicts } from "../schedule/plannerPatchApply.js";
import { computeTimelinePositionsPatch } from "../schedule/timelineRescheduleGate.js";
import { flattenPlannerTasks } from "../utils/plannerTimelineBlocks.js";

const baseBody = {
  operationId: "xiaoye:today:test",
  date: "2026-08-17",
  baseRevision: "rev:test",
};

function move(index) {
  const minute = 14 * 60 + index * 5;
  return {
    type: "move",
    blockId: `task-${index + 1}-1`,
    start: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
  };
}

test("standalone Today accepts a ripple batch larger than the desktop 3-change guard", () => {
  const problems = validateStandaloneMutation({ ...baseBody, changes: [move(0), move(1), move(2), move(3), move(4), move(5)] });
  assert.deepEqual(problems, []);
});

test("standalone Today still caps one interaction batch", () => {
  const changes = Array.from({ length: MAX_STANDALONE_CHANGES + 1 }, (_, index) => move(index));
  const problems = validateStandaloneMutation({ ...baseBody, changes });
  assert.ok(problems.some((problem) => problem.includes(`at most ${MAX_STANDALONE_CHANGES}`)));
});

test("pool replacement ignores the timeline block returned by the same atomic patch", () => {
  const draft = {
    targetDate: "2026-08-17",
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    lunchStartTime: "12:30",
    lunchBlockMinutes: 60,
    dinnerMinutes: 30,
  };
  const segments = [
    { blockId: "old-1", segmentTitle: "旧任务", placement: "timeline", manualStart: 14 * 60, occupiedDuration: 50, status: "pending" },
    { blockId: "pool-1", segmentTitle: "池任务", placement: "pool", manualStart: null, occupiedDuration: 50, status: "pending" },
  ];
  const positions = [{ id: "pool-1", start: 14 * 60, end: 14 * 60 + 50 }];

  const withoutRemoval = validatePatchConflicts({ draft, segments, positions });
  assert.equal(withoutRemoval.ok, false);
  assert.ok(withoutRemoval.conflicts.some((conflict) => conflict.withId === "old-1"));

  const atomicReplacement = validatePatchConflicts({ draft, segments, positions, removedBlockIds: ["old-1"] });
  assert.equal(atomicReplacement.ok, true);
  assert.deepEqual(atomicReplacement.conflicts, []);
});

test("an actually empty timeline interval is accepted and the moving block never conflicts with itself", () => {
  const draft = {
    targetDate: "2026-08-24",
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    lunchStartTime: "12:30",
    lunchBlockMinutes: 60,
    dinnerStartTime: "19:00",
    dinnerMinutes: 60,
  };
  const segments = [
    { blockId: "math-1", segmentTitle: "数学", placement: "timeline", manualStart: 14 * 60, occupiedDuration: 60, status: "pending" },
    { blockId: "english-1", segmentTitle: "英语", placement: "timeline", manualStart: 18 * 60, occupiedDuration: 50, status: "pending" },
  ];
  const result = validatePatchConflicts({
    draft,
    segments,
    positions: [{ id: "math-1", start: 16 * 60, end: 17 * 60 }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.conflicts, []);
});

test("returning a future block to the pool records its quick-restore origin", () => {
  const result = computeTimelinePositionsPatch({
    blocks: [{ id: "math-1", start: 16 * 60, end: 16 * 60 + 60, studyMinutes: 50, breakMinutes: 10, status: "pending" }],
    returnedToPool: ["math-1"],
    nowMinutes: 15 * 60,
    reason: "雪尘排程调整",
  });
  assert.equal(result.overridePatches["math-1"].placement, "pool");
  assert.equal(result.overridePatches["math-1"].manualStart, null);
  assert.equal(result.overridePatches["math-1"].lastTimelineStart, 16 * 60);
});

test("flattened pool segment exposes persisted quick-restore origin", () => {
  const segments = flattenPlannerTasks([{
    id: "math",
    title: "数学",
    categoryId: "math",
    segments: [50],
    breakMinutes: 10,
    priority: 1,
    segmentOverrides: {
      "math-1": { placement: "pool", manualStart: null, lastTimelineStart: 16 * 60, status: "pending" },
    },
  }]);
  assert.equal(segments[0].placement, "pool");
  assert.equal(segments[0].lastTimelineStart, 16 * 60);
});

test("standalone bridge is writable and no longer contains the Phase 1 read-only block", () => {
  const bridge = fs.readFileSync(new URL("../../public/today-standalone-bridge.js", import.meta.url), "utf8");
  const runtime = fs.readFileSync(new URL("./standaloneRuntime.js", import.meta.url), "utf8");
  assert.doesNotMatch(bridge, /同步联调中|这一版先只读|Phase 1.*只读/i);
  assert.match(bridge, /__SNOWDUST_TODAY_MUTATE__/);
  assert.match(runtime, /planner-standalone-mutate/);
  assert.match(runtime, /planner-standalone-meta/);
  assert.match(runtime, /planner-draft-sidecar/);
  assert.match(bridge, /today_content_save/);
  assert.match(bridge, /edit\.categoryId = after\.categoryId/);
});

test("milestone and checklist persistence keeps dates, weekly days and canonical categories", () => {
  const goals = sanitizeContentGoals([{ id: "g1", title: "高数强化", categoryId: "study.math", startDate: "2026-08-24", deadline: "2026-09-30", scheduleDays: [1, 3, 5, 9, 3], total: 30, done: 2, unit: "节", dailyAmount: 1 }]);
  assert.deepEqual(goals[0].scheduleDays, [1, 3, 5]);
  assert.equal(goals[0].categoryId, "study.math");
  assert.equal(goals[0].startDate, "2026-08-24");
  assert.equal(goals[0].deadline, "2026-09-30");

  const checklist = sanitizeChecklistItems([{ id: "c1", title: "背单词", categoryId: "study.english", startDate: "2026-08-24", endDate: "2026-08-31", dateMode: "range", startTime: "08:30", endTime: "09:00", days: [1, 2, 3, 4, 5], reminder: "5m", repeatEnd: "2026-12-31" }]);
  assert.equal(checklist[0].categoryId, "study.english");
  assert.equal(checklist[0].dateMode, "range");
  assert.equal(checklist[0].endDate, "2026-08-31");
  assert.deepEqual(checklist[0].days, [1, 2, 3, 4, 5]);
});
