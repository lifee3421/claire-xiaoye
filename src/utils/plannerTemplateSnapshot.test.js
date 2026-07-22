import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTemplateSnapshotContent,
  defaultTemplateSaveScopes,
  instantiateTemplateTaskCollections,
  mergeTemplateSnapshotContent,
} from "./plannerTemplateSnapshot.js";

const schedule = {
  taskGroups: [{
    id: "math-task",
    title: "数学练习",
    category: "数学",
    categoryId: "math",
    segments: [50],
    breakMinutes: 10,
    priority: 1,
    preferredPeriods: ["morning"],
  }],
  blocks: [{
    id: "math-task-1",
    taskId: "math-task",
    kind: "task",
    title: "数学练习 50+10",
    category: "数学",
    categoryId: "math",
    start: 8 * 60 + 20,
    end: 9 * 60 + 20,
    studyMinutes: 50,
    breakMinutes: 10,
    segmentIndex: 1,
    priority: 1,
    preferredPeriods: ["morning"],
    locked: true,
    status: "completed",
  }],
};

test("captures the current rendered schedule, including completed cards and stable category IDs", () => {
  const draft = { wakeUpTime: "07:30", targetBedTime: "23:20", scene: "home", fixedEvents: [{ id: "lunch" }] };
  const content = buildTemplateSnapshotContent({ draft, autoSchedule: schedule, scopes: defaultTemplateSaveScopes });
  assert.equal(content.defaultTaskGroups[0].categoryId, "math");
  assert.equal(content.timelineSegments[0].categoryId, "math");
  assert.equal(content.timelineSegments[0].startMinute, 500);
  assert.equal(content.timelineSegments[0].endMinute, 560);
  assert.equal(content.timelineSegments[0].workMinutes, 50);
  assert.equal(content.timelineSegments[0].restMinutes, 10);
  assert.equal(content.timelineSegments[0].locked, true);
  assert.equal(content.timelineSegments.length, 1);
  assert.equal(schedule.blocks[0].status, "completed");
});

test("uses current changed timing and minutes without mutating the active schedule", () => {
  const changedSchedule = structuredClone(schedule);
  changedSchedule.blocks[0].start = 7 * 60;
  changedSchedule.blocks[0].end = 8 * 60 + 25;
  changedSchedule.blocks[0].studyMinutes = 70;
  changedSchedule.blocks[0].breakMinutes = 15;
  const content = buildTemplateSnapshotContent({ draft: {}, autoSchedule: changedSchedule, scopes: defaultTemplateSaveScopes });
  assert.deepEqual(content.timelineSegments[0], {
    templateItemId: "template-line-1",
    sourceTaskId: "math-task",
    sourceSegmentIndex: 1,
    title: "数学练习 50+10",
    category: "数学",
    categoryId: "math",
    startMinute: 420,
    endMinute: 505,
    workMinutes: 70,
    restMinutes: 15,
    priority: 1,
    preferredPeriods: ["morning"],
    locked: true,
  });
  assert.equal(changedSchedule.blocks[0].start, 420);
});

test("preserves unchecked template sections and replaces checked sections", () => {
  const previous = { scene: "school", fixedEvents: [{ id: "old-fixed" }], defaultTaskGroups: [{ title: "old task" }], timelineSegments: [{ title: "old line" }] };
  const next = { scene: "home", fixedEvents: [{ id: "new-fixed" }], defaultTaskGroups: [{ title: "new task" }], timelineSegments: [{ title: "new line" }] };
  const retained = mergeTemplateSnapshotContent(previous, next, { boundaries: false, fixedEvents: false, defaultTasks: false, timeline: false });
  assert.equal(retained.scene, "school");
  assert.equal(retained.timelineSegments[0].title, "old line");
  const replaced = mergeTemplateSnapshotContent(previous, next, { boundaries: true, fixedEvents: true, defaultTasks: true, timeline: true });
  assert.equal(replaced.scene, "home");
  assert.equal(replaced.timelineSegments[0].title, "new line");
});

test("reapplies linked task-pool and timeline cards once, with pending status and category IDs", () => {
  const content = buildTemplateSnapshotContent({ draft: {}, autoSchedule: schedule, scopes: defaultTemplateSaveScopes });
  const result = instantiateTemplateTaskCollections({
    defaultTaskGroups: content.defaultTaskGroups,
    timelineSegments: content.timelineSegments,
    includeDefaultTasks: true,
    includeTimeline: true,
    makeId: (prefix, index) => `${prefix}-${index}`,
  });
  assert.equal(result.defaultTasks.length, 1);
  assert.equal(result.timelineTasks.length, 0);
  assert.equal(result.defaultTasks[0].categoryId, "math");
  assert.equal(result.defaultTasks[0].status, "pending");
  assert.deepEqual(result.timelineOverrides, {
    "template-task-0-1": { placement: "timeline", manualStart: 500, workMinutes: 50, restMinutes: 10, locked: true, status: "pending" },
  });
});

test("keeps legacy unlinked timeline cards usable without duplicating linked cards", () => {
  const result = instantiateTemplateTaskCollections({
    defaultTaskGroups: [{ sourceTaskId: "pool", title: "任务池", categoryId: "english", segments: [30] }],
    timelineSegments: [
      { sourceTaskId: "pool", sourceSegmentIndex: 1, title: "任务池", categoryId: "english", startMinute: 600, workMinutes: 30 },
      { title: "旧时间线", categoryId: "professional", startMinute: 700, workMinutes: 40 },
    ],
    includeDefaultTasks: true,
    includeTimeline: true,
    makeId: (prefix, index) => `${prefix}-${index}`,
  });
  assert.equal(result.defaultTasks.length, 1);
  assert.equal(result.timelineTasks.length, 1);
  assert.equal(result.timelineTasks[0].categoryId, "professional");
  assert.equal(result.timelineTasks[0].status, "pending");
});
