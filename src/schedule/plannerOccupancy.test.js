// Regression tests for the ghost-block fix in buildAutoSchedulePlan's
// occupancy accumulation (spec: historical rescheduled/cancelled blocks must
// NOT occupy the timeline during auto-placement, but must still be retained
// in allBlocks for the baseline strip).
//
// We test the real guard logic in createOccupancyBuilder directly because
// App.jsx (which contains buildAutoSchedulePlan) cannot be imported under
// Node's test runner (it has JSX). buildAutoSchedulePlan now delegates its
// occupancy accumulation to this exact builder, so a green builder test is a
// green buildAutoSchedulePlan occupancy test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createOccupancyBuilder } from "./plannerOccupancy.js";

// Minimal interval helpers mirroring App.jsx's blockToInterval / mergeIntervals
// / subtractIntervals semantics, so the builder test has no dependency on the
// (JSX-containing) App.jsx. The GUARD logic under test lives in
// createOccupancyBuilder and is the real fix.
const blockToInterval = (b) => ({ start: b.start, end: b.end });
const mergeIntervals = (intervals = []) =>
  intervals
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .sort((a, b) => a.start - b.start)
    .reduce((acc, cur) => {
      const last = acc[acc.length - 1];
      if (!last || cur.start > last.end) acc.push({ ...cur });
      else last.end = Math.max(last.end, cur.end);
      return acc;
    }, []);
const subtractIntervals = (base, occupied = []) => {
  const merged = mergeIntervals(occupied);
  let cursor = base.start;
  const free = [];
  merged.forEach((iv) => {
    if (iv.end <= base.start || iv.start >= base.end) return;
    const start = Math.max(base.start, iv.start);
    const end = Math.min(base.end, iv.end);
    if (start > cursor) free.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  });
  if (cursor < base.end) free.push({ start: cursor, end: base.end });
  return free;
};
// Mirrors choosePlannerPlacement's no-manualStart fallback: first free gap that
// fits the segment's occupiedDuration.
const chooseFirstFit = (duration, freeIntervals) =>
  freeIntervals.find((gap) => gap.end - gap.start >= duration) || null;

// Historical block occupying 09:00-09:50 (540-590 minutes).
const historicalBlock = (status) => ({ id: "hist-1", start: 540, end: 590, status, kind: "task" });

for (const status of ["cancelled", "rescheduled"]) {
  test(`historical ${status} block does NOT occupy; 09:00-09:50 stays free and a live 50min task is placed there`, () => {
    const builder = createOccupancyBuilder({ blockToInterval, mergeIntervals });
    builder.add(historicalBlock(status));
    // A live task that still needs auto-placement.
    builder.add({ id: "live-1", start: 600, end: 650, status: "pending", kind: "task" });

    // (1) historical block must NOT be in occupied.
    const coversHistorical = builder.occupied.some((iv) => iv.start <= 540 && iv.end >= 590);
    assert.equal(coversHistorical, false, "occupied must exclude the historical block interval");

    // (2) 09:00-09:50 must be a real free gap within the schedule window.
    const free = subtractIntervals({ start: 540, end: 650 }, builder.occupied);
    const gap = free.find((iv) => iv.start <= 540 && iv.end >= 590);
    assert.ok(gap, "09:00-09:50 should be a free interval");

    // (3) a live 50min task can be auto-placed into that gap (first-fit).
    const placement = chooseFirstFit(50, free);
    assert.ok(placement, "a 50min live task must fit in the freed gap");
    assert.equal(placement.start, 540, "live task is placed at 09:00, not pushed past the ghost");

    // (4) plan.blocks (live) excludes the historical block.
    const liveIds = builder.liveBlocks.map((b) => b.id);
    assert.deepEqual(liveIds, ["live-1"], "liveBlocks must not contain the historical block");

    // (5) plan.allBlocks still retains the historical block for the baseline strip.
    const allIds = builder.allBlocks.map((b) => b.id);
    assert.deepEqual(allIds, ["hist-1", "live-1"], "allBlocks must retain the historical block");
  });
}

test("live and historical interleave: only live blocks contribute to occupied", () => {
  const builder = createOccupancyBuilder({ blockToInterval, mergeIntervals });
  builder.add({ id: "a", start: 540, end: 590, status: "pending", kind: "task" }); // live
  builder.add({ id: "b", start: 590, end: 640, status: "cancelled", kind: "task" }); // historical
  builder.add({ id: "c", start: 640, end: 690, status: "rescheduled", kind: "task" }); // historical
  builder.add({ id: "d", start: 690, end: 740, status: "pending", kind: "task" }); // live
  assert.deepEqual(
    builder.occupied.map((iv) => `${iv.start}-${iv.end}`),
    ["540-590", "690-740"],
    "occupied contains only live intervals",
  );
  assert.deepEqual(builder.liveBlocks.map((b) => b.id), ["a", "d"]);
  assert.deepEqual(builder.allBlocks.map((b) => b.id), ["a", "b", "c", "d"]);
});
