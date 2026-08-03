import test from "node:test";
import assert from "node:assert/strict";
import {
  createBaselinePlanSnapshot,
  isSupersededBlockStatus,
  isLivePlanBlock,
  isCurrentPlanIdenticalToBaseline,
} from "./baselinePlanModel.js";

test("isSupersededBlockStatus recognizes rescheduled/cancelled only", () => {
  assert.equal(isSupersededBlockStatus("rescheduled"), true);
  assert.equal(isSupersededBlockStatus("cancelled"), true);
  assert.equal(isSupersededBlockStatus("pending"), false);
  assert.equal(isSupersededBlockStatus("completed"), false);
  assert.equal(isSupersededBlockStatus(undefined), false);
  assert.equal(isSupersededBlockStatus(null), false);
});

test("isLivePlanBlock is the inverse of superseded", () => {
  assert.equal(isLivePlanBlock({ status: "cancelled" }), false);
  assert.equal(isLivePlanBlock({ status: "rescheduled" }), false);
  assert.equal(isLivePlanBlock({ status: "pending" }), true);
  assert.equal(isLivePlanBlock({}), true);
  assert.equal(isLivePlanBlock(undefined), true);
});

test("createBaselinePlanSnapshot leaves targetSnapshot null by default (study-target decoupled)", () => {
  const snapshot = createBaselinePlanSnapshot({
    targetDate: "2026-08-03",
    confirmedAt: "2026-08-03T01:00:00.000Z",
    blocks: [{ id: "b1", start: 540, end: 590, categoryId: "study.math" }],
  });
  assert.equal(snapshot.targetSnapshot, null);
});

test("isCurrentPlanIdenticalToBaseline compares live blocks only (superseded ignored)", () => {
  const baselineBlocks = [{ id: "b1", start: 540, end: 590 }];
  const currentWithCancelledHistory = [
    { id: "b1", start: 540, end: 590 },
    { id: "b1-old", start: 480, end: 530, status: "cancelled" },
  ];
  assert.equal(
    isCurrentPlanIdenticalToBaseline({ baselineBlocks, currentBlocks: currentWithCancelledHistory }),
    true,
    "a cancelled history block must not make current != baseline",
  );
  const currentMoved = [{ id: "b1", start: 600, end: 650 }];
  assert.equal(
    isCurrentPlanIdenticalToBaseline({ baselineBlocks, currentBlocks: currentMoved }),
    false,
  );
});
