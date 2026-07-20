import test from "node:test";
import assert from "node:assert/strict";
import { LIFE_CATEGORY_IDS, allocateTasksAcrossDates, categoryCompletionFacts, ensureLifeCategories, findDayStartAnchor, migrateLegacyFixedEvents, unifyPlannerDraftCards } from "./unifiedPlannerCards.js";

test("legacy fixed events become ordinary cards without losing stable fields", () => {
  const cards = migrateLegacyFixedEvents([{ id: "meal-1", title: "Lunch", date: "2026-07-20", startTime: "12:00", endTime: "12:40", categoryId: LIFE_CATEGORY_IDS.lunch, status: "completed", note: "canteen" }]);
  assert.deepEqual({ id: cards[0].id, title: cards[0].title, date: cards[0].date, categoryId: cards[0].categoryId, status: cards[0].status, note: cards[0].note, segments: cards[0].segments, manualStart: cards[0].manualStart }, { id: "meal-1", title: "Lunch", date: "2026-07-20", categoryId: LIFE_CATEGORY_IDS.lunch, status: "completed", note: "canteen", segments: [40], manualStart: 720 });
  assert.equal("fixedEvents" in cards[0], false);
});

test("newly persisted drafts contain only unified cards", () => {
  const result = unifyPlannerDraftCards({ targetDate: "2026-07-20", fixedEvents: [{ id: "legacy", startTime: "09:00", endTime: "09:30", title: "old" }], fixedEventOverrides: {}, todayCustomBlocks: [] });
  assert.deepEqual(result.fixedEvents, []);
  assert.deepEqual(result.fixedEventOverrides, {});
  assert.equal(result.todayCustomBlocks[0].id, "legacy");
  assert.equal(result.todaySegmentOverrides.legacy.placement, "timeline");
  assert.equal(result.todaySegmentOverrides.legacy.manualStart, 540);
  assert.equal(result.todaySegmentOverrides.legacy.workMinutes, 30);
});

test("life taxonomy gains stable secondary categories without replacing existing categories", () => {
  const result = ensureLifeCategories([{ id: "study", children: [{ id: "math" }] }, { id: "life", children: [{ id: "personal" }] }]);
  const lifeIds = result.find((item) => item.id === "life").children.map((item) => item.id);
  assert.ok(lifeIds.includes("personal"));
  assert.ok(lifeIds.includes(LIFE_CATEGORY_IDS.morningRoutine));
  assert.ok(lifeIds.includes(LIFE_CATEGORY_IDS.lunch));
});

test("the earliest morning routine category card controls the day start", () => {
  const result = findDayStartAnchor([
    { id: "late", categoryId: LIFE_CATEGORY_IDS.morningRoutine, start: "08:00", end: "08:20" },
    { id: "early", categoryId: LIFE_CATEGORY_IDS.morningRoutine, start: "07:20", end: "07:40", title: "renamed" },
    { id: "first", categoryId: "math", start: "06:00", end: "07:00" },
  ]);
  assert.equal(result.id, "early");
  assert.equal(result.endMinute, 460);
  assert.equal(findDayStartAnchor([{ categoryId: "math", start: "06:00", end: "07:00" }]), null);
});

test("future allocation consumes each stable task once and honors explicit dates", () => {
  const dates = ["2026-07-21", "2026-07-22", "2026-07-23"];
  const result = allocateTasksAcrossDates([{ id: "a" }, { id: "b" }, { id: "c", targetDate: dates[2] }, { id: "a" }], dates);
  const all = Object.values(result).flat();
  assert.deepEqual(all.map((item) => item.sourceTaskId).sort(), ["a", "b", "c"]);
  assert.equal(result[dates[2]][0].sourceTaskId, "c");
  assert.equal(new Set(all.map((item) => item.id)).size, 3);
});

test("life category completion facts use counts and rates, not study minutes", () => {
  const facts = categoryCompletionFacts([{ date: "2026-07-20", blocks: [{ categoryId: LIFE_CATEGORY_IDS.lunch, status: "completed" }, { categoryId: LIFE_CATEGORY_IDS.lunch, status: "pending" }] }], LIFE_CATEGORY_IDS.lunch);
  assert.deepEqual(facts, [{ reviewDate: "2026-07-20", categoryId: LIFE_CATEGORY_IDS.lunch, completed: 1, total: 2, completionRate: 0.5 }]);
});
