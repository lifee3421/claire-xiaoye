import test from "node:test";
import assert from "node:assert/strict";
import { buildCategoryTimeProgress, buildLifeMaintenanceSummary, buildReviewTrackerSummary, buildStudyComposition, buildTaskPlacementProgress, formatDuration, groupTaskPlacementProgress, normalizeMaintenanceItemOrder, normalizePlannerCategoryOrder, readReviewField, sortCategoriesByOrder, sortLifeMaintenanceItems, summarizePeriodUsage } from "./plannerOverview.js";

test("placement progress aggregates timeline blocks by task group, not completion", () => {
  const result = buildTaskPlacementProgress({
    taskGroups: [{ id: "math", title: "数学｜网课", category: "数学", segments: [50, 50, 50] }],
    blocks: [
      { kind: "task", taskId: "math", status: "completed" },
      { kind: "task", taskId: "math", status: "pending" },
    ],
  });
  assert.deepEqual(result.rows[0], { id: "math", title: "数学｜网课", category: "数学", categoryId: "数学", total: 3, inserted: 2, remaining: 1 });
  assert.equal(result.categories[0].inserted, 2);
});

test("face mask uses structured review history and a calendar three-day interval", () => {
  const mask = buildLifeMaintenanceSummary({
    today: "2026-07-16",
    items: [{ id: "mask", name: "面膜", intervalDays: 3, remindAheadDays: 0 }],
    settlements: [{ reviewDate: "2026-07-13", health: { maskStatus: "已敷" } }],
  }).find((item) => item.id === "mask");
  assert.equal(mask.lastCompletedDate, "2026-07-13");
  assert.equal(mask.dueAt, "2026-07-16");
  assert.equal(mask.status, "due");
});

test("maintenance without a structured completion stays unavailable rather than inventing a due date", () => {
  const mask = buildLifeMaintenanceSummary({ today: "2026-07-16", items: [{ id: "mask", name: "面膜" }], settlements: [] }).find((item) => item.id === "mask");
  assert.equal(mask.status, "unavailable");
  assert.equal(mask.dueAt, "");
});

test("category order changes display only and keeps unknown categories at the end", () => {
  const result = sortCategoriesByOrder([{ id: "unknown", label: "自定义" }, { id: "english", label: "英语" }, { id: "math", label: "数学" }], ["math", "english"]);
  assert.deepEqual(result.map((item) => item.id), ["math", "english", "unknown"]);
});

test("reset category order restores defaults while retaining custom categories at the end", () => {
  const result = normalizePlannerCategoryOrder([], ["math", "english", "custom-research"]);
  assert.deepEqual(result.slice(-1), ["custom-research"]);
  assert.ok(result.indexOf("math") < result.indexOf("custom-research"));
  assert.ok(result.indexOf("english") < result.indexOf("custom-research"));
});

test("period usage counts only overlap from real timeline blocks", () => {
  const result = summarizePeriodUsage({ timeline: [{ start: 8 * 60, end: 9 * 60 }, { start: 12 * 60 + 30, end: 13 * 60 + 30 }], dayStart: 8 * 60, lunchStart: 12 * 60, lunchEnd: 13 * 60, eveningStart: 18 * 60, dayEnd: 22 * 60 });
  assert.deepEqual(result.morning, { scheduledMinutes: 60, availableMinutes: 240, percent: 25 });
  assert.deepEqual(result.afternoon, { scheduledMinutes: 30, availableMinutes: 300, percent: 10 });
  assert.deepEqual(result.evening, { scheduledMinutes: 0, availableMinutes: 240, percent: 0 });
});

test("period usage reuses engine capacity after fixed commute blocks", () => {
  const result = summarizePeriodUsage({
    segments: [
      { key: "morning", availableMinutes: 180, scheduledTaskFootprintMinutes: 90 },
      { key: "afternoon", availableMinutes: 240, scheduledTaskFootprintMinutes: 120 },
      { key: "evening", availableMinutes: 0, scheduledTaskFootprintMinutes: 0 },
    ],
  });
  assert.deepEqual(result.morning, { scheduledMinutes: 90, availableMinutes: 180, percent: 50 });
  assert.deepEqual(result.evening, { scheduledMinutes: 0, availableMinutes: 0, percent: 0 });
});

test("study composition ignores fixed and non-study blocks", () => {
  const result = buildStudyComposition({ blocks: [{ kind: "task", categoryId: "math", category: "数学", studyMinutes: 50 }, { kind: "fixed", categoryId: "math", studyMinutes: 30 }, { kind: "task", categoryId: "exercise", category: "运动", studyMinutes: 40 }] }, (block) => block.categoryId === "math");
  assert.deepEqual(result, { rows: [{ id: "math", label: "数学", minutes: 50 }], totalMinutes: 50 });
});

test("placement progress nests each task group under its ordered category", () => {
  const groups = groupTaskPlacementProgress({
    taskGroups: [
      { id: "english-1", title: "听力", categoryId: "english", category: "英语", segments: [50, 50] },
      { id: "math-1", title: "网课", categoryId: "math", category: "数学", segments: [50, 50, 50] },
    ],
    blocks: [{ kind: "task", taskId: "math-1" }, { kind: "task", taskId: "math-1" }, { kind: "task", taskId: "english-1" }],
  }, ["math", "english"]);
  assert.deepEqual(groups.map((group) => group.categoryId), ["math", "english"]);
  assert.deepEqual(groups[0].rows.map((row) => [row.title, row.inserted, row.total]), [["网课", 2, 3]]);
});

test("maintenance order keeps legacy items and appends new items", () => {
  assert.deepEqual(normalizeMaintenanceItemOrder(["mask"], [{ id: "mask" }, { id: "reading" }]), ["mask", "reading"]);
  assert.deepEqual(sortLifeMaintenanceItems([{ id: "reading" }, { id: "mask" }, { id: "exercise" }], ["mask", "exercise", "reading"]).map((item) => item.id), ["mask", "exercise", "reading"]);
});

test("category time progress aggregates timeline duration by level-two category", () => {
  const rows = buildCategoryTimeProgress({
    categoryTree: [{ id: "study", children: [{ id: "study.math", name: "数学" }, { id: "study.economy", name: "专业课" }] }],
    categoryTargets: { "study.math": 300 },
    timelineBlocks: [{ kind: "task", categoryLevel2Id: "study.math", start: 480, end: 580 }, { kind: "task", categoryLevel2Id: "study.math", start: 600, end: 700 }],
  });
  assert.deepEqual(rows[0], { categoryId: "study.math", categoryLabel: "数学", scheduledMinutes: 200, targetMinutes: 300, differenceMinutes: -100, ratio: 2 / 3 });
});

test("formats durations and reports target overruns", () => {
  assert.equal(formatDuration(40), "40min");
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(90), "1h30min");
  assert.equal(formatDuration(200), "3h20min");
});

test("review field reading and interval trackers use review facts only", () => {
  assert.equal(readReviewField({ health: { maskStatus: "已敷" } }, ["health", "maskStatus"]), "已敷");
  const result = buildReviewTrackerSummary({ tracker: { fieldPath: ["health", "maskStatus"], goal: { kind: "interval", every: 3, unit: "day" } }, settlements: [{ reviewDate: "2026-07-13", health: { maskStatus: "已敷" } }], today: "2026-07-16" });
  assert.equal(result.status.kind, "due");
  assert.equal(result.lastCompletedDate, "2026-07-13");
});

test("review trackers calculate natural periods and deadlines from structured values", () => {
  const settlements = [
    { reviewDate: "2026-07-13", reviewData: { study: { english: { totalMinutes: 60 } } } },
    { reviewDate: "2026-07-15", reviewData: { study: { english: { totalMinutes: 90 } } } },
  ];
  const weekly = buildReviewTrackerSummary({ tracker: { fieldPath: ["study", "english", "totalMinutes"], goal: { kind: "period", period: "week", measure: "duration", targetMinutes: 180 } }, settlements, today: "2026-07-16" });
  assert.equal(weekly.windowMinutes, 150);
  assert.equal(weekly.status.kind, "in_progress");
  const deadline = buildReviewTrackerSummary({ tracker: { fieldPath: ["study", "english", "totalMinutes"], goal: { kind: "deadline", deadline: "2026-07-16", measure: "duration", targetMinutes: 150, remindAheadDays: 1 } }, settlements, today: "2026-07-16" });
  assert.equal(deadline.status.label, "目标已达成");
});

test("review trackers ignore unrecorded boolean facts and count structured selfcare completions", () => {
  const tracker = { fieldPath: ["selfcare", "today", "mask"], goal: { kind: "interval", every: 3, unit: "day" } };
  const result = buildReviewTrackerSummary({
    tracker,
    settlements: [
      { reviewDate: "2026-07-12", reviewData: { selfcare: { today: { mask: "unrecorded" } } } },
      { reviewDate: "2026-07-13", reviewData: { selfcare: { today: { mask: "yes" } } } },
    ],
    today: "2026-07-16",
  });
  assert.equal(result.completedDates.length, 1);
  assert.equal(result.lastCompletedDate, "2026-07-13");
  assert.equal(result.status.kind, "due");
});

test("review tracker metrics expose consecutive day and week streaks", () => {
  const result = buildReviewTrackerSummary({
    tracker: { fieldPath: ["study", "english", "totalMinutes"], goal: { kind: "period", period: "week", measure: "activeDays", target: 3 } },
    settlements: [
      { reviewDate: "2026-07-01", reviewData: { study: { english: { totalMinutes: 30 } } } },
      { reviewDate: "2026-07-08", reviewData: { study: { english: { totalMinutes: 30 } } } },
      { reviewDate: "2026-07-15", reviewData: { study: { english: { totalMinutes: 30 } } } },
      { reviewDate: "2026-07-16", reviewData: { study: { english: { totalMinutes: 30 } } } },
    ],
    today: "2026-07-16",
  });
  assert.equal(result.metrics.streakDays, 2);
  assert.equal(result.metrics.streakWeeks, 3);
});
