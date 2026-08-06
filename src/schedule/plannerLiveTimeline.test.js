import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_MOVABLE_TASK_IDS,
  PROTECTED_SYSTEM_CARD_IDS,
  buildPlannerTaskGroups,
  findPlannerOverlaps,
  isSundayDate,
  plannerCategoryId,
  resolveEnglishSkills,
  resolvePlannerTemplates,
  resolvePlannerTimelineBounds,
  resolveSystemCardIntervals,
  splitLongPlannerMinutes,
} from "./plannerLiveTimeline.js";

function draft(overrides = {}) {
  return {
    targetDate: "2026-08-06", // Thursday
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    lunchStartTime: "12:30",
    lunchBlockMinutes: 40,
    startupBufferMinutes: 30,
    dinnerMinutes: 40,
    thesisMinutes: 90,
    professionalMinutes: 50,
    exerciseMinutes: 40,
    exerciseType: "正式运动",
    formalRestMinutes: 30,
    formalRestBlocks: 1,
    systemDevelopmentLimit: "max_30",
    todayCustomBlocks: [],
    todaySegmentOverrides: {},
    todayTaskOverrides: {},
    deletedTodayTaskIds: [],
    fixedEvents: [],
    fixedEventOverrides: {},
    ...overrides,
  };
}

const mathTemplate = { lectureBlocks50: 2, exerciseBlocks50: 1, reviewBlocks30: 1, errorReviewBlocks50: 0, summaryBlocks30: 0 };
const englishTemplate = { wordMinutes: 30, skillMinutes: 40 };
const englishSkills = ["writing", "speaking"];

test("buildPlannerTaskGroups produces every enabled built-in group with correct segment structure", () => {
  const groups = buildPlannerTaskGroups({ draft: draft(), mathTemplate, englishTemplate, englishSkills, autoContext: {} });
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
  assert.deepEqual(byId["math-lecture"].segments, [50, 50]);
  assert.deepEqual(byId["math-exercise"].segments, [50]);
  assert.deepEqual(byId["math-review"].segments, [30]);
  assert.equal(byId["math-error"], undefined, "zero-block category is dropped entirely");
  assert.deepEqual(byId.english.segments, [30, 40, 40]);
  assert.deepEqual(byId.thesis.segments, splitLongPlannerMinutes(90));
  assert.deepEqual(byId.professional.segments, [50]);
  assert.deepEqual(byId.exercise.segments, [40]);
  assert.deepEqual(byId["formal-rest"].segments, [30]);
  assert.deepEqual(byId.system.segments, [30]);
});

test("every id buildPlannerTaskGroups can emit for a built-in category is in BUILTIN_MOVABLE_TASK_IDS", () => {
  const groups = buildPlannerTaskGroups({ draft: draft(), mathTemplate, englishTemplate, englishSkills, autoContext: { recentReadingTitle: "《文明》" } });
  const builtinIds = groups.map((g) => g.id).filter((id) => !id.startsWith("legacy-") && id !== "wake-prep");
  builtinIds.forEach((id) => assert.ok(BUILTIN_MOVABLE_TASK_IDS.has(id), `expected ${id} to be in BUILTIN_MOVABLE_TASK_IDS`));
});

test("reading group's very existence (not just its note) depends on autoContext.recentReadingTitle", () => {
  const without = buildPlannerTaskGroups({ draft: draft(), mathTemplate, englishTemplate, englishSkills, autoContext: {} });
  assert.equal(without.find((g) => g.id === "reading"), undefined);
  const withTitle = buildPlannerTaskGroups({ draft: draft(), mathTemplate, englishTemplate, englishSkills, autoContext: { recentReadingTitle: "《文明》" } });
  assert.ok(withTitle.find((g) => g.id === "reading"));
});

test("weekly-review only appears on Sunday", () => {
  const sunday = buildPlannerTaskGroups({ draft: draft({ targetDate: "2026-08-09" }), mathTemplate, englishTemplate, englishSkills, autoContext: {} });
  assert.ok(sunday.find((g) => g.id === "weekly-review"));
  const thursday = buildPlannerTaskGroups({ draft: draft(), mathTemplate, englishTemplate, englishSkills, autoContext: {} });
  assert.equal(thursday.find((g) => g.id === "weekly-review"), undefined);
});

test("deletedTodayTaskIds drops a built-in group entirely", () => {
  const groups = buildPlannerTaskGroups({ draft: draft({ deletedTodayTaskIds: ["thesis"] }), mathTemplate, englishTemplate, englishSkills, autoContext: {} });
  assert.equal(groups.find((g) => g.id === "thesis"), undefined);
});

test("todayTaskOverrides can override a built-in group's segments", () => {
  const groups = buildPlannerTaskGroups({ draft: draft({ todayTaskOverrides: { exercise: { segments: [60] } } }), mathTemplate, englishTemplate, englishSkills, autoContext: {} });
  assert.deepEqual(groups.find((g) => g.id === "exercise").segments, [60]);
});

test("todayCustomBlocks and legacy fixed events both flow through the same pushGroup pipeline", () => {
  const groups = buildPlannerTaskGroups({
    draft: draft({
      todayCustomBlocks: [{ id: "custom-1", title: "自定义", categoryId: "personal", segments: [30], breakMinutes: 0 }],
      fixedEvents: [{ id: "meeting-1", title: "会议", startTime: "10:00", endTime: "10:30" }],
    }),
    mathTemplate, englishTemplate, englishSkills, autoContext: {},
  });
  assert.ok(groups.find((g) => g.id === "custom-1"));
  const legacy = groups.find((g) => g.id === "meeting-1");
  assert.ok(legacy);
  assert.equal(legacy.source, "legacy-fixed-event");
});

test("resolveSystemCardIntervals produces exactly the 6 protected ids, each stamped source: system-life-card", () => {
  const d = draft();
  const { timelineStart, timelineEnd } = resolvePlannerTimelineBounds(d);
  const cards = resolveSystemCardIntervals({ draft: d, timelineStart, timelineEnd, effectiveMorningPrepMinutes: 20 });
  const ids = cards.map((c) => c.id);
  assert.deepEqual(new Set(ids), PROTECTED_SYSTEM_CARD_IDS);
  cards.forEach((card) => assert.equal(card.source, "system-life-card"));
});

test("resolveSystemCardIntervals: lunch/dinner respect draft overrides", () => {
  const d = draft({ lunchStartTime: "13:00", dinnerMinutes: 25 });
  const { timelineStart, timelineEnd } = resolvePlannerTimelineBounds(d);
  const cards = resolveSystemCardIntervals({ draft: d, timelineStart, timelineEnd, effectiveMorningPrepMinutes: 20 });
  const lunch = cards.find((c) => c.id === "lunch");
  assert.equal(lunch.start, 13 * 60);
  const dinner = cards.find((c) => c.id === "dinner");
  assert.equal(dinner.end - dinner.start, 25);
});

test("resolvePlannerTimelineBounds derives start from wakeUpTime and end from targetBedTime", () => {
  const bounds = resolvePlannerTimelineBounds(draft());
  assert.equal(bounds.timelineStart, 7 * 60 + 30);
  assert.equal(bounds.timelineEnd, 23 * 60 + 20);
});

test("resolveEnglishSkills: manual mode returns the draft's explicit skills, deduped", () => {
  const skills = resolveEnglishSkills(draft({ englishSkill: "writing", englishSecondSkill: "writing" }), {}, [], { skillMode: "manual", skillCount: 2, manualSkills: ["reading"] });
  assert.deepEqual(skills, ["writing", "reading"]);
});

test("resolveEnglishSkills: recommended mode is deterministic given the same settlements — no Date.now()/Math.random()", () => {
  const settings = { englishRotationSettings: { enabledSkills: ["writing", "speaking", "reading", "listening"] } };
  const settlements = [{ subjects: { ielts: { progress: ["写作 200字"] } } }];
  const a = resolveEnglishSkills(draft(), settings, settlements, { skillCount: 2 });
  const b = resolveEnglishSkills(draft(), settings, settlements, { skillCount: 2 });
  assert.deepEqual(a, b);
});

test("resolvePlannerTemplates falls back to defaults when settings arrays are empty, and picks by id otherwise", () => {
  const { mathTemplate: fallback } = resolvePlannerTemplates(draft(), {});
  assert.equal(fallback.id, "standard-math-day");
  const { mathTemplate: picked } = resolvePlannerTemplates(draft({ mathTemplateId: "high-intensity-math" }), { mathTemplates: [{ id: "high-intensity-math", lectureBlocks50: 5 }] });
  assert.equal(picked.lectureBlocks50, 5);
});

test("splitLongPlannerMinutes: exact real behavior — 90 stays a single block, values >100 chunk in 50s", () => {
  assert.deepEqual(splitLongPlannerMinutes(0), []);
  assert.deepEqual(splitLongPlannerMinutes(50), [50]);
  assert.deepEqual(splitLongPlannerMinutes(90), [90]);
  assert.deepEqual(splitLongPlannerMinutes(130), [50, 30, 50]);
});

test("findPlannerOverlaps detects a real overlap and ignores adjacent/non-overlapping blocks", () => {
  const overlap = findPlannerOverlaps([{ id: "a", start: 600, end: 660 }, { id: "b", start: 630, end: 690 }]);
  assert.equal(overlap.length, 1);
  const adjacent = findPlannerOverlaps([{ id: "a", start: 600, end: 660 }, { id: "b", start: 660, end: 690 }]);
  assert.equal(adjacent.length, 0);
});

test("isSundayDate", () => {
  assert.equal(isSundayDate("2026-08-09"), true);
  assert.equal(isSundayDate("2026-08-06"), false);
});

test("plannerCategoryId resolves both canonical and legacy ids to the same static category", () => {
  assert.equal(plannerCategoryId({ categoryId: "study.math" }), "math");
  assert.equal(plannerCategoryId("数学"), "math");
});
