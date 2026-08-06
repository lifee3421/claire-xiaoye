// Tests for computeTimelinePositionsPatch/mergeTimelineMutationIntoDraft —
// the pure extraction of App.jsx's commitTimelinePositions body. These lock
// in the exact merge semantics both ScheduleAssistant (passing
// autoSchedule.blocks) and the server-side planner-bridge apply endpoint
// (passing a small synthesized block list) now share.
import test from "node:test";
import assert from "node:assert/strict";
import { computeTimelinePositionsPatch, mergeTimelineMutationIntoDraft } from "./timelineRescheduleGate.js";

const futureBlock = { id: "math-1", kind: "task", start: 660, end: 710, title: "数学", categoryId: "study.math", breakMinutes: 0, priority: 2, locked: false, status: "pending" };
const startedBlock = { id: "math-2", kind: "task", start: 540, end: 590, title: "数学", category: "数学", categoryId: "study.math", breakMinutes: 10, priority: 1, preferredPeriods: ["morning"] };

test("move a future (not-yet-started) block: in-place override patch, no split, no new block/revision", () => {
  const patch = computeTimelinePositionsPatch({ blocks: [futureBlock], positions: [{ id: "math-1", start: 700, end: 750 }], nowMinutes: 600 });
  assert.deepEqual(patch.newCustomBlocks, []);
  assert.deepEqual(patch.revisions, []);
  assert.deepEqual(patch.overridePatches["math-1"], { placement: "timeline", manualStart: 700, locked: false, status: "pending" });
});

test("move an already-started block: split into origin(rescheduled) override + newCustomBlocks + revisions", () => {
  const patch = computeTimelinePositionsPatch({ blocks: [startedBlock], positions: [{ id: "math-2", start: 660, end: 710 }], nowMinutes: 560, nowIso: "2026-08-06T01:00:00.000Z" });
  assert.deepEqual(patch.overridePatches["math-2"], { status: "rescheduled" });
  assert.equal(patch.newCustomBlocks.length, 1);
  assert.equal(patch.newCustomBlocks[0].manualStart, 660);
  assert.equal(patch.newCustomBlocks[0].originBlockId, "math-2");
  assert.equal(patch.revisions.length, 1);
});

test("returnedToPool on a future block: pool override patch, no cancellation", () => {
  const patch = computeTimelinePositionsPatch({ blocks: [futureBlock], positions: [], returnedToPool: ["math-1"], nowMinutes: 600 });
  assert.deepEqual(patch.overridePatches["math-1"], { placement: "pool", manualStart: null, locked: false, status: "pending" });
});

test("returnedToPool on an already-started block: soft-cancelled in place, never pooled/deleted", () => {
  const patch = computeTimelinePositionsPatch({ blocks: [startedBlock], positions: [], returnedToPool: ["math-2"], nowMinutes: 560 });
  assert.deepEqual(patch.overridePatches["math-2"], { status: "cancelled" });
});

test("extraForId merges onto the in-place move override patch", () => {
  const patch = computeTimelinePositionsPatch({ blocks: [futureBlock], positions: [{ id: "math-1", start: 700, end: 750 }], nowMinutes: 600, extraForId: { "math-1": { priority: 1 } } });
  assert.equal(patch.overridePatches["math-1"].priority, 1);
});

test("mergeTimelineMutationIntoDraft merges override patches on top of existing overrides for the SAME blockId, without touching unrelated overrides", () => {
  const draft = { todaySegmentOverrides: { "math-1": { priority: 3 }, "other-1": { locked: true } } };
  const next = mergeTimelineMutationIntoDraft(draft, { overridePatches: { "math-1": { manualStart: 700 } } });
  assert.deepEqual(next.todaySegmentOverrides["math-1"], { priority: 3, manualStart: 700 });
  assert.deepEqual(next.todaySegmentOverrides["other-1"], { locked: true });
});

test("mergeTimelineMutationIntoDraft appends newCustomBlocks/revisions and never mutates the input draft", () => {
  const draft = { todayCustomBlocks: [{ id: "existing" }], planRevisions: [{ revisionId: "r1" }] };
  const next = mergeTimelineMutationIntoDraft(draft, { newCustomBlocks: [{ id: "new-1" }], revisions: [{ revisionId: "r2" }] });
  assert.deepEqual(next.todayCustomBlocks, [{ id: "existing" }, { id: "new-1" }]);
  assert.deepEqual(next.planRevisions, [{ revisionId: "r1" }, { revisionId: "r2" }]);
  assert.deepEqual(draft.todayCustomBlocks, [{ id: "existing" }]); // original untouched
});

test("mergeTimelineMutationIntoDraft omits todayCustomBlocks/planRevisions keys entirely when there is nothing new (matches the original inline spread's ...(x.length ? {...} : {}) behavior)", () => {
  const draft = { todayCustomBlocks: [{ id: "existing" }] };
  const next = mergeTimelineMutationIntoDraft(draft, { overridePatches: { "math-1": { manualStart: 700 } } });
  assert.deepEqual(next.todayCustomBlocks, [{ id: "existing" }]);
  assert.equal("planRevisions" in next, false);
});
