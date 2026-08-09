import assert from "node:assert/strict";
import test from "node:test";

import { buildScheduledTaskBlockFromSegment, flattenPlannerTasks } from "../utils/plannerTimelineBlocks.js";
import { buildTemplateSnapshotContent, instantiateTemplateTaskCollections } from "../utils/plannerTemplateSnapshot.js";
import { resolveSegmentMove, resolveSegmentReturnToPool } from "./timelineRescheduleGate.js";

const categoryMetadata = {
  category: "数学",
  categoryId: "study.math",
  categoryLevel2Id: "study.math",
  categoryName: "数学",
  categoryColor: "#60A5FA",
  categoryPrimaryId: "study",
  categoryPrimaryName: "学习",
  categoryStatGroup: "study",
};

function assertCategoryMetadata(actual) {
  Object.entries(categoryMetadata).forEach(([key, value]) => {
    assert.equal(actual[key], value, `${key} should survive the planner transition`);
  });
}

test("task-pool category metadata survives flattening and placement onto timeline", () => {
  const task = {
    id: "math-custom",
    title: "高数习题",
    ...categoryMetadata,
    segments: [50],
    breakMinutes: 10,
    priority: 1,
    preferredPeriods: ["morning"],
    segmentOverrides: {
      "math-custom-1": { placement: "timeline", manualStart: 540 },
    },
  };

  const [segment] = flattenPlannerTasks([task], []);
  assertCategoryMetadata(segment);

  const block = buildScheduledTaskBlockFromSegment(segment, { start: 540 });
  assertCategoryMetadata(block);
  assert.equal(block.start, 540);
  assert.equal(block.end, 600);
});

test("reschedule and return-to-pool copies keep the full category chain", () => {
  const block = {
    id: "math-custom-1",
    title: "高数习题 50+10",
    ...categoryMetadata,
    start: 540,
    end: 600,
    studyMinutes: 50,
    breakMinutes: 10,
    priority: 1,
    preferredPeriods: ["morning"],
    locked: true,
    status: "pending",
  };

  const moved = resolveSegmentMove({
    block,
    newStart: 660,
    nowMinutes: 570,
    nowIso: "2026-08-09T01:30:00.000Z",
    idFactory: () => "generated",
  });
  assert.equal(moved.split, true);
  assertCategoryMetadata(moved.newCustomBlock);

  const returned = resolveSegmentReturnToPool({
    block,
    nowMinutes: 570,
    nowIso: "2026-08-09T01:30:00.000Z",
    idFactory: () => "generated",
  });
  assert.equal(returned.split, true);
  assertCategoryMetadata(returned.newPoolBlock);
});

test("template save and next-day instantiation retain category metadata", () => {
  const task = {
    id: "math-custom",
    title: "高数习题",
    ...categoryMetadata,
    segments: [50],
    breakMinutes: 10,
    priority: 1,
    preferredPeriods: ["morning"],
  };
  const [segment] = flattenPlannerTasks([{ ...task, segmentOverrides: {} }], []);
  const block = buildScheduledTaskBlockFromSegment(segment, { start: 540 });

  const snapshot = buildTemplateSnapshotContent({
    draft: {},
    autoSchedule: { taskGroups: [task], blocks: [block] },
    scopes: { boundaries: false, fixedEvents: false, defaultTasks: true, timeline: true },
  });

  assertCategoryMetadata(snapshot.defaultTaskGroups[0]);
  assertCategoryMetadata(snapshot.timelineSegments[0]);

  const instantiated = instantiateTemplateTaskCollections({
    defaultTaskGroups: snapshot.defaultTaskGroups,
    timelineSegments: snapshot.timelineSegments,
    includeDefaultTasks: true,
    includeTimeline: true,
    existingTaskIdBySourceId: {},
    makeId: (prefix, index) => `${prefix}-${index + 1}`,
  });

  assert.equal(instantiated.defaultTasks.length, 1);
  assertCategoryMetadata(instantiated.defaultTasks[0]);
  assert.ok(instantiated.timelineOverrides[`${instantiated.defaultTasks[0].id}-1`]);
});
