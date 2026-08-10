import assert from "node:assert/strict";
import test from "node:test";
import { buildQuickPlannerContext } from "../../api/planner-context.js";

test("quick planner context exposes only the lightweight edit surface", () => {
  const profile = {
    timezone: "Asia/Shanghai",
    scheduleAssistantDraft: {
      targetDate: "2026-08-11",
      savedOn: "2026-08-11",
      wakeUpTime: "08:00",
      targetBedTime: "23:20",
      todayCustomBlocks: [
        { id: "math", title: "数学", categoryId: "study.math", segments: [50], breakMinutes: 10, manualStart: 600, placement: "timeline", priority: 1 },
        { id: "paper", title: "专业课", categoryId: "study.professional", segments: [50], breakMinutes: 10, placement: "pool", priority: 2 },
      ],
      todaySegmentOverrides: {},
    },
    scheduleAssistantSettings: {},
  };
  const context = buildQuickPlannerContext({
    profile,
    date: "2026-08-11",
    now: new Date("2026-08-11T01:00:00.000Z"),
  });
  assert.match(context.baseRevision, /^v1:/);
  assert.equal(context.contextSource, "server_quick");
  assert.ok(context.timeline.some((item) => item.id === "math-1"));
  assert.ok(context.taskPool.some((item) => item.blockId === "paper-1"));
  assert.equal(context.trackers, undefined);
  assert.equal(context.reviewAttention, undefined);
  assert.equal(context.sharedLedger, undefined);
});
