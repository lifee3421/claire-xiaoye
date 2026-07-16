import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeScheduleAssistantDraft,
  normalizeScheduleAssistantSettings,
} from "./plannerNormalization.js";

const fallback = "2026-07-17";
const defaults = { lunchBlockMinutes: 90, formalRestBlocks: 1, maxConsecutiveBlocks: 2 };

test("keeps a latest complete draft without mutating its source", () => {
  const raw = { targetDate: fallback, fixedEvents: [{ id: "fixed-1" }], todayCustomBlocks: [{ id: "task-1" }], lunchBlockMinutes: 80 };
  const normalized = normalizeScheduleAssistantDraft(raw, { fallbackTargetDate: fallback, defaults });
  assert.equal(normalized.targetDate, fallback);
  assert.equal(normalized.fixedEvents.length, 1);
  assert.notEqual(normalized.fixedEvents, raw.fixedEvents);
  assert.equal(raw.lunchBlockMinutes, 80);
});

test("normalizes an old or empty draft safely", () => {
  const normalized = normalizeScheduleAssistantDraft({ savedOn: fallback, fixedEvents: undefined, todayCustomBlocks: undefined }, { fallbackTargetDate: fallback, defaults });
  assert.equal(normalized.targetDate, fallback);
  assert.deepEqual(normalized.fixedEvents, []);
  assert.deepEqual(normalized.todayCustomBlocks, []);
});

test("rejects invalid dates and non-finite continuity settings", () => {
  const normalized = normalizeScheduleAssistantDraft({ targetDate: "not-a-date", formalRestBlocks: "NaN", maxConsecutiveBlocks: Infinity }, { fallbackTargetDate: fallback, defaults });
  assert.equal(normalized.targetDate, fallback);
  assert.equal(normalized.formalRestBlocks, 1);
  assert.equal(normalized.maxConsecutiveBlocks, 2);
});

test("drops only malformed individual blocks", () => {
  const normalized = normalizeScheduleAssistantDraft({ targetDate: fallback, fixedEvents: [{ id: "good" }, null, "bad"], todayCustomBlocks: [null, { id: "custom" }] }, { fallbackTargetDate: fallback, defaults });
  assert.deepEqual(normalized.fixedEvents.map((item) => item.id), ["good"]);
  assert.deepEqual(normalized.todayCustomBlocks.map((item) => item.id), ["custom"]);
});

test("keeps a large template collection and normalizes malformed settings fields", () => {
  const settings = normalizeScheduleAssistantSettings({
    dayTemplates: Array.from({ length: 80 }, (_, index) => ({ id: `template-${index}` })).concat([null]),
    deletedDayTemplateSystemKeys: ["builtin-low", null, ""],
    englishRotationSettings: { enabledSkills: ["writing", null] },
  });
  assert.equal(settings.dayTemplates.length, 80);
  assert.deepEqual(settings.deletedDayTemplateSystemKeys, ["builtin-low"]);
  assert.deepEqual(settings.englishRotationSettings.enabledSkills, ["writing"]);
});

test("handles empty plans and non-array timeline-like fields", () => {
  const normalized = normalizeScheduleAssistantDraft({ targetDate: fallback, fixedEvents: {}, todayCustomBlocks: "broken" }, { fallbackTargetDate: fallback, defaults });
  assert.deepEqual(normalized.fixedEvents, []);
  assert.deepEqual(normalized.todayCustomBlocks, []);
});
