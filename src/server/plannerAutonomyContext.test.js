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

test("personal planner rhythm comes only from editable user rules", () => {
  const custom = [
    "午间整体120分钟：40分钟做饭吃饭 + 30分钟午睡 + 剩余时间自由。",
    "学习默认50+10；如果容量不够可以适当调整。",
    "不要主动安排长休息。",
    "今天英语优先放下午。",
  ];
  const rules = buildPlannerRules({
    draft: { showerMinutes: 25, targetBedTime: "23:20" },
    settings: { snowdustPlannerRules: custom },
  });

  assert.equal(rules.filter((item) => item.source === "system").length, 5);
  assert.equal(rules.filter((item) => item.source === "user").length, custom.length);
  assert.ok(rules.some((item) => item.source === "user" && /120分钟/.test(item.text)));
  assert.ok(rules.some((item) => item.source === "user" && /50\+10/.test(item.text)));
  assert.ok(rules.some((item) => item.source === "user" && /不要主动安排长休息/.test(item.text)));
  assert.ok(rules.some((item) => /运动后必须留出洗澡/.test(item.text)));
  assert.ok(rules.some((item) => item.source === "system" && /reviewAttention/.test(item.text)));
  assert.ok(rules.some((item) => item.source === "system" && /sharedLedger/.test(item.text)));
  assert.ok(!rules.some((item) => item.source === "system" && /120分钟|50\+10|长休息/.test(item.text)));
});

test("deleting a personal rule actually removes it from Snow-dust context", () => {
  const rules = buildPlannerRules({
    draft: { targetBedTime: "23:20" },
    settings: { snowdustPlannerRules: ["学习块改成45+10"] },
  });
  assert.ok(rules.some((item) => item.source === "user" && /45\+10/.test(item.text)));
  assert.ok(!rules.some((item) => /50\+10|120分钟|长休息/.test(item.text)));
});
