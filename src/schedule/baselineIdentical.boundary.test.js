// Boundary tests for isCurrentPlanIdenticalToBaseline (spec section 6): the
// moment a baseline is saved/overwritten with no other plan change, the
// comparison must report identical === true so the left narrow bar does NOT
// pop up spuriously.
//
// Two guarantees are exercised:
//   (1) The comparison domain is unified to LIVE task-kind blocks on BOTH sides
//       (isCurrentPlanIdenticalToBaseline now filters kind === "task"), so a
//       non-task current block (e.g. a fixed itinerary) cannot break identity.
//   (2) The model guarantee that plan.blocks is all task-kind: every block
//       buildAutoSchedulePlan produces comes from buildScheduledTaskBlockFromSegment,
//       which always sets kind "task". Proven here rather than assumed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isCurrentPlanIdenticalToBaseline, createBaselinePlanSnapshot } from "./baselinePlanModel.js";
import { buildScheduledTaskBlockFromSegment } from "../utils/plannerTimelineBlocks.js";

const task = (id, start, end, status = "pending", kind = "task") => ({ id, start, end, status, kind });

test("just saved/overwritten baseline with no plan change => identical (no spurious left bar)", () => {
  const baselineBlocks = [task("a", 540, 590), task("b", 600, 650)];
  const currentBlocks = [task("a", 540, 590), task("b", 600, 650)];
  assert.equal(isCurrentPlanIdenticalToBaseline({ baselineBlocks, currentBlocks }), true);
});

test("a non-task current block (fixed itinerary) does NOT break baseline identity — domains are unified", () => {
  const baselineBlocks = [task("a", 540, 590)];
  const currentBlocks = [task("a", 540, 590), { id: "fixed-1", start: 600, end: 650, kind: "fixed", status: "completed" }];
  assert.equal(isCurrentPlanIdenticalToBaseline({ baselineBlocks, currentBlocks }), true);
});

test("a superseded (cancelled) current block does NOT break baseline identity", () => {
  const baselineBlocks = [task("a", 540, 590)];
  const currentBlocks = [task("a", 540, 590), task("b", 600, 650, "cancelled")];
  assert.equal(isCurrentPlanIdenticalToBaseline({ baselineBlocks, currentBlocks }), true);
});

test("a genuine plan change (extra task present) => not identical", () => {
  const baselineBlocks = [task("a", 540, 590)];
  const currentBlocks = [task("a", 540, 590), task("c", 600, 650)];
  assert.equal(isCurrentPlanIdenticalToBaseline({ baselineBlocks, currentBlocks }), false);
});

test("saving the current live plan (including a fixed block) yields identical === true via the snapshot path", () => {
  const live = [task("a", 540, 590), { id: "fixed-1", start: 600, end: 650, kind: "fixed", status: "completed" }];
  const snapshot = createBaselinePlanSnapshot({
    targetDate: "2026-08-03",
    confirmedAt: new Date().toISOString(),
    blocks: live.filter((b) => b.kind === "task"),
  });
  const baselineBlocks = snapshot.blocks.filter((b) => b.kind === "task");
  assert.equal(isCurrentPlanIdenticalToBaseline({ baselineBlocks, currentBlocks: live }), true);
});

test("MODEL GUARANTEE: buildScheduledTaskBlockFromSegment always yields kind 'task' (plan.blocks is all task)", () => {
  for (const status of [undefined, "pending", "cancelled", "rescheduled"]) {
    const block = buildScheduledTaskBlockFromSegment(
      {
        blockId: "g-1-1", segmentTitle: "x", category: "study", categoryId: "c", categoryStatGroup: "g",
        duration: 50, occupiedDuration: 50, breakAfter: 0, priority: 2, preferredPeriods: [],
        id: "g-1", taskGroup: { id: "g-1" }, status, locked: false,
      },
      { start: 540 },
    );
    assert.equal(block.kind, "task");
  }
});
