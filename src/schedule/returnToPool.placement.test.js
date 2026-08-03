import assert from "node:assert/strict";
import test from "node:test";
import { resolveSegmentReturnToPool } from "../schedule/timelineRescheduleGate.js";
import { flattenPlannerTasks } from "../utils/plannerTimelineBlocks.js";

// Guards against the integration-risk class the missing import caused:
// resolveSegmentReturnToPool must be a real, callable export of the module
// App.jsx imports it from. (The actual App.jsx wiring is verified by `npm run
// build` resolving the named import.)
test("resolveSegmentReturnToPool is exported and callable", () => {
  assert.equal(typeof resolveSegmentReturnToPool, "function");
});

test("future block return-to-pool: override placement:pool -> pool segment", () => {
  // moveSegmentToPool for a not-started block writes
  // todaySegmentOverrides[blockId] = { placement: "pool", manualStart: null, locked: false }
  const task = {
    id: "eng",
    title: "英语",
    segments: [50],
    segmentOverrides: { "eng-1": { placement: "pool", manualStart: null, locked: false } },
  };
  const segments = flattenPlannerTasks([task], []);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].placement, "pool");
});

test("started block return-to-pool: newPoolBlock.placement:pool -> pool segment (no ghost timeline)", () => {
  const block = { id: "math-1", title: "数学", start: 540, end: 590, status: "pending" };
  const nowMinutes = 600; // block has already started
  const result = resolveSegmentReturnToPool({
    block,
    nowMinutes,
    idFactory: () => "pool-x",
    nowIso: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(result.split, true);
  assert.equal(result.newPoolBlock.placement, "pool");
  // The new pool block is appended to draft.todayCustomBlocks and flows through
  // flattenPlannerTasks exactly like any other custom block.
  const taskGroup = { ...result.newPoolBlock, segmentOverrides: {} };
  const segments = flattenPlannerTasks([taskGroup], []);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].placement, "pool");
});

test("startup system-life-card return-to-pool: taskGroup path -> pool segment", () => {
  // Mimics buildPlannerFixedBlocks' startup taskGroup whose segmentOverrides
  // carries the pool override written by moveSegmentToPool.
  const startupTaskGroup = {
    id: "startup",
    title: "午休与启动缓冲",
    segments: [40],
    segmentOverrides: { "startup-1": { placement: "pool", manualStart: null, locked: false } },
  };
  const segments = flattenPlannerTasks([startupTaskGroup], []);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].placement, "pool");
  // Not silently reinterpreted as a 00:00 timeline slot.
  assert.notEqual(segments[0].placement, "timeline");
});
