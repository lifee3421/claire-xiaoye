import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerDateWritePatch, resolveInitialPlannerDraft, resolvePlannerDraftForDate } from "./plannerDatePersistence.js";

test("future Snow-dust plan writes into archive without hijacking today's live draft", () => {
  const profile = {
    scheduleAssistantDraft: { targetDate: "2026-08-10", title: "today" },
    scheduleAssistantDraftArchive: [],
  };
  const tomorrow = { targetDate: "2026-08-11", savedOn: "2026-08-11", title: "tomorrow prepared" };
  const patch = buildPlannerDateWritePatch(profile, "2026-08-11", tomorrow);
  assert.equal(patch.scheduleAssistantDraft, undefined);
  assert.equal(patch.scheduleAssistantDraftArchive[0].title, "tomorrow prepared");
});

test("same-date Snow-dust write updates live draft directly", () => {
  const profile = { scheduleAssistantDraft: { targetDate: "2026-08-10", title: "old" }, scheduleAssistantDraftArchive: [] };
  const next = { targetDate: "2026-08-10", title: "new" };
  assert.deepEqual(buildPlannerDateWritePatch(profile, "2026-08-10", next), { scheduleAssistantDraft: next });
});

test("server resolves archived or new date shell independently from current live date", () => {
  const profile = {
    scheduleAssistantDraft: { targetDate: "2026-08-10" },
    scheduleAssistantDraftArchive: [{ targetDate: "2026-08-11", savedOn: "2026-08-11", value: 42 }],
  };
  assert.equal(resolvePlannerDraftForDate(profile, "2026-08-11").draft.value, 42);
  assert.deepEqual(resolvePlannerDraftForDate(profile, "2026-08-12"), { draft: { targetDate: "2026-08-12", savedOn: "2026-08-12" }, source: "new" });
});

test("browser startup prefers a Snow-prepared archive for Today over a mismatched live date", () => {
  const preparedToday = { targetDate: "2026-08-11", savedOn: "2026-08-11", title: "Snow plan" };
  const profile = {
    scheduleAssistantDraft: { targetDate: "2026-08-10", title: "yesterday" },
    scheduleAssistantDraftArchive: [preparedToday],
  };
  assert.equal(resolveInitialPlannerDraft(profile, "2026-08-11"), preparedToday);
});
