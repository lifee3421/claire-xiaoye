import assert from "node:assert/strict";
import test from "node:test";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";
import { handlePlannerDirectEditRequest, validateDirectPlannerChanges } from "./planner-direct-edit.js";

function draft(overrides = {}) {
  return {
    targetDate: "2026-08-06",
    savedOn: "2026-08-06",
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    todayCustomBlocks: [
      { id: "custom-future", title: "数学复习", categoryId: "study.math", segments: [50], breakMinutes: 10, priority: 2, manualOrder: 1, preferredPeriods: ["afternoon"], manualStart: 660, locked: false },
    ],
    todaySegmentOverrides: {},
    ...overrides,
  };
}

function fakeDb(initialProfile = {}) {
  let profile = structuredClone(initialProfile);
  const userRef = {
    path: "users/u1",
    collection(name) {
      assert.ok(["books", "readingSessions"].includes(name));
      return { async get() { return { docs: [] }; } };
    },
  };
  return {
    collection(name) {
      assert.equal(name, "users");
      return { doc(uid) { assert.equal(uid, "u1"); return userRef; } };
    },
    async runTransaction(fn) {
      return fn({
        async get(ref) {
          assert.equal(ref, userRef);
          return { exists: true, data: () => structuredClone(profile) };
        },
        set(ref, patch, options) {
          assert.equal(ref, userRef);
          assert.deepEqual(options, { merge: true });
          profile = { ...profile, ...structuredClone(patch) };
        },
      });
    },
    readProfile() { return structuredClone(profile); },
  };
}

test("direct edit accepts a small batch of ordinary-card mutations", () => {
  assert.deepEqual(validateDirectPlannerChanges([
    { type: "move", blockId: "math-1", start: "20:00" },
    { type: "edit_task", blockId: "math-2", title: "数学复习" },
  ]), []);
});

test("template apply and large replans stay behind proposal confirmation", () => {
  assert.match(validateDirectPlannerChanges([{ type: "apply_template", templateId: "tpl" }])[0], /requires PlannerProposal/);
  const large = validateDirectPlannerChanges([
    { type: "move" }, { type: "move" }, { type: "move" }, { type: "move" },
  ]);
  assert.match(large[0], /at most 3 changes/);
});

test("same direct-edit operation id replays the committed result even though the planner revision has changed", async () => {
  const initialDraft = draft();
  const db = fakeDb({ scheduleAssistantDraft: initialDraft });
  const body = {
    date: "2026-08-06",
    baseRevision: computePlannerContextBaseRevision({ draft: initialDraft }),
    operationId: "snowdust:direct:00000001",
    changes: [{ type: "move", blockId: "custom-future-1", start: "14:00" }],
  };
  const first = await handlePlannerDirectEditRequest({ db, uid: "u1", body, now: new Date("2026-08-06T02:00:00.000Z") });
  assert.equal(first.outcome, "applied");
  assert.equal(first.idempotentReplay, undefined);

  const second = await handlePlannerDirectEditRequest({ db, uid: "u1", body, now: new Date("2026-08-06T02:00:05.000Z") });
  assert.equal(second.outcome, "applied");
  assert.equal(second.idempotentReplay, true);
  assert.deepEqual(second.changedBlockIds, first.changedBlockIds);
  assert.equal(second.appliedRevision, first.appliedRevision);
  assert.equal(db.readProfile().plannerBridgeOperationReceipts.length, 1);
});

test("direct-edit operation id cannot be reused for a different patch", async () => {
  const initialDraft = draft();
  const db = fakeDb({ scheduleAssistantDraft: initialDraft });
  const baseRevision = computePlannerContextBaseRevision({ draft: initialDraft });
  const operationId = "snowdust:direct:00000002";
  const first = await handlePlannerDirectEditRequest({
    db,
    uid: "u1",
    body: { date: "2026-08-06", baseRevision, operationId, changes: [{ type: "move", blockId: "custom-future-1", start: "14:00" }] },
    now: new Date("2026-08-06T02:00:00.000Z"),
  });
  assert.equal(first.outcome, "applied");

  const mismatch = await handlePlannerDirectEditRequest({
    db,
    uid: "u1",
    body: { date: "2026-08-06", baseRevision, operationId, changes: [{ type: "move", blockId: "custom-future-1", start: "15:00" }] },
    now: new Date("2026-08-06T02:01:00.000Z"),
  });
  assert.deepEqual(mismatch, { outcome: "rejected", reason: "operation_id_reused" });
});
