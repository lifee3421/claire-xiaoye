import test from "node:test";
import assert from "node:assert/strict";
import {
  addSuppressedGenerationKey,
  applyTrackerStickerPlan,
  applyTrackerStickerSync,
  buildStickerGenerationKey,
  findStickerByGenerationKey,
  planTrackerSticker,
  shouldRemindToday,
  suppressTrackerStickerOnDelete,
} from "./trackerStickers.js";
import { createTrackerSticker, completeStickerInstance, reopenStickerInstance, updateTrackerStickerInstance } from "./plannerStickers.js";

// A generic interval tracker fixture (NOT hardcoded to any one real
// person/relationship — the point of rule 8 is the logic must work for
// whatever tracker config is supplied).
function intervalTracker(overrides = {}) {
  return {
    id: "tracker-a",
    title: "示例追踪项",
    schedule: { kind: "interval", every: 7, unit: "day" },
    goal: { aggregation: "occurrence", target: 1, unit: "times" },
    evidenceBindings: [{ type: "manualReviewField", fieldId: "fixture" }],
    stickerSettings: { enabled: true, emoji: "🔔", title: "该做啦", placementMode: "timeline", time: "09:00", type: "reminder" },
    ...overrides,
  };
}

function periodActiveDaysTracker(overrides = {}) {
  return {
    id: "tracker-b",
    title: "示例周期追踪项",
    schedule: { kind: "period", period: "week" },
    goal: { aggregation: "active_days", target: 4, unit: "days" },
    evidenceBindings: [{ type: "manualReviewField", fieldId: "fixture" }],
    stickerSettings: { enabled: true, emoji: "🏃", title: "该做啦", placementMode: "timeline", time: "18:00", type: "reminder" },
    ...overrides,
  };
}

test("shouldRemindToday: interval trackers remind on due_today and overdue, not upcoming/on_track/completed_period/link_broken", () => {
  const tracker = intervalTracker();
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "due_today" }), true);
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "overdue" }), true);
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "upcoming" }), false);
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "completed_period" }), false);
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "link_broken" }), false);
});

test("shouldRemindToday: period/active_days trackers remind on due_today and behind, but NOT on overdue (a closed period shouldn't nag 'today')", () => {
  const tracker = periodActiveDaysTracker();
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "due_today" }), true);
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "behind" }), true);
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "overdue" }), false);
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "on_track" }), false);
});

test("planTrackerSticker: creates a reminder when due and nothing exists yet for today", () => {
  const plan = planTrackerSticker({
    tracker: intervalTracker(),
    trackerFacts: { scheduleStatus: "due_today", todayReviewStatus: "not_saved" },
    localDate: "2026-08-03",
  });
  assert.equal(plan.action, "create");
  assert.equal(plan.generationKey, buildStickerGenerationKey("tracker-a", "2026-08-03"));
  assert.equal(plan.stickerType, "reminder");
});

test("planTrackerSticker: same tracker + same day never generates twice (idempotent)", () => {
  const existingSticker = { id: "s1", status: "pending" };
  const plan = planTrackerSticker({
    tracker: intervalTracker(),
    trackerFacts: { scheduleStatus: "due_today", todayReviewStatus: "not_saved" },
    localDate: "2026-08-03",
    existingSticker,
  });
  assert.equal(plan.action, "none");
  assert.equal(plan.reason, "already_generated");
});

test("planTrackerSticker: a suppressed generationKey (manually deleted today) is not regenerated", () => {
  const key = buildStickerGenerationKey("tracker-a", "2026-08-03");
  const plan = planTrackerSticker({
    tracker: intervalTracker(),
    trackerFacts: { scheduleStatus: "due_today", todayReviewStatus: "not_saved" },
    localDate: "2026-08-03",
    suppressedGenerationKeys: [key],
  });
  assert.equal(plan.action, "none");
  assert.equal(plan.reason, "suppressed");
});

test("planTrackerSticker: disabled stickerSettings never generates, regardless of status", () => {
  const plan = planTrackerSticker({
    tracker: intervalTracker({ stickerSettings: { enabled: false } }),
    trackerFacts: { scheduleStatus: "overdue", todayReviewStatus: "not_saved" },
    localDate: "2026-08-03",
  });
  assert.equal(plan.action, "none");
  assert.equal(plan.reason, "sticker_disabled");
});

test("planTrackerSticker: confirmed_complete syncs an existing pending sticker to complete", () => {
  const existingSticker = { id: "s1", status: "pending" };
  const plan = planTrackerSticker({
    tracker: intervalTracker(),
    trackerFacts: { scheduleStatus: "due_today", todayReviewStatus: "confirmed_complete" },
    localDate: "2026-08-03",
    existingSticker,
  });
  assert.equal(plan.action, "complete");
  assert.equal(plan.stickerId, "s1");
});

test("planTrackerSticker: confirmed_complete with no existing sticker does nothing (never fabricates a completed sticker out of nowhere)", () => {
  const plan = planTrackerSticker({
    tracker: intervalTracker(),
    trackerFacts: { scheduleStatus: "due_today", todayReviewStatus: "confirmed_complete" },
    localDate: "2026-08-03",
    existingSticker: null,
  });
  assert.equal(plan.action, "none");
});

test("planTrackerSticker: confirmed_complete with an already-completed sticker is a no-op (not re-stamped)", () => {
  const plan = planTrackerSticker({
    tracker: intervalTracker(),
    trackerFacts: { scheduleStatus: "due_today", todayReviewStatus: "confirmed_complete" },
    localDate: "2026-08-03",
    existingSticker: { id: "s1", status: "completed" },
  });
  assert.equal(plan.action, "none");
});

test("shouldRemindToday: sum trackers require an explicit reminder rule and never infer daily pacing", () => {
  const tracker = periodActiveDaysTracker({ goal: { aggregation: "sum", target: 720, unit: "minutes" } });
  assert.equal(shouldRemindToday(tracker, { scheduleStatus: "due_today" }), false);
  assert.equal(shouldRemindToday({ ...tracker, stickerSettings: { ...tracker.stickerSettings, reminderRule: "due_on_period_end" } }, { scheduleStatus: "due_today" }), true);
});

test("planTrackerSticker: incomplete trackers and timeline trackers without a legal time do not generate", () => {
  const incomplete = planTrackerSticker({ tracker: intervalTracker({ evidenceBindings: [] }), trackerFacts: { scheduleStatus: "overdue" }, localDate: "2026-08-03" });
  assert.equal(incomplete.reason, "invalid_tracker_config");
  const invalidTime = planTrackerSticker({ tracker: intervalTracker({ stickerSettings: { enabled: true, placementMode: "timeline", time: "9:00" } }), trackerFacts: { scheduleStatus: "overdue" }, localDate: "2026-08-03" });
  assert.equal(invalidTime.reason, "invalid_tracker_config");
  const bar = planTrackerSticker({ tracker: intervalTracker({ stickerSettings: { enabled: true, placementMode: "sticker_bar" } }), trackerFacts: { scheduleStatus: "overdue" }, localDate: "2026-08-03" });
  assert.equal(bar.action, "create");
  assert.equal(bar.placementMode, "sticker_bar");
});

test("planTrackerSticker: a retracted completion re-opens an existing tracker reminder instead of treating its checkbox as evidence", () => {
  const tracker = intervalTracker();
  const existingSticker = {
    ...createTrackerSticker({ trackerId: tracker.id, generationKey: "tracker-a:2026-08-03", stickerType: "reminder", title: "该做啦", time: "09:00" }),
    status: "completed",
    completedAt: "2026-08-03T08:00:00.000Z",
  };
  const plan = planTrackerSticker({
    tracker,
    trackerFacts: { trackerId: tracker.id, scheduleStatus: "upcoming", todayReviewStatus: "confirmed_no_evidence" },
    localDate: "2026-08-03",
    existingSticker,
  });
  assert.equal(plan.action, "reopen");
  const result = applyTrackerStickerPlan(plan, {
    draft: { stickers: [existingSticker] },
    createSticker: createTrackerSticker,
    completeSticker: completeStickerInstance,
    reopenSticker: reopenStickerInstance,
  });
  assert.equal(result.stickers[0].status, "pending");
  assert.equal(result.stickers[0].completedAt, "");
});

test("planTrackerSticker: pending tracker instance updates title, emoji and placement in place, while suppression still blocks recreation", () => {
  const tracker = intervalTracker({ stickerSettings: { enabled: true, title: "新标题", emoji: "☎️", placementMode: "sticker_bar" } });
  const existing = createTrackerSticker({ trackerId: tracker.id, generationKey: "tracker-a:2026-08-03", title: "旧标题", emoji: "📞", placementMode: "timeline", time: "09:00" });
  const update = planTrackerSticker({ tracker, trackerFacts: { scheduleStatus: "due_today", todayReviewStatus: "not_saved" }, localDate: "2026-08-03", existingSticker: existing });
  assert.equal(update.action, "update");
  const next = applyTrackerStickerPlan(update, { draft: { stickers: [existing] }, createSticker: createTrackerSticker, completeSticker: completeStickerInstance, updateSticker: updateTrackerStickerInstance });
  assert.equal(next.stickers.length, 1); assert.equal(next.stickers[0].id, existing.id); assert.equal(next.stickers[0].placementMode, "sticker_bar"); assert.equal(next.stickers[0].anchorMinute, null); assert.equal(next.stickers[0].title, "新标题");
  assert.equal(planTrackerSticker({ tracker, trackerFacts: { scheduleStatus: "due_today" }, localDate: "2026-08-03", suppressedGenerationKeys: ["tracker-a:2026-08-03"] }).reason, "suppressed");
});

test("planTrackerSticker: disabled tracker, requiresSetup and unsupported completion type never generate", () => {
  const facts = { scheduleStatus: "due_today", todayReviewStatus: "not_saved" };
  assert.equal(planTrackerSticker({ tracker: intervalTracker({ enabled: false }), trackerFacts: facts, localDate: "2026-08-03" }).reason, "tracker_disabled");
  assert.equal(planTrackerSticker({ tracker: intervalTracker({ requiresSetup: true }), trackerFacts: facts, localDate: "2026-08-03" }).reason, "requires_setup");
  assert.equal(planTrackerSticker({ tracker: intervalTracker({ stickerSettings: { enabled: true, type: "completion" } }), trackerFacts: facts, localDate: "2026-08-03" }).reason, "completion_not_supported");
});

test("four tracker configurations stay isolated through the same generic planner", () => {
  const today = "2026-08-03";
  const family = intervalTracker({ id: "family-a", stickerSettings: { enabled: true, title: "联系外婆", emoji: "☎️", placementMode: "timeline", time: "19:15" } });
  const mask = intervalTracker({ id: "mask", stickerSettings: { enabled: true, title: "面膜", emoji: "🧖", placementMode: "sticker_bar" } });
  const exercise = periodActiveDaysTracker({ id: "exercise-complete", stickerSettings: { enabled: true, title: "完整运动", emoji: "🏃", placementMode: "timeline", time: "18:30" } });
  const reading = periodActiveDaysTracker({ id: "reading", goal: { aggregation: "sum", target: 720, unit: "minutes" }, stickerSettings: { enabled: true, title: "阅读", emoji: "📖", placementMode: "timeline", time: "20:00" } });
  const plans = [planTrackerSticker({ tracker: family, trackerFacts: { scheduleStatus: "due_today" }, localDate: today }), planTrackerSticker({ tracker: mask, trackerFacts: { scheduleStatus: "overdue" }, localDate: today }), planTrackerSticker({ tracker: exercise, trackerFacts: { scheduleStatus: "behind" }, localDate: today }), planTrackerSticker({ tracker: reading, trackerFacts: { scheduleStatus: "due_today" }, localDate: today })];
  assert.deepEqual(plans.map((plan) => plan.action), ["create", "create", "create", "none"]);
  assert.equal(plans[0].time, "19:15"); assert.equal(plans[1].placementMode, "sticker_bar"); assert.equal(plans[2].time, "18:30"); assert.equal(plans[3].reason, "not_due");
});

// --- applyTrackerStickerPlan (draft-level, injected sticker constructors) --

test("applyTrackerStickerPlan: 'create' appends a real tracker sticker built via the injected createSticker", () => {
  const plan = { action: "create", trackerId: "tracker-a", generationKey: "tracker-a:2026-08-03", stickerType: "reminder", emoji: "🔔", title: "该做啦", time: "09:00" };
  const draft = { stickers: [] };
  const next = applyTrackerStickerPlan(plan, { draft, createSticker: createTrackerSticker, completeSticker: completeStickerInstance });
  assert.equal(next.stickers.length, 1);
  assert.equal(next.stickers[0].generationKey, "tracker-a:2026-08-03");
  assert.equal(next.stickers[0].origin, "tracker");
  assert.notEqual(next, draft); // pure — original draft untouched
  assert.deepEqual(draft.stickers, []);
});

test("applyTrackerStickerPlan: 'complete' marks the existing sticker completed via the injected completeSticker", () => {
  const plan = { action: "complete", stickerId: "s1" };
  const draft = { stickers: [{ id: "s1", status: "pending" }, { id: "s2", status: "pending" }] };
  const next = applyTrackerStickerPlan(plan, { draft, createSticker: createTrackerSticker, completeSticker: completeStickerInstance });
  assert.equal(next.stickers[0].status, "completed");
  assert.equal(next.stickers[1].status, "pending");
});

test("applyTrackerStickerPlan: 'none' returns the draft unchanged", () => {
  const draft = { stickers: [{ id: "s1" }] };
  const next = applyTrackerStickerPlan({ action: "none", reason: "not_due" }, { draft, createSticker: createTrackerSticker, completeSticker: completeStickerInstance });
  assert.equal(next, draft);
});

// --- suppression on manual delete + next-day recovery ----------------------

test("suppressTrackerStickerOnDelete: records the generationKey for a tracker-origin sticker, ignores manual stickers", () => {
  const draft = { suppressedStickerGenerationKeys: [] };
  const trackerSticker = { id: "s1", origin: "tracker", generationKey: "tracker-a:2026-08-03" };
  const next = suppressTrackerStickerOnDelete(draft, trackerSticker, "2026-08-03");
  assert.deepEqual(next.suppressedStickerGenerationKeys, ["tracker-a:2026-08-03"]);

  const manualSticker = { id: "s2", origin: "manual" };
  const untouched = suppressTrackerStickerOnDelete(draft, manualSticker, "2026-08-03");
  assert.equal(untouched, draft); // manual delete never touches suppression state
});

test("addSuppressedGenerationKey: prior-day suppressions are pruned automatically — next-day recovery falls out of this for free", () => {
  const yesterdayKeys = ["tracker-a:2026-08-02", "tracker-b:2026-08-02"];
  const todayKeys = addSuppressedGenerationKey(yesterdayKeys, "tracker-a:2026-08-03", "2026-08-03");
  assert.deepEqual(todayKeys, ["tracker-a:2026-08-03"]); // yesterday's entries dropped, only today's kept
});

test("end-to-end: delete today's reminder sticker -> suppressed -> not regenerated same day -> different day recovers", () => {
  const tracker = intervalTracker();
  const trackerFacts = { scheduleStatus: "due_today", todayReviewStatus: "not_saved" };

  // Day 1: generate.
  const createPlan = planTrackerSticker({ tracker, trackerFacts, localDate: "2026-08-03" });
  let draft = applyTrackerStickerPlan(createPlan, { draft: { stickers: [] }, createSticker: createTrackerSticker, completeSticker: completeStickerInstance });
  assert.equal(draft.stickers.length, 1);

  // User deletes it -> suppress + remove.
  const deleted = draft.stickers[0];
  draft = suppressTrackerStickerOnDelete({ ...draft, stickers: [] }, deleted, "2026-08-03");
  assert.deepEqual(draft.suppressedStickerGenerationKeys, ["tracker-a:2026-08-03"]);

  // Same day: still due_today, must NOT regenerate.
  const existing = findStickerByGenerationKey(draft.stickers, buildStickerGenerationKey("tracker-a", "2026-08-03"));
  const replanSameDay = planTrackerSticker({ tracker, trackerFacts, localDate: "2026-08-03", existingSticker: existing, suppressedGenerationKeys: draft.suppressedStickerGenerationKeys });
  assert.equal(replanSameDay.action, "none");
  assert.equal(replanSameDay.reason, "suppressed");

  // Next day: a fresh generationKey, suppression list pruned to nothing relevant -> can generate again.
  const replanNextDay = planTrackerSticker({ tracker, trackerFacts: { scheduleStatus: "overdue", todayReviewStatus: "not_saved" }, localDate: "2026-08-04", existingSticker: null, suppressedGenerationKeys: draft.suppressedStickerGenerationKeys });
  assert.equal(replanNextDay.action, "create");
});

// --- applyTrackerStickerSync (the higher-level, dependency-injected step
// that used to be a closure-based function living directly inside App.jsx,
// where it crossed into a DIFFERENT React component's (ScheduleAssistant)
// scope for `draft`/`commitDraftChange` and threw a real production
// "ReferenceError: commitDraftChange is not defined") -------------------

function makeCommitDraftChangeSpy(initialDraft) {
  const calls = [];
  let current = initialDraft;
  const commitDraftChange = (change, label) => {
    calls.push({ change, label });
    current = typeof change === "function" ? change(current) : { ...current, ...change };
  };
  return { commitDraftChange, calls, getDraft: () => current };
}

test("applyTrackerStickerSync: a due_today tracker calls commitDraftChange exactly once and the resulting payload contains the new sticker", () => {
  const tracker = intervalTracker();
  const trackerFacts = { trackerId: "tracker-a", scheduleStatus: "due_today", todayReviewStatus: "not_saved" };
  const initialDraft = { targetDate: "2026-08-03", stickers: [], suppressedStickerGenerationKeys: [] };
  const spy = makeCommitDraftChangeSpy(initialDraft);

  applyTrackerStickerSync({
    trackerFactsList: [trackerFacts],
    reviewDate: "2026-08-03",
    draft: initialDraft,
    commitDraftChange: spy.commitDraftChange,
    trackers: [tracker],
    createSticker: createTrackerSticker,
    completeSticker: completeStickerInstance,
  });

  assert.equal(spy.calls.length, 1);
  const resultDraft = spy.getDraft();
  assert.equal(resultDraft.stickers.length, 1);
  assert.equal(resultDraft.stickers[0].generationKey, "tracker-a:2026-08-03");
  assert.equal(resultDraft.stickers[0].origin, "tracker");
});

test("applyTrackerStickerSync: pre-existing stickers and suppressedStickerGenerationKeys are preserved, not overwritten", () => {
  const tracker = intervalTracker();
  const trackerFacts = { trackerId: "tracker-a", scheduleStatus: "due_today", todayReviewStatus: "not_saved" };
  const unrelatedSticker = { id: "manual-1", origin: "manual", generationKey: "" };
  const initialDraft = {
    targetDate: "2026-08-03",
    stickers: [unrelatedSticker],
    suppressedStickerGenerationKeys: ["other-tracker:2026-08-03"],
  };
  const spy = makeCommitDraftChangeSpy(initialDraft);

  applyTrackerStickerSync({
    trackerFactsList: [trackerFacts],
    reviewDate: "2026-08-03",
    draft: initialDraft,
    commitDraftChange: spy.commitDraftChange,
    trackers: [tracker],
    createSticker: createTrackerSticker,
    completeSticker: completeStickerInstance,
  });

  const resultDraft = spy.getDraft();
  assert.equal(resultDraft.stickers.length, 2); // the pre-existing manual sticker is still there
  assert.ok(resultDraft.stickers.some((sticker) => sticker.id === "manual-1"));
  assert.deepEqual(resultDraft.suppressedStickerGenerationKeys, ["other-tracker:2026-08-03"]); // untouched
});

test("applyTrackerStickerSync: throws a clear, named Error (not a raw ReferenceError) when commitDraftChange is missing or not a function", () => {
  const tracker = intervalTracker();
  const trackerFacts = { trackerId: "tracker-a", scheduleStatus: "due_today", todayReviewStatus: "not_saved" };
  const initialDraft = { targetDate: "2026-08-03", stickers: [] };

  assert.throws(
    () => applyTrackerStickerSync({ trackerFactsList: [trackerFacts], reviewDate: "2026-08-03", draft: initialDraft, commitDraftChange: undefined, trackers: [tracker], createSticker: createTrackerSticker, completeSticker: completeStickerInstance }),
    /commitDraftChange dependency is missing or not a function/,
  );
  assert.throws(
    () => applyTrackerStickerSync({ trackerFactsList: [trackerFacts], reviewDate: "2026-08-03", draft: initialDraft, commitDraftChange: "not a function", trackers: [tracker], createSticker: createTrackerSticker, completeSticker: completeStickerInstance }),
    /commitDraftChange dependency is missing or not a function/,
  );
});

test("applyTrackerStickerSync: no-op (never calls commitDraftChange) when the open draft is for a different day", () => {
  const tracker = intervalTracker();
  const trackerFacts = { trackerId: "tracker-a", scheduleStatus: "due_today", todayReviewStatus: "not_saved" };
  const initialDraft = { targetDate: "2026-08-02", stickers: [] }; // a different day than reviewDate below
  const spy = makeCommitDraftChangeSpy(initialDraft);

  applyTrackerStickerSync({
    trackerFactsList: [trackerFacts],
    reviewDate: "2026-08-03",
    draft: initialDraft,
    commitDraftChange: spy.commitDraftChange,
    trackers: [tracker],
    createSticker: createTrackerSticker,
    completeSticker: completeStickerInstance,
  });

  assert.equal(spy.calls.length, 0);
});

test("applyTrackerStickerSync: no-op (never calls commitDraftChange) when the tracker is not due today", () => {
  const tracker = intervalTracker();
  const trackerFacts = { trackerId: "tracker-a", scheduleStatus: "not_today", todayReviewStatus: "not_saved" };
  const initialDraft = { targetDate: "2026-08-03", stickers: [], suppressedStickerGenerationKeys: [] };
  const spy = makeCommitDraftChangeSpy(initialDraft);

  applyTrackerStickerSync({
    trackerFactsList: [trackerFacts],
    reviewDate: "2026-08-03",
    draft: initialDraft,
    commitDraftChange: spy.commitDraftChange,
    trackers: [tracker],
    createSticker: createTrackerSticker,
    completeSticker: completeStickerInstance,
  });

  // shouldRemindToday returns false for "not_today" → planTrackerSticker
  // returns { action: "none" } → applyTrackerStickerPlan returns draft
  // unchanged → no commit needed
  assert.equal(spy.calls.length, 0);
});
