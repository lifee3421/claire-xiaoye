import test from "node:test";
import assert from "node:assert/strict";
import { resolveSegmentMove, resolveSegmentRemoval, isSupersededBlockStatus } from "./timelineRescheduleGate.js";

const mathBlock = {
  id: "math-lecture-1",
  kind: "task",
  start: 540, // 09:00
  end: 590, // 09:50
  title: "数学｜网课 1/3",
  category: "数学",
  categoryId: "study.math",
  categoryStatGroup: "study",
  studyMinutes: 50,
  breakMinutes: 0,
  priority: 1,
  preferredPeriods: ["morning"],
};

test("spec scenario: 09:00-09:50 math dragged to 11:00 at 10:30 splits into origin(rescheduled) + new future block", () => {
  const result = resolveSegmentMove({ block: mathBlock, newStart: 660, nowMinutes: 630, reason: "拖拽改期", nowIso: "2026-07-30T02:30:00.000Z" });
  assert.equal(result.split, true);
  assert.equal(result.originBlockId, "math-lecture-1");
  assert.equal(result.newCustomBlock.manualStart, 660);
  assert.equal(result.newCustomBlock.segments[0], 50);
  assert.equal(result.newCustomBlock.originBlockId, "math-lecture-1");
  assert.deepEqual(result.newCustomBlock.rescheduledFrom, { start: 540, end: 590 });
  assert.equal(result.newCustomBlock.rescheduledAt, "2026-07-30T02:30:00.000Z");
  assert.equal(result.newCustomBlock.categoryId, "study.math");
  assert.ok(result.revision.revisionId);
  assert.equal(result.revision.reason, "拖拽改期");
  assert.deepEqual(result.revision.changedBlockIds, ["math-lecture-1"]);
  assert.notEqual(result.newCustomBlock.id, mathBlock.id);
});

test("a future block (not yet started) moves in place — no split, no new block", () => {
  const futureBlock = { ...mathBlock, start: 660, end: 710 }; // 11:00-11:50
  const result = resolveSegmentMove({ block: futureBlock, newStart: 700, nowMinutes: 540 }); // now = 09:00, well before start
  assert.equal(result.split, false);
});

test("moving to the exact same start is a no-op, never treated as a reschedule", () => {
  const result = resolveSegmentMove({ block: mathBlock, newStart: 540, nowMinutes: 630 });
  assert.equal(result.split, false);
});

test("a block that has started but not yet ended still gets split when its time changes (in-progress, not just past)", () => {
  const result = resolveSegmentMove({ block: mathBlock, newStart: 660, nowMinutes: 560 }); // now = 09:20, mid-block
  assert.equal(result.split, true);
});

test("resolveSegmentRemoval: a future block can be freely deleted/pooled", () => {
  const futureBlock = { ...mathBlock, start: 660, end: 710 };
  assert.deepEqual(resolveSegmentRemoval({ block: futureBlock, nowMinutes: 540 }), { cancel: false });
});

test("resolveSegmentRemoval: an already-started block is never physically removed — cancel in place instead", () => {
  assert.deepEqual(resolveSegmentRemoval({ block: mathBlock, nowMinutes: 630 }), { cancel: true });
});

test("isSupersededBlockStatus recognizes rescheduled and cancelled, nothing else", () => {
  assert.equal(isSupersededBlockStatus("rescheduled"), true);
  assert.equal(isSupersededBlockStatus("cancelled"), true);
  assert.equal(isSupersededBlockStatus("pending"), false);
  assert.equal(isSupersededBlockStatus("completed"), false);
  assert.equal(isSupersededBlockStatus(undefined), false);
});

test("custom idFactory is honored for deterministic ids in tests", () => {
  let counter = 0;
  const result = resolveSegmentMove({ block: mathBlock, newStart: 660, nowMinutes: 630, idFactory: () => `fixed-id-${counter++}` });
  assert.equal(result.newCustomBlock.id, "fixed-id-1"); // revision consumes id 0, block consumes id 1
  assert.equal(result.revision.revisionId, "fixed-id-0");
});

test("newWorkMinutes overrides the original duration when provided (e.g. a resize+move combined)", () => {
  const result = resolveSegmentMove({ block: mathBlock, newStart: 660, newWorkMinutes: 30, nowMinutes: 630 });
  assert.equal(result.newCustomBlock.segments[0], 30);
});
