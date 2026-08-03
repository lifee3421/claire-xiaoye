// Closes the loop on the ghost-block fix: the occupancy guard in
// createOccupancyBuilder keys off block.status, which is produced by
// buildScheduledTaskBlockFromSegment from the segment's status. If that
// passthrough silently dropped a "cancelled"/"rescheduled" status, the guard
// would treat the block as live and the ghost would return. So we assert the
// real segment -> block conversion preserves the superseded status, and that
// a NORMAL task gets a live status (so it still occupies).
//
// buildScheduledTaskBlockFromSegment / flattenPlannerTasks are already JSX-free
// (src/utils/plannerTimelineBlocks.js) and importable under Node's runner.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScheduledTaskBlockFromSegment, flattenPlannerTasks } from "./plannerTimelineBlocks.js";

function segmentWith(status) {
  return {
    blockId: "g-1-1",
    segmentTitle: "x 50",
    category: "study",
    categoryId: "c",
    categoryStatGroup: "g",
    duration: 50,
    occupiedDuration: 50,
    breakAfter: 0,
    priority: 2,
    preferredPeriods: [],
    id: "g-1",
    taskGroup: { id: "g-1" },
    status,
    locked: false,
  };
}

// (a) An EXPLICIT superseded status on the segment is preserved onto the block,
// so the occupancy guard actually sees it (the core of the ghost fix).
for (const status of ["cancelled", "rescheduled"]) {
  test(`buildScheduledTaskBlockFromSegment preserves superseded status "${status}" so the occupancy guard sees it`, () => {
    const block = buildScheduledTaskBlockFromSegment(segmentWith(status), { start: 540 });
    assert.equal(block.status, status);
    assert.equal(block.start, 540);
    assert.equal(block.end, 590);
  });
}

// (b) A NORMAL task with no status override is assigned the live status
// "pending" by flattenPlannerTasks, and that live status survives into the
// block — so ordinary blocks still occupy the timeline (the fix only excludes
// superseded blocks, never live ones). The default lives in flattenPlannerTasks,
// not in the block builder (which only copies what it is given).
test("a normal task group segment defaults to live 'pending' via flattenPlannerTasks, so it still occupies", () => {
  const groups = [
    {
      id: "n-1",
      title: "normal",
      categoryId: "study",
      category: "数学",
      categoryStatGroup: "study",
      segments: [50],
      breakMinutes: 0,
      priority: 2,
      preferredPeriods: ["morning"],
      manualStart: 540,
      locked: true,
      segmentOverrides: {},
    },
  ];
  const [segment] = flattenPlannerTasks(groups, []);
  assert.equal(segment.status, "pending");
  const block = buildScheduledTaskBlockFromSegment(segment, { start: 540 });
  assert.equal(block.status, "pending");
});
