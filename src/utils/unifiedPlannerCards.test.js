import test from "node:test";
import assert from "node:assert/strict";
import { LIFE_CATEGORY_IDS, allocateTasksAcrossDates, categoryCompletionFacts, ensureLifeCategories, ensureMorningRoutineCard, findDayStartAnchor, migrateLegacyFixedEvents, resolvePlannerTimelineStart, unifyPlannerDraftCards } from "./unifiedPlannerCards.js";

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

test("restores one durable morning routine card for older drafts without duplicates", () => {
  const migrated = ensureMorningRoutineCard({ targetDate: "2026-07-22", wakeUpTime: "08:00", morningPrepMinutes: 25, todayCustomBlocks: [], todaySegmentOverrides: {} });
  assert.equal(migrated.todayCustomBlocks.length, 1);
  assert.equal(migrated.todayCustomBlocks[0].categoryId, LIFE_CATEGORY_IDS.morningRoutine);
  assert.equal(migrated.todayCustomBlocks[0].systemRole, "day-start-anchor");
  assert.equal(migrated.todaySegmentOverrides["wake-prep-1"].manualStart, 480);
  const repeated = ensureMorningRoutineCard(migrated);
  assert.equal(repeated.todayCustomBlocks.length, 1);
});

test("repairs duplicate and malformed morning cards into one usable permanent anchor", () => {
  const repaired = ensureMorningRoutineCard({
    targetDate: "2026-07-22",
    wakeUpTime: "07:30",
    morningPrepMinutes: 20,
    todayCustomBlocks: [
      { id: "ghost", categoryId: LIFE_CATEGORY_IDS.morningRoutine, segments: [] },
      { id: "late", categoryId: LIFE_CATEGORY_IDS.morningRoutine, manualStart: 510, segments: [20] },
      { id: "early", categoryId: LIFE_CATEGORY_IDS.morningRoutine, manualStart: 480, segments: [25] },
    ],
    todaySegmentOverrides: { "ghost-1": { placement: "timeline" }, "late-1": { placement: "timeline" } },
  });
  assert.deepEqual(repaired.todayCustomBlocks.map((card) => card.id), ["early"]);
  assert.equal(repaired.todayCustomBlocks[0].systemRole, "day-start-anchor");
  assert.equal(repaired.todaySegmentOverrides["ghost-1"], undefined);
  assert.equal(repaired.todaySegmentOverrides["late-1"], undefined);
  assert.equal(repaired.todaySegmentOverrides["early-1"].locked, true);
});

test("keeps the latest persisted morning override as the source of truth after reload", () => {
  const restored = ensureMorningRoutineCard({
    todayCustomBlocks: [{ id: "wake-prep", categoryId: LIFE_CATEGORY_IDS.morningRoutine, manualStart: 450, segments: [20] }],
    todaySegmentOverrides: { "wake-prep-1": { placement: "timeline", manualStart: 480, workMinutes: 35, locked: true } },
  });
  assert.equal(restored.todayCustomBlocks[0].manualStart, 480);
  assert.deepEqual(restored.todayCustomBlocks[0].segments, [35]);
  assert.equal(restored.todaySegmentOverrides["wake-prep-1"].manualStart, 480);
  assert.equal(restored.todaySegmentOverrides["wake-prep-1"].workMinutes, 35);
});

test("timeline start prefers morning anchor, then the earliest current visible card, then a safe wake fallback", () => {
  assert.equal(resolvePlannerTimelineStart({ cards: [{ categoryId: LIFE_CATEGORY_IDS.morningRoutine, start: "08:00", end: "08:20" }, { categoryId: "math", start: "07:30", end: "08:00" }], wakeUpTime: "07:00" }), 480);
  assert.equal(resolvePlannerTimelineStart({ cards: [{ categoryId: "math", start: "08:30", end: "09:20", placement: "timeline" }], wakeUpTime: "07:30" }), 510);
  assert.equal(resolvePlannerTimelineStart({ cards: [{ categoryId: "math", start: "09:00", end: "09:50", placement: "timeline" }], wakeUpTime: "07:30" }), 540);
  assert.equal(resolvePlannerTimelineStart({ cards: [{ categoryId: "math", start: "09:00", end: "09:50", placement: "pool" }, { categoryId: "english", start: "10:00", end: "10:50", placement: "timeline" }], wakeUpTime: "07:30" }), 600);
  assert.equal(resolvePlannerTimelineStart({ cards: [], wakeUpTime: "", defaultWakeUpTime: "" }), 450);
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
