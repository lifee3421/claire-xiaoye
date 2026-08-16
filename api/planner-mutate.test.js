import assert from "node:assert/strict";
import test from "node:test";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";
import { handlePlannerUiMutationRequest } from "./planner-mutate.js";

function draft(overrides = {}) {
  return {
    targetDate: "2026-08-16",
    savedOn: "2026-08-16",
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    todayCustomBlocks: [
      { id: "custom-math", title: "数学", categoryId: "study.math", segments: [50], breakMinutes: 10, priority: 2, manualStart: 840, locked: false },
    ],
    todaySegmentOverrides: {},
    ...overrides,
  };
}

function fakeDb(initialProfile = {}) {
  let profile = structuredClone(initialProfile);
  let userWrites = 0;
  const userRef = {
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
          userWrites += 1;
          profile = { ...profile, ...structuredClone(patch) };
        },
      });
    },
    readProfile() { return structuredClone(profile); },
    userWrites() { return userWrites; },
  };
}

test("Xiaoye move commits through the canonical daily kernel and returns appliedRevision", async () => {
  const initialDraft = draft();
  const db = fakeDb({ scheduleAssistantDraft: initialDraft });
  const result = await handlePlannerUiMutationRequest({
    db,
    uid: "u1",
    body: {
      date: "2026-08-16",
      baseRevision: computePlannerContextBaseRevision({ draft: initialDraft }),
      operationId: "xiaoye:drag:00000001",
      changes: [{ type: "move", blockId: "custom-math-1", start: "15:00" }],
    },
    now: new Date("2026-08-16T03:00:00.000Z"),
  });
  assert.equal(result.outcome, "applied");
  assert.match(result.appliedRevision, /^v1:/);
  assert.equal(db.readProfile().scheduleAssistantDraft.todaySegmentOverrides["custom-math-1"].manualStart, 900);
  assert.equal(db.userWrites(), 1);
});

test("stale Xiaoye revision rejects without overwriting the canonical draft", async () => {
  const initialDraft = draft();
  const db = fakeDb({ scheduleAssistantDraft: initialDraft });
  const before = db.readProfile();
  const result = await handlePlannerUiMutationRequest({
    db,
    uid: "u1",
    body: {
      date: "2026-08-16",
      baseRevision: "v1:old:deadbeef",
      operationId: "xiaoye:drag:00000002",
      changes: [{ type: "move", blockId: "custom-math-1", start: "15:00" }],
    },
    now: new Date("2026-08-16T03:00:00.000Z"),
  });
  assert.equal(result.outcome, "stale");
  assert.deepEqual(db.readProfile(), before);
  assert.equal(db.userWrites(), 0);
});

test("duplicate Xiaoye operation id replays one canonical write", async () => {
  const initialDraft = draft();
  const db = fakeDb({ scheduleAssistantDraft: initialDraft });
  const body = {
    date: "2026-08-16",
    baseRevision: computePlannerContextBaseRevision({ draft: initialDraft }),
    operationId: "xiaoye:drag:00000003",
    changes: [{ type: "move", blockId: "custom-math-1", start: "15:00" }],
  };
  const first = await handlePlannerUiMutationRequest({ db, uid: "u1", body, now: new Date("2026-08-16T03:00:00.000Z") });
  const second = await handlePlannerUiMutationRequest({ db, uid: "u1", body, now: new Date("2026-08-16T03:00:01.000Z") });
  assert.equal(first.outcome, "applied");
  assert.equal(second.outcome, "applied");
  assert.equal(second.idempotentReplay, true);
  assert.equal(db.userWrites(), 1);
});
