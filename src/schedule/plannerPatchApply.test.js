import assert from "node:assert/strict";
import test from "node:test";
import { applyPlannerPatch, describeBlockRejection, resolveMovableLiveSegment, resolveMovableSegments, validatePatchConflicts } from "./plannerPatchApply.js";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";
import { PLANNER_PATCH_SCHEMA_VERSION } from "../agent/plannerPatch.js";

const now = new Date("2026-08-06T02:00:00.000Z"); // 10:00 Asia/Shanghai

function draft(overrides = {}) {
  const base = {
    targetDate: "2026-08-06",
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    todayCustomBlocks: [
      // Not yet started (11:00), no override -> lives on the timeline via its own manualStart.
      { id: "custom-future", title: "数学复习", categoryId: "study.math", segments: [50], breakMinutes: 10, priority: 2, manualOrder: 1, preferredPeriods: ["afternoon"], manualStart: 660, locked: false },
      // Already started (09:00-09:50, now is 10:00) -> locked by now.
      { id: "custom-started", title: "英语精读", categoryId: "study.english", segments: [50], breakMinutes: 0, priority: 2, manualOrder: 2, preferredPeriods: ["morning"], manualStart: 540, locked: false },
      // Still in the pool, no manualStart.
      { id: "custom-pool", title: "论文推进", categoryId: "study.thesis", segments: [40], breakMinutes: 5, priority: 1, manualOrder: 3, preferredPeriods: ["afternoon"] },
    ],
    todaySegmentOverrides: {},
    ...overrides,
  };
  return base;
}

function patchFor(draftValue, changes, overrides = {}) {
  return {
    schemaVersion: PLANNER_PATCH_SCHEMA_VERSION,
    date: draftValue.targetDate,
    baseRevision: computePlannerContextBaseRevision({ draft: draftValue }),
    changes,
    ...overrides,
  };
}

test("resolveMovableLiveSegment resolves both custom AND built-in movable segments, never a protected system card", () => {
  const d = draft();
  const segments = resolveMovableSegments(d, {});
  assert.ok(resolveMovableLiveSegment(segments, "custom-future-1"));
  assert.ok(resolveMovableLiveSegment(segments, "math-lecture-1"), "built-in template task must now resolve");
  assert.equal(resolveMovableLiveSegment(segments, "wake-prep-1"), null, "system-life card must never resolve");
  assert.equal(resolveMovableLiveSegment(segments, "lunch-1"), null);
  assert.equal(resolveMovableLiveSegment(segments, "not-a-real-task-1"), null);
});

test("move a not-yet-started custom block: in-place edit, no history split, no new revision", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "move", blockId: "custom-future-1", start: "14:00" }]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, true);
  assert.equal(result.nextDraft.todaySegmentOverrides["custom-future-1"].manualStart, 840);
  assert.equal((result.nextDraft.planRevisions || []).length, 0);
  assert.deepEqual(result.changedBlockIds, ["custom-future-1"]);
  assert.equal(result.summary, "移动 1 项");
});

test("move a BUILT-IN template task (math-lecture) — this is the whole point of this phase: real daily tasks are movable, not just todayCustomBlocks", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "move", blockId: "math-lecture-1", start: "16:00" }]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, true);
  assert.equal(result.nextDraft.todaySegmentOverrides["math-lecture-1"].manualStart, 960);
});

test("move an ALREADY-STARTED custom block: original preserved as rescheduled history, new linked block created, revision recorded — never silently rewritten in place", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "move", blockId: "custom-started-1", start: "15:00" }]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, true);
  assert.equal(result.nextDraft.todaySegmentOverrides["custom-started-1"].status, "rescheduled");
  assert.equal(result.nextDraft.todaySegmentOverrides["custom-started-1"].manualStart, undefined); // original time untouched
  assert.equal(result.nextDraft.todayCustomBlocks.length, 4); // original 3 + 1 new linked block
  const newBlock = result.nextDraft.todayCustomBlocks.at(-1);
  assert.equal(newBlock.manualStart, 900);
  assert.equal(newBlock.originBlockId, "custom-started-1");
  assert.equal(result.nextDraft.planRevisions.length, 1);
});

test("schedule_from_pool: a pool segment with no manualStart is placed onto the timeline, never treated as locked", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "schedule_from_pool", blockId: "custom-pool-1", start: "16:00" }]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, true);
  assert.equal(result.nextDraft.todaySegmentOverrides["custom-pool-1"].placement, "timeline");
  assert.equal(result.nextDraft.todaySegmentOverrides["custom-pool-1"].manualStart, 960);
});

test("return_to_pool on a future block: pool placement, no cancellation", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "return_to_pool", blockId: "custom-future-1" }]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, true);
  assert.equal(result.nextDraft.todaySegmentOverrides["custom-future-1"].placement, "pool");
});

test("return_to_pool on an ALREADY-STARTED block: soft-cancelled in place, never silently pooled/deleted", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "return_to_pool", blockId: "custom-started-1" }]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, true);
  assert.equal(result.nextDraft.todaySegmentOverrides["custom-started-1"].status, "cancelled");
  assert.notEqual(result.nextDraft.todaySegmentOverrides["custom-started-1"].placement, "pool");
});

test("create_from_tracker appends a new todayCustomBlocks entry with originTrackerId, requires a positive estimatedMinutes", () => {
  const d = draft();
  const withMinutes = patchFor(d, [{ type: "create_from_tracker", trackerId: "mask", title: "敷面膜", categoryId: "life.skincare", estimatedMinutes: 15 }]);
  const result = applyPlannerPatch({ draft: d, patch: withMinutes, now });
  assert.equal(result.ok, true);
  const created = result.nextDraft.todayCustomBlocks.at(-1);
  assert.equal(created.originTrackerId, "mask");
  assert.deepEqual(created.segments, [15]);
  assert.equal(result.summary, "新增 1 项");

  const withoutMinutes = patchFor(d, [{ type: "create_from_tracker", trackerId: "mask" }]);
  const rejected = applyPlannerPatch({ draft: d, patch: withoutMinutes, now });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "unresolvable_changes");
});

test("rejects a patch whose baseRevision no longer matches the current draft — stale, never silently overwritten", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "move", blockId: "custom-future-1", start: "14:00" }], { baseRevision: "v1:stale:deadbeef" });
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale");
  assert.equal(result.currentRevision, computePlannerContextBaseRevision({ draft: d }));
});

test("rejects a patch targeting a different date than the currently open draft", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "move", blockId: "custom-future-1", start: "14:00" }], { date: "2026-08-07" });
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "wrong_date");
});

test("rejects (whole patch, fail-closed) a change targeting an unresolvable id", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "move", blockId: "totally-made-up-task-1", start: "14:00" }]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unresolvable_changes");
});

test("rejects (whole patch, fail-closed) a change targeting a protected system-life card", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "move", blockId: "wake-prep-1", start: "14:00" }]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unresolvable_changes");
});

test("rejects a structurally invalid patch before touching the draft at all", () => {
  const d = draft();
  const result = applyPlannerPatch({ draft: d, patch: { schemaVersion: 99, date: d.targetDate, changes: [] }, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_shape");
});

test("applying a patch never mutates the input draft object", () => {
  const d = draft();
  const snapshot = JSON.parse(JSON.stringify(d));
  const patch = patchFor(d, [{ type: "move", blockId: "custom-future-1", start: "14:00" }]);
  applyPlannerPatch({ draft: d, patch, now });
  assert.deepEqual(d, snapshot);
});

test("a multi-change patch (move + return_to_pool + create_from_tracker) applies all three and reports a combined summary", () => {
  const d = draft();
  const patch = patchFor(d, [
    { type: "move", blockId: "custom-future-1", start: "14:00" },
    { type: "return_to_pool", blockId: "custom-pool-1" },
    { type: "create_from_tracker", trackerId: "reading", title: "阅读", estimatedMinutes: 20 },
  ]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, true);
  assert.equal(result.summary, "移动 1 项，放回任务池 1 项，新增 1 项");
  assert.equal(result.changedBlockIds.length, 3);
});

// --- conflict validation -----------------------------------------------------

test("apply is REJECTED wholesale when the proposed time overlaps dinner (a hard system-life card) — draft untouched, conflict details returned", () => {
  const d = draft({ dinnerMinutes: 40 }); // dinner defaults to 18:00-18:40
  const patch = patchFor(d, [{ type: "move", blockId: "custom-future-1", start: "18:20" }]); // 18:20-19:10 overlaps dinner
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "conflict");
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, "fixed_block_overlap");
  assert.equal(result.conflicts[0].withId, "dinner");
});

test("apply is REJECTED when the proposed time overlaps another currently-live movable task", () => {
  const d = draft({
    todayCustomBlocks: [
      { id: "custom-a", title: "A", categoryId: "personal", segments: [50], breakMinutes: 0, manualOrder: 1, manualStart: 900 }, // 15:00-15:50
      { id: "custom-b", title: "B", categoryId: "personal", segments: [30], breakMinutes: 0, manualOrder: 2 },
    ],
  });
  const patch = patchFor(d, [{ type: "move", blockId: "custom-b-1", start: "15:20" }]); // overlaps custom-a-1's 15:00-15:50
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "conflict");
  assert.equal(result.conflicts[0].type, "task_overlap");
  assert.equal(result.conflicts[0].withId, "custom-a-1");
});

test("apply is REJECTED when the proposed time falls outside today's timeline boundary", () => {
  const d = draft({ wakeUpTime: "07:30", targetBedTime: "23:00" });
  const patch = patchFor(d, [{ type: "move", blockId: "custom-future-1", start: "23:30" }]); // after bedtime
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "conflict");
  assert.equal(result.conflicts[0].type, "out_of_bounds");
});

test("two changes in the SAME patch that would overlap each other are also rejected", () => {
  const d = draft();
  const patch = patchFor(d, [
    { type: "schedule_from_pool", blockId: "custom-pool-1", start: "16:00" }, // 40min: 16:00-16:40
    { type: "move", blockId: "custom-future-1", start: "16:20" }, // overlaps the above
  ]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "conflict");
  assert.ok(result.conflicts.some((c) => c.type === "task_overlap"));
});

test("moving a block to where it ALREADY sits (no actual displacement) never conflicts with itself", () => {
  const d = draft();
  const patch = patchFor(d, [{ type: "move", blockId: "custom-future-1", start: "11:00" }]); // manualStart 660 === 11:00
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, true);
});

test("validatePatchConflicts: a clean, non-overlapping placement passes with no conflicts", () => {
  const d = draft();
  const segments = resolveMovableSegments(d, {});
  const check = validatePatchConflicts({ draft: d, segments, positions: [{ id: "custom-future-1", start: 840, end: 890 }] });
  assert.equal(check.ok, true);
  assert.deepEqual(check.conflicts, []);
});

test("conflict rejection never mutates the draft", () => {
  const d = draft({ dinnerMinutes: 40 });
  const snapshot = JSON.parse(JSON.stringify(d));
  const patch = patchFor(d, [{ type: "move", blockId: "custom-future-1", start: "18:20" }]);
  applyPlannerPatch({ draft: d, patch, now });
  assert.deepEqual(d, snapshot);
});

// --- legacy fixed event protection -------------------------------------------

function draftWithFixedEvent(fixedEventOverrides = {}) {
  return draft({
    fixedEvents: [{ id: "meeting-1", title: "牙医预约", startTime: "10:00", endTime: "10:30", location: "医院", locked: true }],
    fixedEventOverrides,
  });
}

test("a locked legacy fixed event (a real calendar commitment, the default) is NOT resolvable — move/return_to_pool both rejected with a specific reason", () => {
  const d = draftWithFixedEvent();
  const segments = resolveMovableSegments(d, {});
  assert.equal(resolveMovableLiveSegment(segments, "meeting-1-1"), null);
  assert.equal(describeBlockRejection(segments, "meeting-1-1"), "protected_fixed_event");

  const movePatch = patchFor(d, [{ type: "move", blockId: "meeting-1-1", start: "14:00" }]);
  const moveResult = applyPlannerPatch({ draft: d, patch: movePatch, now });
  assert.equal(moveResult.ok, false);
  assert.equal(moveResult.reason, "unresolvable_changes");
  assert.equal(moveResult.rejections[0].reason, "protected_fixed_event");

  const returnPatch = patchFor(d, [{ type: "return_to_pool", blockId: "meeting-1-1" }]);
  const returnResult = applyPlannerPatch({ draft: d, patch: returnPatch, now });
  assert.equal(returnResult.ok, false);
  assert.equal(returnResult.reason, "unresolvable_changes");
});

test("a legacy fixed event explicitly marked constraint: hard is protected even if not locked", () => {
  const d = draftWithFixedEvent({ "meeting-1": { locked: false, constraint: "hard" } });
  const segments = resolveMovableSegments(d, {});
  assert.equal(resolveMovableLiveSegment(segments, "meeting-1-1"), null);
  assert.equal(describeBlockRejection(segments, "meeting-1-1"), "protected_fixed_event");
});

test("an explicitly UNLOCKED, soft legacy fixed event IS movable — the protection is about lock/constraint, not source alone", () => {
  const d = draftWithFixedEvent({ "meeting-1": { locked: false, constraint: "soft" } });
  const segments = resolveMovableSegments(d, {});
  const segment = resolveMovableLiveSegment(segments, "meeting-1-1");
  assert.ok(segment, "an unlocked, soft fixed event must remain movable");

  const patch = patchFor(d, [{ type: "move", blockId: "meeting-1-1", start: "15:00" }]);
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, true);
});

test("ordinary todayCustomBlocks/built-in tasks are never affected by the fixed-event protection, even when they happen to have locked:true", () => {
  const d = draft({
    todayCustomBlocks: [{ id: "custom-locked", title: "手动锁定的任务", categoryId: "personal", segments: [30], breakMinutes: 0, manualOrder: 1, manualStart: 900, locked: true }],
  });
  const segments = resolveMovableSegments(d, {});
  assert.ok(resolveMovableLiveSegment(segments, "custom-locked-1"), "locked is only protective for source==='legacy-fixed-event'");
});

test("protection rejection messages are legible and distinct per reason", () => {
  const d = draftWithFixedEvent();
  const segments = resolveMovableSegments(d, {});
  assert.equal(describeBlockRejection(segments, "wake-prep-1"), "protected_system_card");
  assert.equal(describeBlockRejection(segments, "meeting-1-1"), "protected_fixed_event");
  assert.equal(describeBlockRejection(segments, "no-such-task-1"), "not_found");
});

// --- morning-prep-minutes conflict-boundary consistency ----------------------

test("conflict boundary uses the SAME morning-prep-minutes rule the client applies (school + no commute -> 40min default), not a flat 0 fallback", () => {
  // No explicit draft.morningPrepMinutes, school scene, no commute -> the real
  // default is 40min (resolveMorningPrepMinutes), not 0. wake-prep therefore
  // spans [wakeUpTime, wakeUpTime+40) and a proposal landing inside that
  // window must be rejected as a fixed_block_overlap.
  const d = draft({ scene: "school", commuteStatus: "no", wakeUpTime: "07:30" });
  const patch = patchFor(d, [{ type: "move", blockId: "custom-future-1", start: "07:45" }]); // inside 07:30-08:10 wake-prep
  const result = applyPlannerPatch({ draft: d, patch, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "conflict");
  assert.equal(result.conflicts[0].withId, "wake-prep");
});

// --- reading task identity via books/readingSessions -------------------------

test("the `reading` group is resolvable via apply when books/readingSessions are supplied, matching the client's own resolveRecentReadingTitle rule", () => {
  const d = draft();
  const withoutBooks = resolveMovableSegments(d, {});
  assert.equal(resolveMovableLiveSegment(withoutBooks, "reading-1"), null, "no books/readingSessions supplied -> reading does not exist, fails closed");

  const withBooks = resolveMovableSegments(d, {}, { books: [{ title: "百年孤独", status: "reading" }] });
  assert.ok(resolveMovableLiveSegment(withBooks, "reading-1"), "an active 'reading'-status book makes the reading group resolvable");

  const patch = patchFor(d, [{ type: "schedule_from_pool", blockId: "reading-1", start: "20:30" }]);
  const applyResult = applyPlannerPatch({ draft: d, settings: {}, books: [{ title: "百年孤独", status: "reading" }], patch: { ...patch, baseRevision: computePlannerContextBaseRevision({ draft: d }) }, now });
  assert.equal(applyResult.ok, true);
});
