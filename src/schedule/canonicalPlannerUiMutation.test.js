import assert from "node:assert/strict";
import test from "node:test";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";
import { buildCanonicalUiIntent, mergeTimelineMutationIntoDraft } from "./timelineRescheduleGate.js";

function draft() {
  return {
    targetDate: "2026-08-16",
    savedOn: "2026-08-16",
    updatedAt: "2026-08-16T01:00:00.000Z",
    todayCustomBlocks: [
      { id: "math", title: "数学", segments: [50], breakMinutes: 10, manualStart: 840, locked: false },
    ],
    todaySegmentOverrides: {},
  };
}

test("browser drag intent is expressed as canonical PlannerPatch changes", () => {
  const blocksById = new Map([["math-1", { id: "math-1" }]]);
  assert.deepEqual(buildCanonicalUiIntent({
    blocksById,
    positions: [{ id: "math-1", start: 900, end: 960 }],
    returnedToPool: [],
    operationId: "xiaoye:drag:test",
  }), {
    operationId: "xiaoye:drag:test",
    changes: [{ type: "move", blockId: "math-1", start: "15:00" }],
  });
});

test("local optimistic drag keeps the pre-mutation revision in its canonical handoff", () => {
  const before = draft();
  const baseRevision = computePlannerContextBaseRevision({ draft: before });
  const next = mergeTimelineMutationIntoDraft(before, {
    overridePatches: { "math-1": { placement: "timeline", manualStart: 900, locked: false, status: "pending" } },
    canonicalUiIntent: {
      operationId: "xiaoye:drag:test",
      changes: [{ type: "move", blockId: "math-1", start: "15:00" }],
    },
  });
  assert.equal(next.todaySegmentOverrides["math-1"].manualStart, 900);
  assert.equal(next.__canonicalPlannerMutations.length, 1);
  assert.equal(next.__canonicalPlannerMutations[0].baseRevision, baseRevision);
  assert.equal(next.__canonicalPlannerMutations[0].date, "2026-08-16");
  assert.notEqual(next.__canonicalPlannerMutations[0].afterRevision, baseRevision);
});
