import assert from "node:assert/strict";
import test from "node:test";
import { applySavedDayTemplate } from "./plannerTemplateApply.js";

test("saved template materializes boundaries pool tasks and timeline tasks in one operation", () => {
  const result = applySavedDayTemplate({
    draft: { targetDate: "2026-08-11", savedOn: "2026-08-11", todayCustomBlocks: [], todaySegmentOverrides: {} },
    settings: {
      dayTemplates: [{
        id: "home-standard",
        name: "在家标准日",
        content: {
          wakeUpTime: "08:30",
          targetBedTime: "23:20",
          lunchStartTime: "12:10",
          showerMinutes: 25,
          defaultTaskGroups: [{ sourceTaskId: "professional", title: "专业课", categoryId: "study.professional", categoryLevel2Id: "study.professional", segments: [50, 50], breakMinutes: 10, preferredPeriods: ["afternoon"] }],
          timelineSegments: [{ sourceTaskId: "english", sourceSegmentIndex: 1, title: "雅思", categoryId: "study.english", categoryLevel2Id: "study.english", startMinute: 1140, workMinutes: 50, restMinutes: 10 }],
        },
      }],
    },
    templateId: "home-standard",
    now: new Date("2026-08-10T12:00:00Z"),
    idFactory: (prefix, index) => `${prefix}-${index}`,
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextDraft.wakeUpTime, "08:30");
  assert.equal(result.nextDraft.sourceTemplateId, "home-standard");
  assert.ok(result.nextDraft.todayCustomBlocks.some((task) => task.title === "专业课"));
  const english = result.nextDraft.todayCustomBlocks.find((task) => task.title === "雅思");
  assert.ok(english);
  assert.equal(result.nextDraft.todaySegmentOverrides[`${english.id}-1`].manualStart, 1140);
});

test("reapplying same template replaces its own generated tasks instead of duplicating them", () => {
  const settings = { dayTemplates: [{ id: "t1", name: "T1", content: { defaultTaskGroups: [{ title: "数学", categoryId: "study.math", segments: [50] }] } }] };
  const first = applySavedDayTemplate({ draft: { targetDate: "2026-08-11", todayCustomBlocks: [], todaySegmentOverrides: {} }, settings, templateId: "t1", idFactory: () => "a" });
  const second = applySavedDayTemplate({ draft: first.nextDraft, settings, templateId: "t1", idFactory: () => "b" });
  const templateTasks = second.nextDraft.todayCustomBlocks.filter((task) => task.originTemplateId === "t1");
  assert.equal(templateTasks.length, 1);
  assert.equal(templateTasks[0].id, "b");
});

test("unknown template fails closed", () => {
  assert.deepEqual(applySavedDayTemplate({ draft: { targetDate: "2026-08-11" }, settings: {}, templateId: "missing" }), { ok: false, reason: "template_not_found", templateId: "missing" });
});
