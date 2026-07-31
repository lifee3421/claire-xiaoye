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
import { createTrackerSticker, completeStickerInstance } from "./plannerStickers.js";

// A generic interval tracker fixture (NOT hardcoded to any one real
// person/relationship — the point of rule 8 is the logic must work for
// whatever tracker config is supplied).
function intervalTracker(overrides = {}) {
  return {
    id: "tracker-a",
    title: "示例追踪项",
    schedule: { kind: "interval", every: 7, unit: "day" },
    stickerSettings: { enabled: true, emoji: "🔔", title: "该做啦", time: "09:00", type: "reminder" },
    ...overrides,
  };
}

function periodActiveDaysTracker(overrides = {}) {
  return {
    id: "tracker-b",
    title: "示例周期追踪项",
    schedule: { kind: "period", period: "week" },
    goal: { aggregation: "active_days", target: 4, unit: "days" },
    stickerSettings: { enabled: true, emoji: "🏃", title: "该做啦", time: "18:00", type: "reminder" },
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
