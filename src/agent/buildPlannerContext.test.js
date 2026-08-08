import test from "node:test";
import assert from "node:assert/strict";
import { buildPlannerContext } from "./buildPlannerContext.js";

const baseDraft = {
  targetDate: "2026-08-06",
  updatedAt: "2026-08-06T01:00:00.000Z",
  todaySegmentOverrides: {},
  todayCustomBlocks: [],
  deletedTodayTaskIds: [],
  fixedEventOverrides: {},
  taskPoolOrder: [],
  planRevisions: [],
};

const trackerDefs = [
  { id: "family-a", title: "联系外婆", enabled: true },
  { id: "exercise-complete", title: "运动", enabled: true },
  { id: "mask", title: "面膜", enabled: true },
  { id: "reading", title: "阅读", enabled: true },
  { id: "writing", title: "写作/创作", enabled: true },
  { id: "family-b", title: "联系其他家人", enabled: true },
];

test("buildPlannerContext: trackers=[] when no defs and facts empty (backward compat)", () => {
  const ctx = buildPlannerContext({ draft: baseDraft, plan: { blocks: [], poolSegments: [], freeIntervals: [] }, trackerFacts: [] });
  assert.deepEqual(ctx.trackers, []);
});

test("buildPlannerContext: all tracker defs present with factsStatus=loading when trackerFactsStatus is loading", () => {
  const ctx = buildPlannerContext({
    draft: baseDraft,
    plan: { blocks: [], poolSegments: [], freeIntervals: [] },
    trackerDefs,
    trackerFacts: [],
    trackerFactsStatus: "loading",
  });
  assert.equal(ctx.trackers.length, 6, "all 6 tracker defs must appear even while facts are loading");
  for (const tracker of ctx.trackers) {
    assert.equal(tracker.factsStatus, "loading");
    assert.equal(tracker.scheduleStatus, null);
    assert.equal(tracker.lastCompletedDate, null);
  }
  const familyA = ctx.trackers.find((t) => t.id === "family-a");
  assert.equal(familyA.title, "联系外婆");
});

test("buildPlannerContext: trackers merged with facts when factsStatus=ready", () => {
  const facts = [
    { trackerId: "family-a", title: "联系外婆", scheduleStatus: "overdue", todayReviewStatus: "not_applicable", lastCompletedDate: "2026-07-30", nextDueDate: "2026-08-06" },
    { trackerId: "mask", title: "面膜", scheduleStatus: "due_today", todayReviewStatus: "not_applicable", lastCompletedDate: "2026-08-03", nextDueDate: "2026-08-06" },
  ];
  const ctx = buildPlannerContext({
    draft: baseDraft,
    plan: { blocks: [], poolSegments: [], freeIntervals: [] },
    trackerDefs,
    trackerFacts: facts,
    trackerFactsStatus: "ready",
  });
  assert.equal(ctx.trackers.length, 6);
  const familyA = ctx.trackers.find((t) => t.id === "family-a");
  assert.equal(familyA.factsStatus, "ready");
  assert.equal(familyA.scheduleStatus, "overdue");
  assert.equal(familyA.lastCompletedDate, "2026-07-30");
  // Tracker not in facts → loading placeholder (but factsStatus=ready means "no facts available")
  const writing = ctx.trackers.find((t) => t.id === "writing");
  assert.equal(writing.factsStatus, "ready");
  assert.equal(writing.scheduleStatus, null);
});

test("buildPlannerContext: trackerFactsStatus=error produces all defs with error status", () => {
  const ctx = buildPlannerContext({
    draft: baseDraft,
    plan: { blocks: [], poolSegments: [], freeIntervals: [] },
    trackerDefs,
    trackerFacts: [],
    trackerFactsStatus: "error",
  });
  assert.equal(ctx.trackers.length, 6);
  for (const tracker of ctx.trackers) {
    assert.equal(tracker.factsStatus, "error");
  }
});
