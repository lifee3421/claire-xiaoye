import assert from "node:assert/strict";
import test from "node:test";
import { resolvePersistedPlannerDraft } from "./planner-context.js";

test("planner-context reads scheduleAssistantDraft, never Daily Review state", () => {
  const live = {
    targetDate: "2026-08-08",
    updatedAt: "2026-08-08T05:13:00.000Z",
    todaySegmentOverrides: { "math-1": { manualStart: 780 } },
  };
  const profile = { scheduleAssistantDraft: live };

  assert.equal(resolvePersistedPlannerDraft(profile, "2026-08-08"), live);
});

test("planner-context can read an archived planner day without inventing a current draft", () => {
  const archived = {
    targetDate: "2026-08-07",
    updatedAt: "2026-08-07T13:00:00.000Z",
    todaySegmentOverrides: {},
    archivedAt: "2026-08-08T00:00:00.000Z",
  };
  const profile = {
    scheduleAssistantDraft: { targetDate: "2026-08-08" },
    scheduleAssistantDraftArchive: [archived],
  };

  assert.equal(resolvePersistedPlannerDraft(profile, "2026-08-07"), archived);
});

test("missing planner day returns only a date shell instead of borrowing another date", () => {
  const profile = {
    scheduleAssistantDraft: { targetDate: "2026-08-08", updatedAt: "2026-08-08T05:13:00.000Z" },
  };

  assert.deepEqual(resolvePersistedPlannerDraft(profile, "2026-08-09"), { targetDate: "2026-08-09" });
});
