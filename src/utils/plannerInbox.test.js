import assert from "node:assert/strict";
import test from "node:test";
import {
  addInboxItem,
  archiveInboxItem,
  buildTodayCustomBlockFromInboxItem,
  createInboxItem,
  markInboxItemScheduled,
  normalizeInboxItem,
  normalizeInboxItems,
  removeInboxItem,
  restoreInboxItem,
  selectActiveInboxItems,
  unscheduleInboxItem,
  updateInboxItem,
} from "./plannerInbox.js";

const NOW = new Date("2026-08-06T02:00:00.000Z");

test("createInboxItem fills defaults and stamps created/updated", () => {
  const item = createInboxItem({ title: "整理431错题体系", categoryId: "study.math" }, { now: NOW });
  assert.equal(item.title, "整理431错题体系");
  assert.equal(item.categoryId, "study.math");
  assert.equal(item.status, "active");
  assert.equal(item.priority, 2);
  assert.equal(item.estimatedMinutes, null);
  assert.equal(item.deadline, "");
  assert.equal(item.createdAt, NOW.toISOString());
  assert.equal(item.updatedAt, NOW.toISOString());
  assert.match(item.id, /^inbox-/);
});

test("normalizeInboxItem drops malformed input and coerces bad fields to safe defaults", () => {
  assert.equal(normalizeInboxItem({ title: "no id" }), null);
  const normalized = normalizeInboxItem({ id: "x", status: "bogus", priority: 99, estimatedMinutes: -5, deadline: "not-a-date" });
  assert.equal(normalized.status, "active");
  assert.equal(normalized.priority, 2);
  assert.equal(normalized.estimatedMinutes, null);
  assert.equal(normalized.deadline, "");
});

test("addInboxItem / updateInboxItem / archiveInboxItem / restoreInboxItem / removeInboxItem round-trip", () => {
  let items = addInboxItem([], { title: "回邮件", categoryId: "personal", estimatedMinutes: 15 }, { now: NOW });
  const id = items[0].id;

  items = updateInboxItem(items, id, { note: "先看主题" }, { now: new Date(NOW.getTime() + 1000) });
  assert.equal(items[0].note, "先看主题");
  assert.equal(items[0].updatedAt, new Date(NOW.getTime() + 1000).toISOString());
  assert.equal(items[0].createdAt, NOW.toISOString(), "createdAt must never change on update");

  items = archiveInboxItem(items, id, { now: NOW });
  assert.equal(items[0].status, "archived");

  items = restoreInboxItem(items, id, { now: NOW });
  assert.equal(items[0].status, "active");

  items = removeInboxItem(items, id);
  assert.equal(items.length, 0);
});

test("updateInboxItem is a no-op (returns an equivalent list) when the id does not exist", () => {
  const items = normalizeInboxItems([{ id: "a", title: "t" }]);
  const next = updateInboxItem(items, "missing", { note: "x" });
  assert.deepEqual(next, items);
});

test("buildTodayCustomBlockFromInboxItem inherits title/category/priority/note and stamps originInboxItemId", () => {
  const item = createInboxItem({ title: "买某样东西", categoryId: "life.shopping", priority: 1, note: "记得带发票", estimatedMinutes: 30 }, { now: NOW });
  const block = buildTodayCustomBlockFromInboxItem(item, { taskId: "custom-1", manualOrder: 3, now: NOW });
  assert.equal(block.id, "custom-1");
  assert.equal(block.title, "买某样东西");
  assert.equal(block.categoryId, "life.shopping");
  assert.equal(block.priority, 1);
  assert.equal(block.note, "记得带发票");
  assert.deepEqual(block.segments, [30]);
  assert.equal(block.manualOrder, 3);
  assert.equal(block.source, "inbox");
  assert.equal(block.originInboxItemId, item.id);
});

test("buildTodayCustomBlockFromInboxItem refuses to guess a duration — returns null with no minutes anywhere", () => {
  const item = createInboxItem({ title: "整理项目" }, { now: NOW });
  assert.equal(item.estimatedMinutes, null);
  assert.equal(buildTodayCustomBlockFromInboxItem(item, { taskId: "custom-2" }), null);
});

test("buildTodayCustomBlockFromInboxItem accepts a UI-supplied override when the item itself has no estimate", () => {
  const item = createInboxItem({ title: "整理项目" }, { now: NOW });
  const block = buildTodayCustomBlockFromInboxItem(item, { taskId: "custom-3", estimatedMinutesOverride: 45 });
  assert.deepEqual(block.segments, [45]);
});

test("markInboxItemScheduled / unscheduleInboxItem toggle status and scheduledDate/scheduledTaskId without touching todayCustomBlocks", () => {
  let items = addInboxItem([], { title: "更新日历同步", estimatedMinutes: 20 }, { now: NOW });
  const id = items[0].id;
  items = markInboxItemScheduled(items, id, { targetDate: "2026-08-07", taskId: "custom-9", now: NOW });
  assert.equal(items[0].status, "scheduled");
  assert.equal(items[0].scheduledDate, "2026-08-07");
  assert.equal(items[0].scheduledTaskId, "custom-9");

  items = unscheduleInboxItem(items, id, { now: NOW });
  assert.equal(items[0].status, "active");
  assert.equal(items[0].scheduledDate, "");
  assert.equal(items[0].scheduledTaskId, "");
});

test("scheduling one item never mutates or removes any other inbox item (no cross-day pollution)", () => {
  let items = addInboxItem([], { title: "A", estimatedMinutes: 10 }, { now: NOW });
  items = addInboxItem(items, { title: "B", estimatedMinutes: 10 }, { now: new Date(NOW.getTime() + 1000) });
  const [a, b] = items;
  items = markInboxItemScheduled(items, a.id, { targetDate: "2026-08-07", taskId: "custom-a", now: NOW });
  const untouchedB = items.find((item) => item.id === b.id);
  assert.deepEqual(untouchedB, b);
});

test("selectActiveInboxItems excludes scheduled and archived items", () => {
  let items = addInboxItem([], { title: "A" }, { now: NOW });
  items = addInboxItem(items, { title: "B" }, { now: new Date(NOW.getTime() + 1000) });
  items = archiveInboxItem(items, items[1].id, { now: NOW });
  const active = selectActiveInboxItems(items);
  assert.equal(active.length, 1);
  assert.equal(active[0].title, "A");
});

