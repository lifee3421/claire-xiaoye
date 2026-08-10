import assert from "node:assert/strict";
import test from "node:test";
import { applyPlannerPatch } from "./plannerPatchApply.js";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";
import { PLANNER_PATCH_SCHEMA_VERSION } from "../agent/plannerPatch.js";

const now = new Date("2026-08-10T02:00:00.000Z"); // 10:00 Beijing

function baseDraft(overrides = {}) {
  return {
    targetDate: "2026-08-10",
    wakeUpTime: "08:00",
    targetBedTime: "23:20",
    lunchStartTime: "12:00",
    lunchBlockMinutes: 70,
    startupBufferMinutes: 20,
    dinnerMinutes: 40,
    todayCustomBlocks: [
      { id: "old-task", title: "旧任务", categoryId: "study.math", categoryLevel2Id: "study.math", segments: [50], breakMinutes: 10, manualStart: 960, priority: 2, preferredPeriods: ["afternoon"] },
    ],
    todaySegmentOverrides: {},
    ...overrides,
  };
}

function patch(draft, changes) {
  return { schemaVersion: PLANNER_PATCH_SCHEMA_VERSION, date: draft.targetDate, baseRevision: computePlannerContextBaseRevision({ draft }), changes };
}

test("Snow-dust can create a normal card and first confirmed apply captures baseline", () => {
  const draft = baseDraft({ todayCustomBlocks: [] });
  const result = applyPlannerPatch({
    draft,
    patch: patch(draft, [{ type: "create_task", title: "午睡后整理", categoryId: "personal", estimatedMinutes: 30, start: "13:30" }]),
    now,
    idFactory: () => "snow-created",
  });
  assert.equal(result.ok, true);
  assert.ok(result.nextDraft.todayCustomBlocks.some((task) => task.id === "snow-created"));
  assert.equal(result.nextDraft.todayCustomBlocks.find((task) => task.id === "snow-created").manualStart, 810);
  assert.equal(result.nextDraft.baselinePlanSnapshot.targetDate, "2026-08-10");
  assert.ok(result.nextDraft.baselinePlanSnapshot.blocks.some((block) => block.id === "snow-created-1"));
});

test("Snow-dust can edit a future card in place", () => {
  const draft = baseDraft({ baselinePlanSnapshot: { schemaVersion: 1, targetDate: "2026-08-10", confirmedAt: "2026-08-10T00:00:00Z", blocks: [] } });
  const result = applyPlannerPatch({ draft, patch: patch(draft, [{ type: "edit_task", blockId: "old-task-1", title: "数学复习", estimatedMinutes: 40, breakMinutes: 5 }]), now });
  assert.equal(result.ok, true);
  const override = result.nextDraft.todaySegmentOverrides["old-task-1"];
  assert.equal(override.title, "数学复习");
  assert.equal(override.workMinutes, 40);
  assert.equal(override.restMinutes, 5);
});

test("Snow-dust can delete a future normal card but protected life anchors remain non-targetable", () => {
  const draft = baseDraft({ baselinePlanSnapshot: { schemaVersion: 1, targetDate: "2026-08-10", confirmedAt: "2026-08-10T00:00:00Z", blocks: [] } });
  const removed = applyPlannerPatch({ draft, patch: patch(draft, [{ type: "delete_task", blockId: "old-task-1" }]), now });
  assert.equal(removed.ok, true);
  assert.equal(removed.nextDraft.todaySegmentOverrides["old-task-1"].placement, "deleted");

  const protectedAttempt = applyPlannerPatch({ draft, patch: patch(draft, [{ type: "delete_task", blockId: "lunch-1" }]), now });
  assert.equal(protectedAttempt.ok, false);
  assert.equal(protectedAttempt.reason, "unresolvable_changes");
});
