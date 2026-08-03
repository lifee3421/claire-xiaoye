import test from "node:test";
import assert from "node:assert/strict";
import { resolveSegmentReturnToPool, isSupersededBlockStatus } from "./timelineRescheduleGate.js";

const nowIso = "2026-08-03T02:00:00.000Z";

function makeBlock(over = {}) {
  return {
    id: "math-1",
    title: "数学｜网课 1×50",
    category: "数学",
    categoryId: "study.math",
    categoryStatGroup: "study",
    start: 540,
    end: 590,
    studyMinutes: 50,
    breakMinutes: 0,
    priority: 2,
    preferredPeriods: ["morning"],
    note: "",
    status: "pending",
    ...over,
  };
}

test("future (not-started) block returns split:false — caller does plain pool placement", () => {
  // Block starts 09:00 (540) but 'now' is 08:00 (480) → not locked yet.
  const result = resolveSegmentReturnToPool({ block: makeBlock(), nowMinutes: 480, nowIso });
  assert.equal(result.split, false);
  assert.equal(result.newPoolBlock, undefined);
  assert.equal(result.originBlockId, undefined);
});

test("started/past block returns split:true with origin preservation + live pool replacement", () => {
  // 'now' is 10:00 (600), block already started → must keep history + make a new live pool block.
  const result = resolveSegmentReturnToPool({ block: makeBlock(), nowMinutes: 600, nowIso });
  assert.equal(result.split, true);
  assert.equal(result.originBlockId, "math-1");
  assert.ok(result.revision && typeof result.revision.revisionId === "string");

  const pool = result.newPoolBlock;
  assert.ok(pool);
  assert.equal(pool.originBlockId, "math-1");
  assert.equal(pool.source, "pool-return");
  assert.equal(pool.manualStart, null);
  assert.equal(pool.placement, "pool"); // explicit placement so downstream resolvers never reinterpret manualStart:null as 00:00
  assert.equal(pool.title, "数学｜网课 1×50");
  assert.equal(pool.categoryId, "study.math");
  assert.equal(pool.categoryStatGroup, "study");
  assert.deepEqual(pool.segments, [50]);
  assert.equal(pool.breakMinutes, 0);

  // The new pool block is a LIVE instance, never a superseded/historical record.
  assert.equal(isSupersededBlockStatus(pool.status), false);
  assert.equal(pool.status, undefined);
});

test("idFactory is honored (controlled, non-duplicate ids)", () => {
  let n = 0;
  const idFactory = () => `new-${++n}`;
  const result = resolveSegmentReturnToPool({ block: makeBlock(), nowMinutes: 600, idFactory, nowIso });
  assert.ok(result.newPoolBlock.id.startsWith("new-"));
  assert.ok(result.revision.revisionId.startsWith("new-"));
  assert.notEqual(result.newPoolBlock.id, result.revision.revisionId);
});

test("exactly one new live pool block is produced (no duplicate generation)", () => {
  const result = resolveSegmentReturnToPool({ block: makeBlock(), nowMinutes: 600, nowIso });
  assert.ok(result.newPoolBlock);
  assert.equal(Object.keys(result).sort().join(","), "newPoolBlock,originBlockId,revision,split");
});

test("work minutes come from the original block's active minutes, not break", () => {
  const result = resolveSegmentReturnToPool({
    block: makeBlock({ start: 600, end: 680, studyMinutes: 60, breakMinutes: 10 }),
    nowMinutes: 700,
    nowIso,
  });
  assert.deepEqual(result.newPoolBlock.segments, [60]);
  assert.equal(result.newPoolBlock.breakMinutes, 10);
});
