import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerContext, computePlannerContextBaseRevision } from "./buildPlannerContext.js";

const now = new Date("2026-08-06T02:00:00.000Z");

function plan(overrides = {}) {
  return {
    wakeUpTime: "07:30",
    blocks: [
      { id: "fixed-1", title: "早餐", start: 540, end: 570, kind: "task", categoryId: "life.meal", categoryStatGroup: "life", status: "pending", locked: true, breakMinutes: 0 },
      { id: "math-1", title: "数学 50", start: 600, end: 660, kind: "task", categoryId: "study.math", categoryStatGroup: "study", status: "completed", locked: false, breakMinutes: 10 },
      { id: "rescheduled-1", title: "英语（旧）", start: 700, end: 760, kind: "task", categoryId: "study.english", categoryStatGroup: "study", status: "rescheduled", locked: false },
      { id: "fixed-note", title: "备注块", start: 800, end: 820, kind: "fixed" }, // non-task kind must be dropped
    ],
    poolSegments: [
      { blockId: "math-2", id: "math", segmentTitle: "数学 50", categoryId: "study.math", duration: 50, occupiedDuration: 60, breakAfter: 10, priority: 2, preferredPeriods: ["afternoon"], splittable: true },
      { blockId: "math-3", id: "math", segmentTitle: "数学 50 2/2", categoryId: "study.math", duration: 50, occupiedDuration: 60, breakAfter: 10, priority: 2, preferredPeriods: ["afternoon"], splittable: true },
    ],
    freeIntervals: [{ start: 780, end: 900 }],
    segmentFree: { afternoon: 120, evening: 60 },
    metrics: { freeMinutes: 180 },
    loadStatus: "合理",
    warnings: ["示例警告"],
    conflicts: [],
    ...overrides,
  };
}

function draft(overrides = {}) {
  return {
    targetDate: "2026-08-06",
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    scene: "school",
    updatedAt: "2026-08-06T01:00:00.000Z",
    baselinePlanSnapshot: null,
    ...overrides,
  };
}

test("timeline only includes live task-kind blocks — superseded (rescheduled/cancelled) history and non-task kinds are dropped", () => {
  const context = buildPlannerContext({ date: "2026-08-06", now, draft: draft(), plan: plan() });
  const ids = context.timeline.map((block) => block.id);
  assert.deepEqual(ids, ["fixed-1", "math-1"]);
});

test("locked blocks are surfaced both per-block and in constraints.lockedBlockIds", () => {
  const context = buildPlannerContext({ date: "2026-08-06", now, draft: draft(), plan: plan() });
  const fixed = context.timeline.find((block) => block.id === "fixed-1");
  assert.equal(fixed.locked, true);
  assert.deepEqual(context.constraints.lockedBlockIds, ["fixed-1"]);
});

test("taskPool preserves every remaining segment for a task, not just a title string", () => {
  const context = buildPlannerContext({ date: "2026-08-06", now, draft: draft(), plan: plan() });
  assert.equal(context.taskPool.length, 2);
  assert.equal(context.taskPool[0].taskId, "math");
  assert.equal(context.taskPool[0].duration, 50);
  assert.equal(context.taskPool[1].blockId, "math-3");
});

test("capacity is copied verbatim from the already-computed plan, not recomputed", () => {
  const context = buildPlannerContext({ date: "2026-08-06", now, draft: draft(), plan: plan() });
  assert.deepEqual(context.capacity.freeIntervals, [{ start: 780, end: 900 }]);
  assert.deepEqual(context.capacity.segmentFree, { afternoon: 120, evening: 60 });
  assert.equal(context.capacity.freeMinutes, 180);
  assert.equal(context.capacity.loadStatus, "合理");
  assert.deepEqual(context.capacity.warnings, ["示例警告"]);
});

test("targets carry source/totalMinutes/byCategory and trimmed per-category progress", () => {
  const context = buildPlannerContext({
    date: "2026-08-06",
    now,
    draft: draft(),
    plan: plan(),
    effectiveStudyTarget: { source: "draft", totalMinutes: 200, byCategory: { "study.math": 120, "study.english": 80 } },
    studyTargetProgress: [{ categoryId: "study.math", categoryLabel: "数学", scheduledMinutes: 60, targetMinutes: 120, differenceMinutes: -60, ratio: 0.5, tracked: true }],
  });
  assert.equal(context.targets.totalMinutes, 200);
  assert.deepEqual(context.targets.byCategory, { "study.math": 120, "study.english": 80 });
  assert.deepEqual(context.targets.progress, [{ categoryId: "study.math", label: "数学", targetMinutes: 120, scheduledMinutes: 60, differenceMinutes: -60 }]);
});

test("targets is null when no effectiveStudyTarget was supplied, not a fabricated zeroed object", () => {
  const context = buildPlannerContext({ date: "2026-08-06", now, draft: draft(), plan: plan() });
  assert.equal(context.targets, null);
});

test("actual reuses dailyFacts' Planned/Actual/Unknown verdict verbatim and never fabricates a number when unavailable", () => {
  const withFacts = buildPlannerContext({
    date: "2026-08-06", now, draft: draft(), plan: plan(),
    dailyFacts: { actualStatus: "provisional", plan: { scheduledStudyMinutes: 100 }, actual: { pureStudyMinutes: 50 } },
  });
  assert.deepEqual(withFacts.actual, { status: "provisional", scheduledStudyMinutes: 100, pureStudyMinutes: 50 });

  const withoutFacts = buildPlannerContext({ date: "2026-08-06", now, draft: draft(), plan: plan() });
  assert.deepEqual(withoutFacts.actual, { status: "unknown", scheduledStudyMinutes: null, pureStudyMinutes: null });
});

test("trackers are trimmed to facts only — no evidence array, no CompletionEvent history", () => {
  const context = buildPlannerContext({
    date: "2026-08-06", now, draft: draft(), plan: plan(),
    trackerFacts: [{
      trackerId: "mask", title: "面膜", scheduleStatus: "due_today", todayReviewStatus: "not_saved",
      lastCompletedDate: "2026-08-04", nextDueDate: "2026-08-06",
      progress: { current: 0, target: 1, unit: "occurrence", remaining: 1 },
      evidence: [{ id: "evt-1", trackerId: "mask", occurredOn: "2026-08-04" }],
      sourceSummary: "long human text that must not leak through",
    }],
  });
  assert.equal(context.trackers.length, 1);
  assert.equal(context.trackers[0].id, "mask");
  assert.equal(context.trackers[0].scheduleStatus, "due_today");
  assert.equal("evidence" in context.trackers[0], false);
  assert.equal("sourceSummary" in context.trackers[0], false);
});

test("reviewContext only carries the four short fields, truncated, never a full settlement dump", () => {
  const longBlocker = "x".repeat(500);
  const context = buildPlannerContext({
    date: "2026-08-06", now, draft: draft(), plan: plan(),
    reviewContext: { sourceReviewDate: "2026-08-05", biggestBlocker: longBlocker, tomorrowAdjustment: "早点睡", oneSentenceSummary: "还行" },
  });
  assert.equal(context.reviewContext.sourceReviewDate, "2026-08-05");
  assert.ok(context.reviewContext.biggestBlocker.length <= 200);
  assert.equal(context.reviewContext.tomorrowAdjustment, "早点睡");
  assert.equal(Object.keys(context.reviewContext).length, 4);
});

test("planUpdatedAt/date/generatedAt/schemaVersion are populated from the real inputs", () => {
  const context = buildPlannerContext({ date: "2026-08-06", now, draft: draft(), plan: plan() });
  assert.equal(context.date, "2026-08-06");
  assert.equal(context.planUpdatedAt, "2026-08-06T01:00:00.000Z");
  assert.equal(context.generatedAt, now.toISOString());
  assert.equal(context.schemaVersion, 1);
});

test("hasBaseline reflects baselinePlanSnapshot scoped to THIS date, not any truthy snapshot", () => {
  const withOtherDateBaseline = buildPlannerContext({
    date: "2026-08-06", now, plan: plan(),
    draft: draft({ baselinePlanSnapshot: { targetDate: "2026-08-05" } }),
  });
  assert.equal(withOtherDateBaseline.constraints.hasBaseline, false);

  const withMatchingBaseline = buildPlannerContext({
    date: "2026-08-06", now, plan: plan(),
    draft: draft({ baselinePlanSnapshot: { targetDate: "2026-08-06" } }),
  });
  assert.equal(withMatchingBaseline.constraints.hasBaseline, true);
});

test("computePlannerContextBaseRevision changes when the raw draft content changes even with the same updatedAt", () => {
  const base = draft();
  const revisionA = computePlannerContextBaseRevision({ draft: base });
  const revisionB = computePlannerContextBaseRevision({ draft: draft({ todayCustomBlocks: [{ id: "custom-1", segments: [30], breakMinutes: 0, manualStart: 600, locked: false, priority: 2 }] }) });
  assert.notEqual(revisionA, revisionB);
});

test("computePlannerContextBaseRevision is stable for identical draft content", () => {
  const revisionA = computePlannerContextBaseRevision({ draft: draft() });
  const revisionB = computePlannerContextBaseRevision({ draft: draft() });
  assert.equal(revisionA, revisionB);
});

test("computePlannerContextBaseRevision does NOT depend on plan (the computed autoSchedule) — only the raw draft, since the future apply endpoint can only read the raw draft", () => {
  const revisionA = computePlannerContextBaseRevision({ draft: draft() });
  const revisionB = computePlannerContextBaseRevision({ draft: draft(), plan: plan({ blocks: [{ id: "math-1", title: "数学 50", start: 600, end: 700, kind: "task", status: "pending" }] }) });
  assert.equal(revisionA, revisionB);
});

// ---------------------------------------------------------------------------
// template_under_covers_target warning
// ---------------------------------------------------------------------------

test("template_under_covers_target: emitted when category scheduled minutes < 60% of target with gap >= 30 min", () => {
  const studyTargetProgress = [
    { categoryId: "cat_math", categoryLabel: "数学", targetMinutes: 200, scheduledMinutes: 30, differenceMinutes: -170 },
  ];
  const context = buildPlannerContext({ date: "2026-08-05", now, plan: {}, studyTargetProgress });
  const warnings = context.capacity.warnings.filter((w) => w && w.type === "template_under_covers_target");
  assert.equal(warnings.length, 1, "should emit one template_under_covers_target warning");
  assert.equal(warnings[0].categoryId, "cat_math");
  assert.equal(warnings[0].targetMinutes, 200);
  assert.equal(warnings[0].scheduledMinutes, 30);
  assert.equal(warnings[0].gapMinutes, 170);
});

test("template_under_covers_target: not emitted when scheduled >= 60% of target", () => {
  // 120/200 = 60%, exactly at threshold — strict < means no warning
  const studyTargetProgress = [
    { categoryId: "cat_math", categoryLabel: "数学", targetMinutes: 200, scheduledMinutes: 120, differenceMinutes: -80 },
  ];
  const context = buildPlannerContext({ date: "2026-08-05", now, plan: {}, studyTargetProgress });
  const warnings = context.capacity.warnings.filter((w) => w && w.type === "template_under_covers_target");
  assert.equal(warnings.length, 0, "should not warn when scheduled >= 60% of target");
});

test("template_under_covers_target: not emitted when gap is < 30 min even if ratio is low", () => {
  // 10/30 = 33%, but gap is only 20 min
  const studyTargetProgress = [
    { categoryId: "cat_read", categoryLabel: "阅读", targetMinutes: 30, scheduledMinutes: 10, differenceMinutes: -20 },
  ];
  const context = buildPlannerContext({ date: "2026-08-05", now, plan: {}, studyTargetProgress });
  const warnings = context.capacity.warnings.filter((w) => w && w.type === "template_under_covers_target");
  assert.equal(warnings.length, 0, "should not warn when absolute gap < 30 min");
});

test("template_under_covers_target: not emitted when targetMinutes is 0", () => {
  const studyTargetProgress = [
    { categoryId: "cat_optional", categoryLabel: "选修", targetMinutes: 0, scheduledMinutes: 0, differenceMinutes: 0 },
  ];
  const context = buildPlannerContext({ date: "2026-08-05", now, plan: {}, studyTargetProgress });
  const warnings = context.capacity.warnings.filter((w) => w && w.type === "template_under_covers_target");
  assert.equal(warnings.length, 0, "should not warn when target is 0");
});

test("template_under_covers_target: multiple categories evaluated independently", () => {
  const studyTargetProgress = [
    { categoryId: "cat_math", categoryLabel: "数学", targetMinutes: 200, scheduledMinutes: 30, differenceMinutes: -170 },
    { categoryId: "cat_english", categoryLabel: "英语", targetMinutes: 90, scheduledMinutes: 85, differenceMinutes: -5 },
    { categoryId: "cat_code", categoryLabel: "编程", targetMinutes: 120, scheduledMinutes: 0, differenceMinutes: -120 },
  ];
  const context = buildPlannerContext({ date: "2026-08-05", now, plan: {}, studyTargetProgress });
  const warnings = context.capacity.warnings.filter((w) => w && w.type === "template_under_covers_target");
  // cat_math: 15%, gap 170 → warn; cat_english: ratio high and gap < 30 → no; cat_code: 0%, gap 120 → warn
  assert.equal(warnings.length, 2);
  const warnedIds = warnings.map((w) => w.categoryId).sort();
  assert.deepEqual(warnedIds, ["cat_code", "cat_math"]);
});

test("template_under_covers_target: merges with plan.warnings without losing either set", () => {
  const planWithWarning = { warnings: [{ type: "free_time_low", message: "时间紧张" }] };
  const studyTargetProgress = [
    { categoryId: "cat_math", categoryLabel: "数学", targetMinutes: 200, scheduledMinutes: 10, differenceMinutes: -190 },
  ];
  const context = buildPlannerContext({ date: "2026-08-05", now, plan: planWithWarning, studyTargetProgress });
  const all = context.capacity.warnings;
  assert.ok(all.some((w) => w && w.type === "free_time_low"), "plan.warnings must be preserved");
  assert.ok(all.some((w) => w && w.type === "template_under_covers_target"), "template warning must also appear");
  assert.equal(all.length, 2);
});

// ---------------------------------------------------------------------------
// Chain: CompletionEvent → resolveTrackerEvidence → PlannerContext.trackers
// Tests the data flow that Problem 2's trackerReloadSignal wiring closes.
// ---------------------------------------------------------------------------

import { resolveTrackerEvidence } from "../utils/trackerFacts.js";

const grandmaTracker = {
  id: "family-a", title: "联系外婆",
  schedule: { kind: "interval", every: 7, unit: "day" },
  goal: { aggregation: "occurrence", target: 1, unit: "times" },
  evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }],
};

function todayEvent(overrides = {}) {
  return {
    id: "e1", trackerId: "family-a", occurredOn: "2026-08-05", occurredAt: null,
    recordedAt: "2026-08-05T14:00:00Z", value: null, unit: "boolean",
    sourceType: "maintenance", ingestionType: "live", sourceDocumentId: "s1",
    sourceFieldKey: "health.maintenanceCompleted", sourceRevision: "0",
    evidenceSummary: "外婆联系", state: "active", retractedAt: null,
    retractionReason: null, createdAt: "2026-08-05T14:00:00Z", updatedAt: "2026-08-05T14:00:00Z",
    ...overrides,
  };
}

test("chain: settlement reconcile produces CompletionEvent → resolveTrackerEvidence returns confirmed_complete", () => {
  // Before reconcile: settlement saved, no event → confirmed_no_evidence
  const before = resolveTrackerEvidence(grandmaTracker, {
    events: [], today: "2026-08-05", todaySettlementExists: true,
  });
  assert.equal(before.todayReviewStatus, "confirmed_no_evidence");
  assert.equal(before.scheduleStatus, "overdue");

  // After reconcile fires and ScheduleAssistant re-fetches via trackerReloadSignal
  const after = resolveTrackerEvidence(grandmaTracker, {
    events: [todayEvent()], today: "2026-08-05", todaySettlementExists: true,
  });
  assert.equal(after.todayReviewStatus, "confirmed_complete");
  assert.equal(after.lastCompletedDate, "2026-08-05");
  assert.equal(after.scheduleStatus, "upcoming"); // completed today → next due in 7 days
});

test("chain: fresh trackerFacts reflected in PlannerContext.trackers — stale pre-completion view is replaced", () => {
  const staleFacts = [resolveTrackerEvidence(grandmaTracker, {
    events: [], today: "2026-08-05", todaySettlementExists: true,
  })];
  const staleContext = buildPlannerContext({ date: "2026-08-05", now, plan: {}, trackerFacts: staleFacts });
  assert.equal(staleContext.trackers[0].todayReviewStatus, "confirmed_no_evidence");

  const freshFacts = [resolveTrackerEvidence(grandmaTracker, {
    events: [todayEvent()], today: "2026-08-05", todaySettlementExists: true,
  })];
  const freshContext = buildPlannerContext({ date: "2026-08-05", now, plan: {}, trackerFacts: freshFacts });
  assert.equal(freshContext.trackers[0].todayReviewStatus, "confirmed_complete");
  assert.equal(freshContext.trackers[0].lastCompletedDate, "2026-08-05");
});

test("chain: mask tracker follows same universal data-flow — no family-a-specific patch", () => {
  const maskTracker = {
    id: "mask", title: "敷面膜",
    schedule: { kind: "interval", every: 7, unit: "day" },
    goal: { aggregation: "occurrence", target: 1, unit: "times" },
    evidenceBindings: [{ type: "legacyMaskField" }],
  };
  const maskEvent = { ...todayEvent(), id: "mask-e1", trackerId: "mask", sourceType: "maintenance", sourceFieldKey: "health.maskStatus", evidenceSummary: "面膜：已敷" };
  const before = resolveTrackerEvidence(maskTracker, { events: [], today: "2026-08-05", todaySettlementExists: true });
  assert.equal(before.todayReviewStatus, "confirmed_no_evidence");
  const after = resolveTrackerEvidence(maskTracker, { events: [maskEvent], today: "2026-08-05", todaySettlementExists: true });
  assert.equal(after.todayReviewStatus, "confirmed_complete");
});

// ---------------------------------------------------------------------------
// P1 scenario: 默认模板较轻 + 学习目标较高
// Regression: task pool reflects template tasks, targets reflect goals,
// warning fires, no fabricated tasks are added to the pool.
// ---------------------------------------------------------------------------

test("P1 scenario: light template + high target — taskPool reflects real template segments, no fabricated tasks", () => {
  // Template generates only one 30-min math session in the pool.
  // Target is 200 min of math. The pool must show ONLY what the template produced.
  const lightTemplatePool = [
    { blockId: "math-t1-1", id: "math-t1", segmentTitle: "数学 30", categoryId: "study.math", duration: 30, occupiedDuration: 30, breakAfter: 0, priority: 2, preferredPeriods: [], splittable: true },
  ];
  const context = buildPlannerContext({
    date: "2026-08-05", now,
    plan: { poolSegments: lightTemplatePool, blocks: [] },
    effectiveStudyTarget: { source: "default", totalMinutes: 200, byCategory: { "study.math": 200 } },
    studyTargetProgress: [
      { categoryId: "study.math", categoryLabel: "数学", targetMinutes: 200, scheduledMinutes: 30, differenceMinutes: -170, ratio: 0.15, tracked: true },
    ],
  });

  // taskPool shows only real template segments — exactly 1, not fabricated to fill the target
  assert.equal(context.taskPool.length, 1, "must NOT fabricate extra tasks to cover the target gap");
  assert.equal(context.taskPool[0].blockId, "math-t1-1");
  assert.equal(context.taskPool[0].duration, 30);

  // targets correctly show the actual goal
  assert.ok(context.targets, "targets must be present");
  assert.equal(context.targets.totalMinutes, 200);
  assert.equal(context.targets.byCategory["study.math"], 200);
  assert.equal(context.targets.progress[0].targetMinutes, 200);
  assert.equal(context.targets.progress[0].scheduledMinutes, 30);

  // warning fires because 30 < 200 * 0.6 and gap = 170 >= 30
  const underCoversWarnings = context.capacity.warnings.filter((w) => w && w.type === "template_under_covers_target");
  assert.equal(underCoversWarnings.length, 1, "must have template_under_covers_target warning");
  assert.equal(underCoversWarnings[0].categoryId, "study.math");
  assert.equal(underCoversWarnings[0].gapMinutes, 170);
  assert.equal(underCoversWarnings[0].scheduledMinutes, 30, "gap is from scheduled not from taskPool count");

  // no extra warnings invented
  assert.ok(!context.capacity.warnings.some((w) => w && w.type === "fabricated_tasks"), "must not fabricate tasks");
});

test("P1 scenario: when template covers target, warning is absent even if tasks are in pool", () => {
  // Template generates 130 min of math. Target is 200. 130/200 = 65% >= 60%, so no warning.
  const pool = [
    { blockId: "math-1", id: "math", segmentTitle: "数学 50", categoryId: "study.math", duration: 50, occupiedDuration: 50, breakAfter: 0, priority: 2, preferredPeriods: [], splittable: true },
    { blockId: "math-2", id: "math", segmentTitle: "数学 50 2/2", categoryId: "study.math", duration: 50, occupiedDuration: 50, breakAfter: 0, priority: 2, preferredPeriods: [], splittable: true },
  ];
  const timeline = [
    { id: "math-3", title: "数学 30", start: 600, end: 630, kind: "task", categoryId: "study.math", categoryStatGroup: "study", status: "pending", locked: false, breakMinutes: 0 },
  ];
  const context = buildPlannerContext({
    date: "2026-08-05", now,
    plan: { poolSegments: pool, blocks: timeline },
    effectiveStudyTarget: { source: "default", totalMinutes: 200, byCategory: { "study.math": 200 } },
    studyTargetProgress: [
      { categoryId: "study.math", categoryLabel: "数学", targetMinutes: 200, scheduledMinutes: 130, differenceMinutes: -70, ratio: 0.65, tracked: true },
    ],
  });
  const underCovers = context.capacity.warnings.filter((w) => w && w.type === "template_under_covers_target");
  assert.equal(underCovers.length, 0, "no warning when template covers >= 60% of target");
  assert.equal(context.taskPool.length, 2, "pool still reflects real template tasks");
  assert.equal(context.timeline.length, 1, "timeline block preserved");
});

test("P1 scenario: trackers in PlannerContext match the same facts shown in the Tracker UI", () => {
  const trackerFacts = [
    { trackerId: "family-a", title: "联系外婆", scheduleStatus: "overdue", todayReviewStatus: "confirmed_no_evidence", lastCompletedDate: "2026-07-27", nextDueDate: null, progress: null },
    { trackerId: "mask", title: "敷面膜", scheduleStatus: "due_today", todayReviewStatus: "not_saved", lastCompletedDate: "2026-07-29", nextDueDate: "2026-08-05", progress: null },
    { trackerId: "exercise-complete", title: "完整运动", scheduleStatus: "on_track", todayReviewStatus: "confirmed_no_evidence", lastCompletedDate: "2026-08-04", nextDueDate: null, progress: { current: 3, target: 4, unit: "days", remaining: 1 } },
    { trackerId: "light-movement", title: "轻量活动", scheduleStatus: "upcoming", todayReviewStatus: "not_applicable", lastCompletedDate: "2026-08-03", nextDueDate: "2026-08-08", progress: null },
    { trackerId: "reading", title: "阅读", scheduleStatus: "on_track", todayReviewStatus: "confirmed_no_evidence", lastCompletedDate: "2026-08-01", nextDueDate: null, progress: { current: 300, target: 720, unit: "minutes", remaining: 420 } },
    { trackerId: "writing", title: "写作/创作", scheduleStatus: "upcoming", todayReviewStatus: "not_applicable", lastCompletedDate: "2026-08-02", nextDueDate: "2026-08-09", progress: null },
    { trackerId: "family-b", title: "联系其他家人", scheduleStatus: "due_today", todayReviewStatus: "not_saved", lastCompletedDate: "2026-07-28", nextDueDate: "2026-08-05", progress: null },
  ];
  const context = buildPlannerContext({ date: "2026-08-05", now, plan: {}, trackerFacts });

  // All 7 trackers appear in PlannerContext
  assert.equal(context.trackers.length, 7);
  const ids = context.trackers.map((t) => t.id).sort();
  assert.deepEqual(ids, ["exercise-complete", "family-a", "family-b", "light-movement", "mask", "reading", "writing"]);

  // Facts are preserved correctly per tracker
  const grandma = context.trackers.find((t) => t.id === "family-a");
  assert.equal(grandma.scheduleStatus, "overdue");
  assert.equal(grandma.todayReviewStatus, "confirmed_no_evidence");

  const reading = context.trackers.find((t) => t.id === "reading");
  assert.equal(reading.scheduleStatus, "on_track");
  assert.equal(reading.progress.current, 300);
  assert.equal(reading.progress.remaining, 420);

  // No extra fields leak through (evidence arrays, etc.)
  assert.ok(!("evidence" in (context.trackers[0] || {})));
});

test("a whole-day PlannerContext JSON payload stays well under the multi-KB token budget", () => {
  const context = buildPlannerContext({
    date: "2026-08-06", now, draft: draft(), plan: plan(),
    effectiveStudyTarget: { source: "draft", totalMinutes: 200, byCategory: { "study.math": 200 } },
    studyTargetProgress: [{ categoryId: "study.math", categoryLabel: "数学", scheduledMinutes: 60, targetMinutes: 200, differenceMinutes: -140, ratio: 0.3, tracked: true }],
    dailyFacts: { actualStatus: "provisional", plan: { scheduledStudyMinutes: 100 }, actual: { pureStudyMinutes: 50 } },
    trackerFacts: [{ trackerId: "mask", title: "面膜", scheduleStatus: "due_today", todayReviewStatus: "not_saved", lastCompletedDate: null, nextDueDate: "2026-08-06", progress: null }],
    reviewContext: { sourceReviewDate: "2026-08-05", biggestBlocker: "起晚了", tomorrowAdjustment: "早点睡", oneSentenceSummary: "还行" },
  });
  assert.ok(JSON.stringify(context).length < 4000, `expected a lean payload, got ${JSON.stringify(context).length} bytes`);
});
