import assert from "node:assert/strict";
import test from "node:test";
import { resolveTaskSegmentPlacement } from "./plannerTimelineBlocks.js";

test("override.placement:pool wins", () => {
  assert.equal(resolveTaskSegmentPlacement({ placement: "pool" }, { manualStart: null }), "pool");
});

test("task.placement:pool is honored when no override placement exists (returned-to-pool custom block)", () => {
  assert.equal(resolveTaskSegmentPlacement({}, { placement: "pool" }), "pool");
});

test("task.placement:timeline is honored when no override placement exists", () => {
  assert.equal(resolveTaskSegmentPlacement({}, { placement: "timeline", manualStart: null }), "timeline");
});

test("explicit override manualStart:null is NOT a timeline slot (null != 0)", () => {
  // "field exists but is null" must not fall back to task.manualStart nor become 00:00.
  assert.equal(resolveTaskSegmentPlacement({ manualStart: null }, { manualStart: 800 }), "pool");
});

test("genuine 0 manualStart IS a timeline slot (real 00:00)", () => {
  assert.equal(resolveTaskSegmentPlacement({ manualStart: 0 }, {}), "timeline");
});

test("no explicit minute (override absent, task null) => pool", () => {
  assert.equal(resolveTaskSegmentPlacement({}, { manualStart: null }), "pool");
});

test("real manualStart (e.g. 800) => timeline", () => {
  assert.equal(resolveTaskSegmentPlacement({ manualStart: 800 }, {}), "timeline");
});

test("deleted placement is preserved first", () => {
  assert.equal(resolveTaskSegmentPlacement({ placement: "deleted" }, {}), "deleted");
});
