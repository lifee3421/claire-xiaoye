import assert from "node:assert/strict";
import test from "node:test";
import { buildPersistedPlannerFallback, buildPlannerRules } from "./plannerAutonomyContext.js";

test("server fallback reconstructs persisted timeline/pool/free capacity while page is closed", () => {
  const draft = {
    targetDate: "2026-08-10",
    wakeUpTime: "08:00",
    targetBedTime: "23:20",
    lunchStartTime: "12:00",
    lunchBlockMinutes: 70,
    startupBufferMinutes: 20,
    dinnerMinutes: 40,
    showerMinutes: 25,
    todayCustomBlocks: [
      { id: "math-custom", title: "数学", categoryId: "study.math", segments: [50], breakMinutes: 10, manualStart: 600, preferredPeriods: ["morning"], priority: 1 },
      { id: "paper-custom", title: "论文", categoryId: "study.paper", segments: [40], breakMinutes: 0, preferredPeriods: ["afternoon"], priority: 2 },
    ],
    todaySegmentOverrides: {},
  };
  const result = buildPersistedPlannerFallback({ draft, settings: {} });
  assert.ok(result.plan.blocks.some((block) => block.id === "math-custom-1"));
  assert.ok(result.plan.poolSegments.some((segment) => segment.blockId === "paper-custom-1"));
  assert.ok(result.systemCards.some((card) => card.id === "lunch"));
  assert.ok(result.plan.freeIntervals.length > 0);
});

test("saved templates expose enough task/timeline detail for Snow-dust to reuse them", () => {
  const result = buildPersistedPlannerFallback({
    draft: { targetDate: "2026-08-10", wakeUpTime: "08:00", targetBedTime: "23:20", todayCustomBlocks: [], todaySegmentOverrides: {} },
    settings: {
      defaultDayTemplateId: "tpl-1",
      dayTemplates: [{
        id: "tpl-1",
        name: "在家标准日",
        content: {
          defaultTaskGroups: [{ title: "专业课", categoryId: "study.professional", segments: [50, 50], breakMinutes: 10 }],
          timelineSegments: [{ title: "雅思", categoryId: "study.english", startMinute: 1140, workMinutes: 50, restMinutes: 10 }],
        },
      }],
    },
  });
  assert.equal(result.templates[0].isDefault, true);
  assert.deepEqual(result.templates[0].defaultTasks[0].segments, [50, 50]);
  assert.equal(result.templates[0].timeline[0].startMinute, 1140);
});

test("planner rules include meal nap shower boundaries plus custom user rules", () => {
  const rules = buildPlannerRules({
    draft: { lunchBlockMinutes: 70, startupBufferMinutes: 20, showerMinutes: 25, targetBedTime: "23:20" },
    settings: { snowdustPlannerRules: ["两节高强度学习之间休息20分钟"] },
  });
  assert.ok(rules.some((item) => /运动后必须留出洗澡/.test(item.text)));
  assert.ok(rules.some((item) => item.source === "user" && /高强度/.test(item.text)));
});
