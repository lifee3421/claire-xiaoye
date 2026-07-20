import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentDaySnapshot, buildAgentDaySnapshotFromDailyData } from "./buildAgentDaySnapshot.js";

const now = new Date("2026-07-16T01:45:00.000Z"); // 09:45 Asia/Shanghai
const timeline = [
  { id: "fixed", title: "早餐", category: "生活", start: 540, end: 570, kind: "fixed", locked: true },
  { id: "done", title: "线性代数", category: "数学", start: 570, end: 630, kind: "task", status: "completed" },
  { id: "pending", title: "英语", category: "英语", start: 660, end: 720, kind: "task", status: "pending", locked: true },
];

function snapshot(overrides = {}) {
  return buildAgentDaySnapshot({ date: "2026-07-16", timeline, now, metadata: { sourceMode: "demo" }, ...overrides });
}

test("maps a complete timeline, fixed/locked flags, and completed progress", () => {
  const result = snapshot();
  assert.equal(result.timeline.length, 3);
  assert.deepEqual(result.timeline[0], { id: "fixed", title: "早餐", category: "生活", start: "09:00", end: "09:30", plannedMinutes: 30, status: null, fixed: true, locked: true });
  assert.deepEqual(result.progress, { completedBlocks: 1, totalBlocks: 2, completedPlannedMinutes: 60, totalPlannedMinutes: 120 });
});

test("returns an available empty day without NaN or a current task", () => {
  const result = snapshot({ timeline: [] });
  assert.equal(result.available, true);
  assert.deepEqual(result.timeline, []);
  assert.equal(result.currentByClock, null);
  assert.deepEqual(result.progress, { completedBlocks: 0, totalBlocks: 0, completedPlannedMinutes: 0, totalPlannedMinutes: 0 });
});

test("finds the block containing the clock without claiming execution", () => {
  const result = snapshot();
  assert.equal(result.currentByClock.id, "done");
  assert.equal(result.nextTask.id, "pending");
});

test("returns null currentByClock during a gap", () => {
  const result = snapshot({ now: new Date("2026-07-16T02:45:00.000Z") }); // 10:45
  assert.equal(result.currentByClock, null);
  assert.equal(result.nextTask.id, "pending");
});

test("returns the first future task before the day starts", () => {
  const result = snapshot({ now: new Date("2026-07-15T23:00:00.000Z") }); // 07:00
  assert.equal(result.currentByClock, null);
  assert.equal(result.nextTask.id, "done");
});

test("returns no next task after all tasks", () => {
  const result = snapshot({ now: new Date("2026-07-16T16:00:00.000Z") });
  assert.equal(result.currentByClock, null);
  assert.equal(result.nextTask, null);
});

test("does not auto-complete pending work after its end time", () => {
  const result = snapshot({ now: new Date("2026-07-16T16:00:00.000Z") });
  assert.equal(result.timeline.find((block) => block.id === "pending").status, "pending");
  assert.equal(result.progress.completedBlocks, 1);
});

test("does not invent skipped or moved states", () => {
  const result = snapshot({ timeline: [{ id: "legacy", title: "旧任务", start: 600, end: 630, status: "moved" }] });
  assert.equal(result.timeline[0].status, null);
});

test("returns null planUpdatedAt when the stored value is absent or invalid", () => {
  assert.equal(snapshot({ metadata: { sourceMode: "demo" } }).planUpdatedAt, null);
  assert.equal(snapshot({ metadata: { planUpdatedAt: "invalid" } }).planUpdatedAt, null);
});

test("keeps a valid planUpdatedAt as an ISO timestamp", () => {
  assert.equal(snapshot({ metadata: { planUpdatedAt: "2026-07-16T08:00:00+08:00" } }).planUpdatedAt, "2026-07-16T00:00:00.000Z");
});

test("normalizes a not_started review", () => {
  assert.deepEqual(snapshot({ review: { status: "not_started" } }).review, { status: "not_started", submittedAt: null });
});

test("normalizes a local draft review without treating it as submitted", () => {
  assert.deepEqual(snapshot({ review: { status: "draft" } }).review, { status: "draft", submittedAt: null });
});

test("normalizes a submitted review timestamp", () => {
  assert.deepEqual(snapshot({ review: { status: "submitted", submittedAt: "2026-07-16T13:00:00.000Z" } }).review, { status: "submitted", submittedAt: "2026-07-16T13:00:00.000Z" });
});

test("adapts firebase and demo data to the same schema", () => {
  const input = { plan: { targetDate: "2026-07-16", blocks: timeline }, profile: { scheduleAssistantDraft: { updatedAt: "2026-07-16T01:00:00.000Z" } }, settlements: [{ reviewDate: "2026-07-16", createdAt: "2026-07-16T12:00:00.000Z" }], now };
  const firebase = buildAgentDaySnapshotFromDailyData({ ...input, sourceMode: "firebase" });
  const demo = buildAgentDaySnapshotFromDailyData({ ...input, sourceMode: "demo" });
  assert.deepEqual(Object.keys(firebase), Object.keys(demo));
  assert.deepEqual(firebase.timeline, demo.timeline);
  assert.equal(firebase.review.status, "submitted");
  assert.equal(firebase.source.mode, "firebase");
  assert.equal(demo.source.mode, "demo");
});

test("drops malformed blocks safely", () => {
  const result = snapshot({ timeline: [{ id: "bad", start: "nope", end: 30 }, { id: "zero", start: 30, end: 30 }, { id: "good", title: "有效", start: "11:00", end: "11:20" }] });
  assert.deepEqual(result.timeline.map((block) => block.id), ["good"]);
  assert.equal(result.timeline[0].plannedMinutes, 20);
});

test("marks an unavailable adapter input without throwing", () => {
  const result = buildAgentDaySnapshotFromDailyData({ sourceMode: "demo", now });
  assert.equal(result.available, false);
  assert.deepEqual(result.timeline, []);
  assert.equal(result.review.status, "not_started");
});

test("includes valid explicit stage boundaries and omits invalid or missing boundaries", () => {
  const boundaries={morning:{start:"00:00",end:"11:30"},afternoon:{start:"11:30",end:"18:30"},evening:{start:"18:30",end:"23:59"}};
  assert.deepEqual(snapshot({metadata:{sourceMode:"demo",stageBoundaries:boundaries}}).stageBoundaries,boundaries);
  const malformed={...boundaries,morning:{start:"bad",end:"11:30"}};
  assert.equal(snapshot({metadata:{sourceMode:"demo",stageBoundaries:malformed}}).stageBoundaries,undefined);
  assert.equal(snapshot({metadata:{sourceMode:"demo"}}).stageBoundaries,undefined);
});

test("uses the semantic wake card rather than plan wakeUpTime or the first task", () => {
  const blocks = [{ id: "study-first", title: "Study", start: "06:00", end: "06:30" }, { id: "wake-prep", systemRole: "wake_routine", title: "Wake", start: "07:20", end: "07:40", kind: "fixed" }];
  const result = buildAgentDaySnapshotFromDailyData({ plan: { targetDate: "2026-07-17", wakeUpTime: "09:00", blocks }, sourceMode: "demo", now });
  assert.equal(result.wakeTime, "07:20");
  const moved = buildAgentDaySnapshotFromDailyData({ plan: { targetDate: "2026-07-17", wakeUpTime: "09:00", blocks: [{ ...blocks[1], start: "07:00", end: "07:20" }, blocks[0]] }, sourceMode: "demo", now });
  assert.equal(moved.wakeTime, "07:00");
  const legacy = buildAgentDaySnapshotFromDailyData({ plan: { targetDate: "2026-07-17", wakeUpTime: "07:20", blocks: [{ start: "06:00", end: "06:30" }] }, sourceMode: "demo", now });
  assert.equal(legacy.wakeTime, null);
});

test("uses each target date's own wake card and retains legacy wake-prep identity", () => {
  const today = buildAgentDaySnapshotFromDailyData({ plan: { targetDate: "2026-07-16", blocks: [{ id: "wake-prep", start: "07:30", end: "07:50", kind: "fixed" }] }, sourceMode: "demo", now });
  const tomorrow = buildAgentDaySnapshotFromDailyData({ plan: { targetDate: "2026-07-17", blocks: [{ id: "wake-prep", start: "07:00", end: "07:20", kind: "fixed" }] }, sourceMode: "demo", now });
  assert.equal(today.wakeTime, "07:30");
  assert.equal(tomorrow.wakeTime, "07:00");
});

test("resolves categorized timeline blocks from the taxonomy for the timeline, current block, and next task", () => {
  const classificationTaxonomy = [
    { id: "study", children: [{ id: "math", children: [{ id: "study.math.calculus" }] }, { id: "english" }, { id: "professional" }, { id: "japanese" }] },
    { id: "life", children: [{ id: "personal" }] },
    { id: "rest", children: [{ id: "entertainment" }] },
    { id: "exercise", children: [{ id: "exercise" }] },
    { id: "reading", children: [{ id: "reading" }] },
    { id: "work", children: [{ id: "work" }] },
  ];
  const blocks = [
    { id: "math", title: "Math", categoryId: "study.math.calculus", start: "09:30", end: "10:00", kind: "task" },
    { id: "english", title: "English", categoryId: "english", start: "10:00", end: "10:30", kind: "task" },
    { id: "professional", title: "Professional", categoryId: "professional", start: "10:30", end: "11:00", kind: "task" },
    { id: "reading", title: "Reading", categoryId: "reading", start: "11:00", end: "11:30", kind: "task" },
    { id: "exercise", title: "Exercise", categoryId: "exercise", start: "11:30", end: "12:00", kind: "task" },
    { id: "life", title: "Life", categoryId: "personal", start: "12:00", end: "12:30", kind: "fixed" },
    { id: "entertainment", title: "Entertainment", categoryId: "entertainment", start: "12:30", end: "13:00", kind: "task" },
    { id: "work", title: "Work", categoryId: "work", start: "13:00", end: "13:30", kind: "task" },
  ];
  const result = buildAgentDaySnapshot({ date: "2026-07-16", timeline: blocks, classificationTaxonomy, now: new Date("2026-07-16T02:05:00.000Z") });
  assert.deepEqual(Object.fromEntries(result.timeline.map((block) => [block.id, block.statGroup])), {
    math: "study", english: "study", professional: "study", reading: "reading", exercise: "exercise", life: "life", entertainment: "entertainment", work: "work",
  });
  assert.equal(result.currentByClock.id, "english");
  assert.equal(result.currentByClock.statGroup, "study");
  assert.equal(result.nextTask.id, "professional");
  assert.equal(result.nextTask.statGroup, "study");
});

test("keeps explicit stat groups and leaves genuinely uncategorized legacy blocks compatible", () => {
  const result = buildAgentDaySnapshotFromDailyData({
    plan: {
      targetDate: "2026-07-17",
      blocks: [
        { id: "override", title: "Override", categoryId: "math", categoryStatGroup: "work", start: "09:00", end: "09:30", kind: "task" },
        { id: "explicit", title: "Explicit", categoryId: "personal", statGroup: "exercise", start: "09:30", end: "10:00", kind: "task" },
        { id: "legacy", title: "Legacy", start: "10:00", end: "10:30", kind: "task" },
      ],
    },
    classificationTaxonomy: [{ id: "study", children: [{ id: "math" }] }],
    sourceMode: "demo",
    now,
  });
  assert.equal(result.timeline.find((block) => block.id === "override").statGroup, "work");
  assert.equal(result.timeline.find((block) => block.id === "explicit").statGroup, "exercise");
  assert.equal("statGroup" in result.timeline.find((block) => block.id === "legacy"), false);
});
