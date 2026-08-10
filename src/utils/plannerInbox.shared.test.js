import assert from "node:assert/strict";
import test from "node:test";
import {
  addInboxItem,
  buildTodayCustomBlockFromInboxItem,
  markInboxItemScheduled,
  selectSharedLedgerItems,
  updateInboxItem,
} from "./plannerInbox.js";

test("Snow follow-up metadata survives normalize/update and is day-scoped", () => {
  const now = new Date("2026-08-11T01:00:00.000Z");
  const items = addInboxItem([], {
    id: "follow-1",
    title: "🐾 数学结束后问一下",
    kind: "followup",
    source: "snowdust",
    targetDate: "2026-08-11",
    dueAt: "2026-08-11T13:00:00.000Z",
    triggerType: "after_end",
    boundBlockId: "math-2",
    followupText: "这节数学做完了吗？",
  }, { now });
  const updated = updateInboxItem(items, "follow-1", { reminderId: "reminder-1" }, { now: new Date("2026-08-11T01:01:00.000Z") });
  assert.equal(updated[0].kind, "followup");
  assert.equal(updated[0].source, "snowdust");
  assert.equal(updated[0].triggerType, "after_end");
  assert.equal(updated[0].reminderId, "reminder-1");
  assert.equal(selectSharedLedgerItems(updated, "2026-08-11").length, 1);
  assert.equal(selectSharedLedgerItems(updated, "2026-08-12").length, 0);
});

test("legacy/manual inbox items remain task items and can still become cards", () => {
  const items = addInboxItem([], { id: "task-1", title: "回学姐消息", estimatedMinutes: 10 }, { now: new Date("2026-08-11T01:00:00.000Z") });
  assert.equal(items[0].kind, "task");
  assert.equal(items[0].source, "user");
  assert.ok(buildTodayCustomBlockFromInboxItem(items[0], { taskId: "custom-1" }));
});

test("note and follow-up ledger entries never masquerade as schedule work", () => {
  for (const kind of ["note", "followup"]) {
    const item = addInboxItem([], { id: `${kind}-1`, title: kind, kind, estimatedMinutes: 10 }, { now: new Date("2026-08-11T01:00:00.000Z") })[0];
    assert.equal(buildTodayCustomBlockFromInboxItem(item, { taskId: "custom-x" }), null);
  }
});

test("a task already scheduled into the planner is not repeated in sharedLedger", () => {
  const items = addInboxItem([], { id: "task-1", title: "回消息", estimatedMinutes: 10 }, { now: new Date("2026-08-11T01:00:00.000Z") });
  const scheduled = markInboxItemScheduled(items, "task-1", { targetDate: "2026-08-11", taskId: "custom-1", now: new Date("2026-08-11T01:01:00.000Z") });
  assert.equal(scheduled[0].status, "scheduled");
  assert.deepEqual(selectSharedLedgerItems(scheduled, "2026-08-11"), []);
});
