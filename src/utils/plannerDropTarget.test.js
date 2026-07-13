import assert from "node:assert/strict";
import test from "node:test";
import { calculatePoolDropTarget } from "./plannerDropTarget.js";

const timeline = {
  timelineTop: 100,
  timelineScrollTop: 0,
  timelineStartMinutes: 8 * 60,
  timelineEndMinutes: 23 * 60,
  pxPerMinute: 1.5,
  durationMinutes: 60,
};

test("uses only the live pointer position and snaps to five minutes", () => {
  assert.deepEqual(calculatePoolDropTarget({ ...timeline, pointerClientY: 205 }), { start: 550, end: 610 });
});

test("includes timeline scroll offset", () => {
  assert.deepEqual(calculatePoolDropTarget({ ...timeline, pointerClientY: 205, timelineScrollTop: 30 }), { start: 570, end: 630 });
});

test("keeps a pool task inside the timeline boundaries", () => {
  assert.deepEqual(calculatePoolDropTarget({ ...timeline, pointerClientY: -200 }), { start: 480, end: 540 });
  assert.deepEqual(calculatePoolDropTarget({ ...timeline, pointerClientY: 3000 }), { start: 1320, end: 1380 });
});

test("rejects invalid coordinates and impossible task durations", () => {
  assert.equal(calculatePoolDropTarget({ ...timeline, pointerClientY: Number.NaN }), null);
  assert.equal(calculatePoolDropTarget({ ...timeline, pointerClientY: 200, durationMinutes: 1000 }), null);
});
