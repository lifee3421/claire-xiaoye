import assert from "node:assert/strict";
import test from "node:test";
import { handlePlannerQuickContextRequest } from "./planner-quick-context.js";

function fakeDb(profile) {
  return {
    collection(name) {
      assert.equal(name, "users");
      return {
        doc() {
          return {
            async get() { return { exists: true, data: () => profile }; },
          };
        },
      };
    },
  };
}

test("quick context returns revision/timeline/pool without tracker expansion", async () => {
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
  const result = await handlePlannerQuickContextRequest({
    db: fakeDb(profile),
    uid: "u",
    date: "2026-08-11",
    now: new Date("2026-08-11T01:00:00.000Z"),
  });
  assert.equal(result.outcome, "ok");
  assert.match(result.context.baseRevision, /^v1:/);
  assert.equal(result.context.contextSource, "server_quick");
  assert.ok(result.context.timeline.some((item) => item.id === "math-1"));
  assert.ok(result.context.taskPool.some((item) => item.blockId === "paper-1"));
  assert.equal(result.context.trackers, undefined);
  assert.equal(result.context.reviewAttention, undefined);
  assert.equal(result.context.sharedLedger, undefined);
});
