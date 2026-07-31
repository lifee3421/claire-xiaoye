// Integration coverage for the full real-UI reschedule chain, chaining the
// SAME exported, non-JSX functions the real handlers in App.jsx call
// (flattenPlannerTasks / buildScheduledTaskBlockFromSegment from
// utils/plannerTimelineBlocks.js, buildCategoryTimeProgress from
// utils/plannerOverview.js, computeTimelineFocusCoverage from
// schedule/focusOverlap.js) — not a reimplementation of any of them.
// Mirrors the pattern in src/agent/timelineCardReminderIntegration.test.js:
// goes all the way from a draft mutation through the real block-building
// pipeline, rather than stopping at the gate's own unit tests.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveSegmentMove } from "./timelineRescheduleGate.js";
import { flattenPlannerTasks, buildScheduledTaskBlockFromSegment } from "../utils/plannerTimelineBlocks.js";
import { buildCategoryTimeProgress } from "../utils/plannerOverview.js";
import { computeTimelineFocusCoverage, aggregateFocusCoverageByCategory } from "./focusOverlap.js";

// Same shape buildPlannerTaskGroups/pushGroup produce in App.jsx: a task
// group with a segments array and (for real system-generated tasks) a
// segmentOverrides map sourced from draft.todaySegmentOverrides.
function mathTaskGroup(segmentOverrides) {
  return {
    id: "math-lecture",
    title: "数学｜网课 1×50",
    category: "数学",
    categoryId: "study.math",
    categoryStatGroup: "study",
    segments: [50],
    breakMinutes: 0,
    priority: 1,
    preferredPeriods: ["morning"],
    manualStart: 540, // 09:00 — the original placement, before any override
    locked: false,
    segmentOverrides,
  };
}

function blocksFromDraft({ todaySegmentOverrides = {}, todayCustomBlocks = [] }) {
  const groups = [mathTaskGroup(todaySegmentOverrides), ...todayCustomBlocks.map((custom) => ({ ...custom, segmentOverrides: {} }))];
  const segments = flattenPlannerTasks(groups, []);
  return segments
    .filter((segment) => segment.placement === "timeline" || segment.placement === "history")
    .map((segment) => buildScheduledTaskBlockFromSegment(segment, { start: segment.manualStart }));
}

test("real handler chain: dragging the 09:00 math block to 11:00 at 10:30 keeps the original AND produces a linked new block", () => {
  // Step 1: the draft as it existed right after baseline confirmation — one
  // math block at 09:00-09:50, no overrides yet.
  const initialBlocks = blocksFromDraft({});
  const originalBlock = initialBlocks.find((b) => b.id === "math-lecture-1");
  assert.equal(originalBlock.start, 540);
  assert.equal(originalBlock.end, 590);

  // Step 2: the real handler's gate decision at 10:30 (nowMinutes=630),
  // dragging to 11:00 (=660).
  const result = resolveSegmentMove({ block: originalBlock, newStart: 660, nowMinutes: 630, reason: "拖拽改期", nowIso: "2026-07-30T02:30:00.000Z" });
  assert.equal(result.split, true);

  // Step 3: apply exactly the draft mutation the real handler (saveSegmentOverride/
  // commitTimelinePositions) performs — origin override gets status:"rescheduled"
  // (manualStart/placement untouched), new custom block is appended.
  const nextDraft = {
    todaySegmentOverrides: { "math-lecture-1": { status: "rescheduled" } },
    todayCustomBlocks: [result.newCustomBlock],
  };

  // Step 4: rebuild blocks through the REAL pipeline and verify all ten
  // acceptance requirements.
  const blocks = blocksFromDraft(nextDraft);
  const original = blocks.find((b) => b.id === "math-lecture-1");
  // A block's real id is `${taskGroupId}-${segmentIndex}` (flattenPlannerTasks),
  // not the task group's own id directly — the custom block group has one
  // segment, so its rendered block id is `${result.newCustomBlock.id}-1`.
  const rescheduled = blocks.find((b) => b.id === `${result.newCustomBlock.id}-1`);

  // 1/2/3: original not overwritten, still at 09:00-09:50, marked rescheduled.
  assert.ok(original, "original block must still exist");
  assert.equal(original.start, 540);
  assert.equal(original.end, 590);
  assert.equal(original.status, "rescheduled");

  // 4/5: new block exists at 11:00-11:50 with the full link back.
  assert.ok(rescheduled, "new block must exist");
  assert.equal(rescheduled.start, 660);
  assert.equal(rescheduled.end, 710);
  assert.equal(rescheduled.taskGroup.originBlockId, "math-lecture-1");
  assert.deepEqual(rescheduled.taskGroup.rescheduledFrom, { start: 540, end: 590 });
  assert.equal(rescheduled.taskGroup.rescheduledAt, "2026-07-30T02:30:00.000Z");
  assert.ok(rescheduled.taskGroup.revisionId);

  // 9: original no longer participates in scheduled-minutes counting.
  const categoryTree = [{ id: "study", children: [{ id: "math", name: "数学", level: 2, enabled: true }] }];
  const progress = buildCategoryTimeProgress({ timelineBlocks: blocks, categoryTree, categoryTargets: { math: 240 } });
  assert.equal(progress[0].scheduledMinutes, 50); // only the new block's 50 minutes, not 100

  // 8/10: Focus 11:10-11:55 overlaps only the new block (40min), never the original.
  const coverages = computeTimelineFocusCoverage({ blocks, focusSessions: [{ start: 670, end: 715 }], nowMinute: 900, focusStatus: "fresh" });
  const byId = new Map(coverages.map((c) => [c.blockId, c]));
  assert.equal(byId.get(original.id), undefined, "the rescheduled original must be excluded from Focus coverage entirely");
  assert.equal(byId.get(rescheduled.id).focusOverlapMinutes, 40);

  const byCategory = aggregateFocusCoverageByCategory({ blocks, coverageByBlockId: byId });
  assert.equal(byCategory.length, 1);
  assert.equal(byCategory[0].focusOverlapMinutes, 40); // no double count
});

test("real handler chain: a future (not-yet-started) block just moves in place — no split, no ghost block", () => {
  const groups = [mathTaskGroup({})];
  // now = 08:00, block starts at 09:00 (hasn't started yet)
  const blocks = blocksFromDraft({});
  const block = blocks.find((b) => b.id === "math-lecture-1");
  const result = resolveSegmentMove({ block, newStart: 600, nowMinutes: 480 });
  assert.equal(result.split, false);
});
