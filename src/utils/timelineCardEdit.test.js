import assert from "node:assert/strict";
import test from "node:test";
import { applyTimelineSegmentEdit, buildTimelineCardEditForm, buildTimelineSegmentEditPatch } from "./timelineCardEdit.js";

const task = {
  id: "math",
  title: "Math group",
  categoryId: "study.math",
  segments: [50, 50],
  breakMinutes: 10,
  priority: 2,
  preferredPeriods: ["afternoon"],
  snowdustReminder: { mode: "on", advanceMinutes: 5 },
  deskVerification: { mode: "off" },
};
const block = { id: "math-1", studyMinutes: 50, breakMinutes: 10, priority: 2, preferredPeriods: ["afternoon"] };

function save(draft, form, initial, categoryPatch = {}) {
  return applyTimelineSegmentEdit(draft, block.id, buildTimelineSegmentEditPatch({ initialForm: initial, form, segmentOverride: draft.todaySegmentOverrides?.[block.id] || {}, categoryPatch }));
}

test("current-card interaction persists title and SnowDust choices, then reopens with the saved values", () => {
  const draft = { todaySegmentOverrides: {} };
  const initial = buildTimelineCardEditForm({ task, block });
  const form = { ...initial, title: "Math desk", snowdustReminderMode: "off", snowdustAdvanceMinutes: 12, deskVerificationMode: "on" };
  const saved = save(draft, form, initial);
  assert.deepEqual(saved.todaySegmentOverrides[block.id], {
    title: "Math desk", snowdustReminder: { mode: "off", advanceMinutes: 12 }, deskVerification: { mode: "on" },
  });
  const reopened = buildTimelineCardEditForm({ task, block, segmentOverride: saved.todaySegmentOverrides[block.id] });
  assert.equal(reopened.title, "Math desk");
  assert.equal(reopened.snowdustReminderMode, "off");
  assert.equal(reopened.snowdustAdvanceMinutes, 12);
  assert.equal(reopened.deskVerificationMode, "on");
});

test("saved card state survives a persistence reload and remains isolated from sibling segments", () => {
  const initial = buildTimelineCardEditForm({ task, block });
  const saved = save({ todaySegmentOverrides: {} }, { ...initial, title: "Only first", priority: 1 }, initial);
  const reloaded = JSON.parse(JSON.stringify(saved));
  assert.equal(buildTimelineCardEditForm({ task, block, segmentOverride: reloaded.todaySegmentOverrides["math-1"] }).title, "Only first");
  assert.equal(buildTimelineCardEditForm({ task, block: { ...block, id: "math-2" }, segmentOverride: reloaded.todaySegmentOverrides["math-2"] }).title, "Math group");
  assert.equal(reloaded.todaySegmentOverrides["math-2"], undefined);
});

test("current-card editing writes every timeline field without touching the sibling", () => {
  const initial = buildTimelineCardEditForm({ task, block });
  const categoryPatch = { categoryId: "study.english", category: "English", categoryStatGroup: "study" };
  const saved = save({ todaySegmentOverrides: {} }, {
    ...initial,
    title: "English only",
    workMinutes: 35,
    breakMinutes: 15,
    locked: true,
    priority: 1,
    preferredPeriod: "morning",
    categoryId: "study.english",
  }, initial, categoryPatch);
  assert.deepEqual(saved.todaySegmentOverrides[block.id], {
    title: "English only",
    workMinutes: 35,
    restMinutes: 15,
    locked: true,
    priority: 1,
    preferredPeriods: ["morning"],
    ...categoryPatch,
  });
  assert.equal(saved.todaySegmentOverrides["math-2"], undefined);
});

test("choosing inherit removes old explicit reminder and desk overrides instead of storing null", () => {
  const draft = { todaySegmentOverrides: { "math-1": { snowdustReminder: { mode: "off", advanceMinutes: 9 }, deskVerification: { mode: "on" } } } };
  const initial = buildTimelineCardEditForm({ task, block, segmentOverride: draft.todaySegmentOverrides[block.id] });
  const saved = save(draft, { ...initial, snowdustReminderMode: "inherit", deskVerificationMode: "inherit" }, initial);
  assert.equal("snowdustReminder" in saved.todaySegmentOverrides[block.id], false);
  assert.equal("deskVerification" in saved.todaySegmentOverrides[block.id], false);
  const reopened = buildTimelineCardEditForm({ task, block, segmentOverride: saved.todaySegmentOverrides[block.id] });
  assert.equal(reopened.snowdustReminderMode, "inherit");
  assert.equal(reopened.snowdustAdvanceMinutes, 5);
  assert.equal(reopened.deskVerificationMode, "inherit");
});

test("smart start verification stores no kind, while explicit photo choices keep their kind", () => {
  const initial = buildTimelineCardEditForm({ task, block, segmentOverride: { startVerification: { mode: "on", method: "smart", kind: "study_ready" } } });
  assert.equal(initial.startVerificationMethod, "smart");
  assert.equal(initial.startVerificationKind, "", "legacy smart kind is not retained in the editing form");
  const smartPatch = buildTimelineSegmentEditPatch({ initialForm: { ...initial, startVerificationMode: "inherit" }, form: initial, segmentOverride: {} });
  assert.deepEqual(smartPatch.patch.startVerification, { mode: "on", method: "smart" });
  const photoForm = { ...initial, startVerificationMethod: "photo", startVerificationKind: "exercise_ready" };
  const photoPatch = buildTimelineSegmentEditPatch({ initialForm: { ...initial, startVerificationMode: "inherit" }, form: photoForm, segmentOverride: {} });
  assert.deepEqual(photoPatch.patch.startVerification, { mode: "on", method: "photo", kind: "exercise_ready" });
});

test("a task-group change is inherited by untouched segments but not by an explicit segment override", () => {
  const groupAfterEdit = { ...task, snowdustReminder: { mode: "off", advanceMinutes: 20 }, deskVerification: { mode: "on" } };
  const explicit = { snowdustReminder: { mode: "on", advanceMinutes: 2 }, deskVerification: { mode: "off" } };
  const inherited = buildTimelineCardEditForm({ task: groupAfterEdit, block, segmentOverride: {} });
  const overridden = buildTimelineCardEditForm({ task: groupAfterEdit, block, segmentOverride: explicit });
  assert.equal(inherited.snowdustReminderMode, "inherit");
  assert.equal(inherited.snowdustAdvanceMinutes, 20);
  assert.equal(overridden.snowdustReminderMode, "on");
  assert.equal(overridden.snowdustAdvanceMinutes, 2);
  assert.equal(overridden.deskVerificationMode, "off");
});
