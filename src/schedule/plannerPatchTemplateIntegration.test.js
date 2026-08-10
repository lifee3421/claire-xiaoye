import assert from "node:assert/strict";
import test from "node:test";
import { applyPlannerPatch } from "./plannerPatchApply.js";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";
import { PLANNER_PATCH_SCHEMA_VERSION } from "../agent/plannerPatch.js";

test("PlannerPatch apply_template materializes a saved routine and captures baseline in one confirmed apply", () => {
  const draft = { targetDate: "2026-08-11", savedOn: "2026-08-11", todayCustomBlocks: [], todaySegmentOverrides: {} };
  const settings = {
    dayTemplates: [{
      id: "home-standard",
      name: "在家标准日",
      content: {
        wakeUpTime: "08:30",
        targetBedTime: "23:20",
        lunchStartTime: "12:00",
        lunchBlockMinutes: 70,
        startupBufferMinutes: 20,
        defaultTaskGroups: [{ title: "专业课", categoryId: "study.professional", segments: [50], breakMinutes: 10, preferredPeriods: ["afternoon"] }],
        timelineSegments: [{ title: "数学", categoryId: "study.math", startMinute: 600, workMinutes: 50, restMinutes: 10 }],
      },
    }],
  };
  const patch = {
    schemaVersion: PLANNER_PATCH_SCHEMA_VERSION,
    date: "2026-08-11",
    baseRevision: computePlannerContextBaseRevision({ draft }),
    changes: [{ type: "apply_template", templateId: "home-standard" }],
  };
  const result = applyPlannerPatch({ draft, settings, patch, now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(result.ok, true);
  assert.equal(result.nextDraft.sourceTemplateId, "home-standard");
  assert.match(result.summary, /套用模板 1 个/);
  assert.ok(result.nextDraft.todayCustomBlocks.some((task) => task.title === "专业课"));
  assert.ok(result.nextDraft.todayCustomBlocks.some((task) => task.title === "数学"));
  assert.ok(result.nextDraft.baselinePlanSnapshot);
});
