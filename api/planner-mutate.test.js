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
  let transactionRuns = 0;
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
      transactionRuns += 1;
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
    transactionRuns() { return transactionRuns; },
  };
}

async function mutate(db, { operationId, changes, extra = {}, now = "2026-08-16T03:00:00.000Z" }) {
  const currentDraft = db.readProfile().scheduleAssistantDraft;
  return handlePlannerUiMutationRequest({
    db,
    uid: "u1",
    body: {
      date: "2026-08-16",
      baseRevision: computePlannerContextBaseRevision({ draft: currentDraft }),
      operationId,
      changes,
      ...extra,
    },
    now: new Date(now),
  });
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

test("ordinary create/edit/complete/restore/pool-order/delete all acknowledge with appliedRevision", async () => {
  const db = fakeDb({ scheduleAssistantDraft: draft() });
  const applied = [];

  applied.push(await mutate(db, {
    operationId: "xiaoye:create:00000004",
    changes: [{ type: "create_task", taskId: "custom-english", title: "背单词", estimatedMinutes: 30, categoryId: "study.english", source: "xiaoye-ui" }],
  }));
  assert.equal(db.readProfile().scheduleAssistantDraft.todayCustomBlocks.some((item) => item.id === "custom-english"), true);

  applied.push(await mutate(db, {
    operationId: "xiaoye:edit:00000005",
    changes: [{ type: "edit_task", blockId: "custom-english-1", title: "背雅思单词", estimatedMinutes: 35, start: "16:00" }],
    now: "2026-08-16T03:00:01.000Z",
  }));
  assert.equal(db.readProfile().scheduleAssistantDraft.todaySegmentOverrides["custom-english-1"].manualStart, 960);

  applied.push(await mutate(db, {
    operationId: "xiaoye:complete:00000006",
    changes: [{ type: "edit_task", blockId: "custom-english-1", status: "completed" }],
    now: "2026-08-16T03:00:02.000Z",
  }));
  assert.equal(db.readProfile().scheduleAssistantDraft.todaySegmentOverrides["custom-english-1"].status, "completed");

  applied.push(await mutate(db, {
    operationId: "xiaoye:restore:00000007",
    changes: [{ type: "edit_task", blockId: "custom-english-1", status: "pending" }],
    now: "2026-08-16T03:00:03.000Z",
  }));
  assert.equal(db.readProfile().scheduleAssistantDraft.todaySegmentOverrides["custom-english-1"].status, "pending");

  applied.push(await mutate(db, {
    operationId: "xiaoye:pool-order:00000008",
    changes: [{ type: "set_pool_order", blockIds: ["custom-english", "custom-math"] }],
    now: "2026-08-16T03:00:04.000Z",
  }));
  assert.deepEqual(db.readProfile().scheduleAssistantDraft.taskPoolOrder, ["custom-english", "custom-math"]);

  applied.push(await mutate(db, {
    operationId: "xiaoye:delete:00000009",
    changes: [{ type: "delete_task", blockId: "custom-english-1" }],
    now: "2026-08-16T03:00:05.000Z",
  }));
  assert.equal(db.readProfile().scheduleAssistantDraft.todaySegmentOverrides["custom-english-1"].status, "cancelled");

  applied.forEach((result) => {
    assert.equal(result.outcome, "applied");
    assert.match(result.appliedRevision, /^v1:/);
  });
});

test("Inbox conversion atomically creates one provenance-linked block and schedules the Inbox item once", async () => {
  const initialDraft = draft();
  const db = fakeDb({
    scheduleAssistantDraft: initialDraft,
    plannerInbox: [{
      id: "inbox-1",
      title: "整理错题",
      categoryId: "study.math",
      estimatedMinutes: 30,
      priority: 2,
      status: "active",
      createdAt: "2026-08-16T01:00:00.000Z",
      updatedAt: "2026-08-16T01:00:00.000Z",
      kind: "task",
      source: "user",
    }],
  });
  const body = {
    date: "2026-08-16",
    baseRevision: computePlannerContextBaseRevision({ draft: initialDraft }),
    operationId: "xiaoye:inbox:00000010",
    changes: [{
      type: "create_task",
      taskId: "inbox-task-1",
      title: "整理错题",
      estimatedMinutes: 30,
      categoryId: "study.math",
      source: "inbox",
      sourceId: "inbox-1",
      originInboxItemId: "inbox-1",
    }],
    inboxTransition: { itemId: "inbox-1", taskId: "inbox-task-1" },
  };

  const first = await handlePlannerUiMutationRequest({ db, uid: "u1", body, now: new Date("2026-08-16T03:00:00.000Z") });
  const afterFirst = db.readProfile();
  const second = await handlePlannerUiMutationRequest({ db, uid: "u1", body, now: new Date("2026-08-16T03:00:01.000Z") });
  const afterSecond = db.readProfile();

  assert.equal(first.outcome, "applied");
  assert.match(first.appliedRevision, /^v1:/);
  const created = afterFirst.scheduleAssistantDraft.todayCustomBlocks.filter((item) => item.id === "inbox-task-1");
  assert.equal(created.length, 1);
  assert.equal(created[0].source, "inbox");
  assert.equal(created[0].sourceId, "inbox-1");
  assert.equal(created[0].originInboxItemId, "inbox-1");
  const inbox = afterFirst.plannerInbox.find((item) => item.id === "inbox-1");
  assert.equal(inbox.status, "scheduled");
  assert.equal(inbox.scheduledDate, "2026-08-16");
  assert.equal(inbox.scheduledTaskId, "inbox-task-1");

  assert.equal(second.idempotentReplay, true);
  assert.equal(afterSecond.scheduleAssistantDraft.todayCustomBlocks.filter((item) => item.id === "inbox-task-1").length, 1);
  assert.equal(afterSecond.plannerInbox.filter((item) => item.id === "inbox-1").length, 1);
  // One Firestore transaction performs schedule + Inbox companion writes. The
  // duplicate operation enters a transaction for receipt replay but adds zero writes.
  assert.equal(db.userWrites(), 2);
  assert.equal(db.transactionRuns(), 2);
});
