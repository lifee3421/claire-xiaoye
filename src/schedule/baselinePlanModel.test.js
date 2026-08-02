import test from "node:test";
import assert from "node:assert/strict";
import {
  createBaselinePlanSnapshot,
  firestoreSafeNormalize,
  hasBaseline,
  createPlanRevision,
  isBlockLockedByNow,
  classifyPastBlockStatus,
  rescheduleBlock,
  cancelBlock,
  isCurrentPlanIdenticalToBaseline,
} from "./baselinePlanModel.js";

test("createBaselinePlanSnapshot freezes blocks and target snapshot", () => {
  const blocks = [{ id: "b1", start: 540, end: 590, categoryId: "study.math" }];
  const snapshot = createBaselinePlanSnapshot({
    targetDate: "2026-07-30",
    confirmedAt: "2026-07-30T01:00:00.000Z",
    targetSnapshot: { totalMinutes: 300 },
    blocks,
  });
  assert.equal(snapshot.targetDate, "2026-07-30");
  assert.deepEqual(snapshot.blocks, blocks);
  // Mutating the source array afterwards must not affect the frozen snapshot.
  blocks[0].start = 999;
  assert.equal(snapshot.blocks[0].start, 540);
});

test("hasBaseline distinguishes drafts with and without a captured baseline", () => {
  assert.equal(hasBaseline({}), false);
  assert.equal(hasBaseline({ baselinePlanSnapshot: null }), false);
  assert.equal(hasBaseline({ baselinePlanSnapshot: { targetDate: "2026-07-30" } }), true);
});

test("createPlanRevision produces a well-formed revision entry", () => {
  const revision = createPlanRevision({ createdAt: "t", effectiveFrom: "t2", reason: "启动延迟", changedBlockIds: ["b1"] });
  assert.ok(revision.revisionId);
  assert.equal(revision.reason, "启动延迟");
  assert.deepEqual(revision.changedBlockIds, ["b1"]);
});

test("spec example: 09:00-09:50 math moved to 11:00-11:50 at 10:30 keeps the original fact", () => {
  const block = { id: "b1", start: 540, end: 590, categoryId: "study.math" }; // 09:00-09:50
  const nowMinutes = 630; // 10:30
  assert.equal(isBlockLockedByNow(block, nowMinutes), true);
  assert.equal(classifyPastBlockStatus({ block, nowMinutes }), "missed");

  const result = rescheduleBlock({
    block,
    nowMinutes,
    newStart: 660, // 11:00
    newEnd: 710, // 11:50
    revisionId: "rev-1",
    rescheduledAt: "2026-07-30T02:30:00.000Z",
  });

  assert.equal(result.created, true);
  const [original, moved] = result.blocks;
  assert.equal(original.id, "b1");
  assert.equal(original.status, "rescheduled");
  assert.equal(original.start, 540);
  assert.equal(original.end, 590);

  assert.notEqual(moved.id, "b1");
  assert.equal(moved.originBlockId, "b1");
  assert.equal(moved.start, 660);
  assert.equal(moved.end, 710);
  assert.deepEqual(moved.rescheduledFrom, { start: 540, end: 590 });
  assert.equal(moved.revisionId, "rev-1");
});

test("a future block (not yet started) is edited in place, no origin link created", () => {
  const block = { id: "b1", start: 660, end: 710, categoryId: "study.math" }; // 11:00-11:50
  const nowMinutes = 540; // 09:00, well before start
  const result = rescheduleBlock({ block, nowMinutes, newStart: 700, newEnd: 750 });
  assert.equal(result.created, false);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].id, "b1");
  assert.equal(result.blocks[0].originBlockId, undefined);
});

test("cancelBlock deletes freely in the future but marks-not-deletes once locked", () => {
  const futureBlock = { id: "b1", start: 660, end: 710 };
  const pastBlock = { id: "b2", start: 300, end: 350 };
  const nowMinutes = 500;
  assert.deepEqual(cancelBlock({ block: futureBlock, nowMinutes }), { deleted: true, block: null });
  const cancelled = cancelBlock({ block: pastBlock, nowMinutes });
  assert.equal(cancelled.deleted, false);
  assert.equal(cancelled.block.status, "cancelled");
});

test("isCurrentPlanIdenticalToBaseline detects no-op edits so the baseline strip can hide", () => {
  const baseline = [{ id: "b1", start: 540, end: 590 }];
  assert.equal(isCurrentPlanIdenticalToBaseline({ baselineBlocks: baseline, currentBlocks: baseline }), true);
  assert.equal(isCurrentPlanIdenticalToBaseline({ baselineBlocks: baseline, currentBlocks: [{ id: "b1", start: 600, end: 650 }] }), false);
});

// ── firestoreSafeNormalize ───────────────────────────────────────────────

test("firestoreSafeNormalize: strips undefined values from flat objects", () => {
  const input = { a: 1, b: undefined, c: "hello", d: null };
  const result = firestoreSafeNormalize(input);
  assert.deepEqual(result, { a: 1, c: "hello", d: null });
  assert.equal("b" in result, false);
});

test("firestoreSafeNormalize: preserves falsy-but-legal values", () => {
  const input = { zero: 0, empty: "", false: false, nullVal: null };
  const result = firestoreSafeNormalize(input);
  assert.deepEqual(result, { zero: 0, empty: "", false: false, nullVal: null });
});

test("firestoreSafeNormalize: top-level undefined becomes null", () => {
  assert.equal(firestoreSafeNormalize(undefined), null);
});

test("firestoreSafeNormalize: array undefined elements become null (preserves index)", () => {
  const result = firestoreSafeNormalize([1, undefined, 3]);
  assert.deepEqual(result, [1, null, 3]);
});

test("firestoreSafeNormalize: nested objects inside arrays are cleaned", () => {
  const result = firestoreSafeNormalize([{ a: 1, b: undefined }, { c: 2 }]);
  assert.deepEqual(result, [{ a: 1 }, { c: 2 }]);
});

test("firestoreSafeNormalize: deeply nested undefined is stripped", () => {
  const input = { outer: { inner: { kept: "yes", gone: undefined } } };
  const result = firestoreSafeNormalize(input);
  assert.deepEqual(result, { outer: { inner: { kept: "yes" } } });
});

test("createBaselinePlanSnapshot: blocks with undefined fields are Firestore-safe", () => {
  // Simulates a real timeline block with a missing `status` field — common
  // when blocks are generated from segments that don't carry a status.
  const blocks = [
    { id: "b1", start: 540, end: 590, categoryId: "study.math", status: undefined, note: undefined },
    { id: "b2", start: 600, end: 650, categoryId: "study.english", status: undefined },
  ];
  const snapshot = createBaselinePlanSnapshot({
    targetDate: "2026-08-02",
    confirmedAt: "2026-08-02T10:00:00.000Z",
    blocks,
  });
  assert.equal(snapshot.targetDate, "2026-08-02");
  assert.equal(snapshot.blocks.length, 2);
  // `status` and `note` must not appear in the normalized block
  assert.equal("status" in snapshot.blocks[0], false);
  assert.equal("note" in snapshot.blocks[0], false);
  assert.equal("status" in snapshot.blocks[1], false);
  // Legal fields are preserved
  assert.equal(snapshot.blocks[0].id, "b1");
  assert.equal(snapshot.blocks[0].start, 540);
  assert.equal(snapshot.blocks[0].end, 590);
  assert.equal(snapshot.blocks[0].categoryId, "study.math");
});

test("createBaselinePlanSnapshot: undefined in nested objects (like segmentOverrides) is cleaned", () => {
  const blocks = [{
    id: "b1",
    start: 540,
    end: 590,
    segmentOverrides: { morning: undefined, evening: "20:00" },
    nested: { deep: { value: undefined, kept: 1 } },
  }];
  const snapshot = createBaselinePlanSnapshot({
    targetDate: "2026-08-02",
    confirmedAt: new Date().toISOString(),
    blocks,
  });
  const block = snapshot.blocks[0];
  assert.deepEqual(block.segmentOverrides, { evening: "20:00" });
  assert.deepEqual(block.nested, { deep: { kept: 1 } });
});
