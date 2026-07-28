// Integration coverage for the full card-level reminder chain:
//   todaySegmentOverrides -> flattenPlannerTasks -> buildScheduledTaskBlockFromSegment
//   -> buildAgentDaySnapshotFromDailyData -> buildReminderPlan
// This is the exact path that silently dropped a non-stage-first study
// card's explicit reminder/desk-verification override: flattenPlannerTasks
// already resolved the right value (segment override > task default >
// inherit), but the block builder that turns a placed segment into a
// timeline block never copied snowdustReminder/deskVerification onto it, so
// only the stage-default-first-card reminders (computed independently
// inside buildReminderPlan) ever showed up downstream.
//
// Deliberately does NOT stop at unit-testing buildTimelineSegmentEditPatch —
// every test here goes all the way from a saved segment override through
// the real snapshot and reminder-plan builders.
import assert from "node:assert/strict";
import test from "node:test";
import { applyTimelineSegmentEdit, buildTimelineCardEditForm, buildTimelineSegmentEditPatch } from "../utils/timelineCardEdit.js";
import { buildScheduledTaskBlockFromSegment, flattenPlannerTasks } from "../utils/plannerTimelineBlocks.js";
import { buildAgentDaySnapshotFromDailyData } from "./buildAgentDaySnapshot.js";
import { buildReminderPlan } from "./buildReminderPlan.js";

function morningStudyGroup(id, manualStart, segmentOverrides) {
  return {
    id,
    title: `晨间学习 ${id}`,
    categoryId: "study.math",
    category: "数学",
    categoryStatGroup: "study",
    segments: [50],
    breakMinutes: 10,
    priority: 2,
    preferredPeriods: ["morning"],
    manualStart,
    locked: true,
    segmentOverrides,
  };
}

/**
 * Mirrors exactly what buildAutoSchedulePlan's pinnedSegments.forEach(...)
 * does for locked/manualStart segments (App.jsx) — using the same
 * flattenPlannerTasks + buildScheduledTaskBlockFromSegment functions the
 * real scheduler calls, just without also re-implementing the free-slot
 * packing algorithm for movable/unpinned segments, which is unrelated to
 * this bug.
 */
function buildBlocksFromDraft(taskGroups) {
  return flattenPlannerTasks(taskGroups, [])
    .filter((segment) => segment.placement === "timeline")
    .map((segment) => buildScheduledTaskBlockFromSegment(segment, { start: Number(segment.manualStart) }));
}

function reminderPlanFor(taskGroups, { deskVerification = {} } = {}) {
  const blocks = buildBlocksFromDraft(taskGroups);
  const snapshot = buildAgentDaySnapshotFromDailyData({ plan: { targetDate: "2026-07-25", blocks }, sourceMode: "demo", now: new Date("2026-07-25T01:00:00.000Z") });
  return buildReminderPlan({ localDate: "2026-07-25", cards: snapshot.timeline, deskVerification });
}

test("A. three morning study cards, only the middle one with an explicit segment-override reminder — exactly 2 reminders: the first card's stage default plus the middle card's explicit one", () => {
  const overrides = { "b-1": { snowdustReminder: { mode: "on", advanceMinutes: 7 } } };
  const groups = [
    morningStudyGroup("a", 9 * 60, overrides),
    morningStudyGroup("b", 10 * 60, overrides),
    morningStudyGroup("c", 11 * 60, overrides),
  ];
  const plan = reminderPlanFor(groups);
  assert.equal(plan.reminders.length, 2);
  const byCard = Object.fromEntries(plan.reminders.map((item) => [item.sourceCardId, item]));
  assert.ok(byCard["a-1"], "first card keeps its stage-default reminder");
  assert.equal(byCard["a-1"].advanceMinutes, 5);
  assert.ok(byCard["b-1"], "the non-stage-first card's explicit reminder must appear in the plan");
  assert.equal(byCard["b-1"].advanceMinutes, 7);
  assert.equal(byCard["c-1"], undefined);
});

test("B. the stage-first card explicitly turns its default reminder off — no reminder is generated for it", () => {
  const overrides = { "a-1": { snowdustReminder: { mode: "off" } } };
  const groups = [morningStudyGroup("a", 9 * 60, overrides), morningStudyGroup("b", 10 * 60, overrides)];
  const plan = reminderPlanFor(groups);
  assert.equal(plan.reminders.find((item) => item.sourceCardId === "a-1"), undefined);
});

test("C. a non-stage-first card turns desk verification on — its reminder carries studyStartVerification.required === true even though it is not the stage's first card", () => {
  const overrides = { "b-1": { deskVerification: { mode: "on" } } };
  const groups = [morningStudyGroup("a", 9 * 60, overrides), morningStudyGroup("b", 10 * 60, overrides)];
  const plan = reminderPlanFor(groups, { deskVerification: { morning: { enabled: false } } });
  const middle = plan.reminders.find((item) => item.sourceCardId === "b-1");
  assert.ok(middle, "desk verification must produce a reminder even though the ordinary reminder is inherited");
  assert.equal(middle.studyStartVerification.required, true);
  const firstCard = plan.cards.find((card) => card.id === "b-1");
  assert.equal(firstCard.isFirstStudyCardOfStage, false);
});

test("D. saving a segment override and reopening the same block shows the explicit on/off choice, never falls back to inherit", () => {
  const task = { id: "a", title: "晨间学习", categoryId: "study.math", segments: [50], breakMinutes: 10, priority: 2, preferredPeriods: ["morning"] };
  const block = { id: "a-1", studyMinutes: 50, breakMinutes: 10, priority: 2, preferredPeriods: ["morning"] };
  const initial = buildTimelineCardEditForm({ task, block });
  const form = { ...initial, snowdustReminderMode: "on", snowdustAdvanceMinutes: 4, deskVerificationMode: "on" };
  const draft = applyTimelineSegmentEdit({ todaySegmentOverrides: {} }, block.id, buildTimelineSegmentEditPatch({ initialForm: initial, form, segmentOverride: {} }));

  const reopened = buildTimelineCardEditForm({ task, block, segmentOverride: draft.todaySegmentOverrides[block.id] });
  assert.equal(reopened.snowdustReminderMode, "on");
  assert.equal(reopened.snowdustAdvanceMinutes, 4);
  assert.equal(reopened.deskVerificationMode, "on");

  // And the saved override must actually reach the reminder plan, not just the reopened form.
  const groups = [morningStudyGroup("a", 9 * 60, draft.todaySegmentOverrides)];
  const plan = reminderPlanFor(groups);
  const reminder = plan.reminders.find((item) => item.sourceCardId === "a-1");
  assert.ok(reminder);
  assert.equal(reminder.advanceMinutes, 4);
  assert.equal(reminder.studyStartVerification.required, true);
});
