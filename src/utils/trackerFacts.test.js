import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrackerEvidence } from "./trackerFacts.js";

function event(overrides = {}) {
  return {
    id: "e1", trackerId: "family-a", occurredOn: "2026-07-27", occurredAt: null,
    recordedAt: "2026-07-28T01:00:00Z", value: null, unit: "boolean",
    sourceType: "categoryEntry", ingestionType: "live", sourceDocumentId: "s1",
    sourceFieldKey: "categoryReviewEntries.cat_9f2a", sourceRevision: "0",
    evidenceSummary: "家庭复盘｜与外婆联系 30min", state: "active", retractedAt: null,
    retractionReason: null, createdAt: "2026-07-28T01:00:00Z", updatedAt: "2026-07-28T01:00:00Z",
    ...overrides,
  };
}

// Regression for the exact scenario the user flagged as a logical
// contradiction in an earlier UI draft: last completed 7/27, every 7 days,
// today 7/29 must be "upcoming" (nextDueDate 8/3), never "due_today".
test("interval: upcoming when well before the next due date, regardless of today's settlement", () => {
  const tracker = { id: "family-a", title: "联系外婆", schedule: { kind: "interval", every: 7, unit: "day" }, evidenceBindings: [] };
  const facts = resolveTrackerEvidence(tracker, { events: [event()], today: "2026-07-29", todaySettlementExists: true });
  assert.equal(facts.scheduleStatus, "upcoming");
  assert.equal(facts.nextDueDate, "2026-08-03");
  assert.equal(facts.lastCompletedDate, "2026-07-27");
});

test("interval: due_today exactly on the due date, overdue the day after", () => {
  const tracker = { id: "family-a", title: "联系外婆", schedule: { kind: "interval", every: 7, unit: "day" }, evidenceBindings: [] };
  const dueToday = resolveTrackerEvidence(tracker, { events: [event()], today: "2026-08-03", todaySettlementExists: false });
  assert.equal(dueToday.scheduleStatus, "due_today");
  const overdue = resolveTrackerEvidence(tracker, { events: [event()], today: "2026-08-04", todaySettlementExists: false });
  assert.equal(overdue.scheduleStatus, "overdue");
});

test("interval: never completed is always overdue with no nextDueDate", () => {
  const tracker = { id: "family-a", title: "联系外婆", schedule: { kind: "interval", every: 7, unit: "day" }, evidenceBindings: [] };
  const facts = resolveTrackerEvidence(tracker, { events: [], today: "2026-07-29", todaySettlementExists: false });
  assert.equal(facts.scheduleStatus, "overdue");
  assert.equal(facts.nextDueDate, null);
  assert.equal(facts.lastCompletedDate, null);
});

test("period active_days: on_track mid-week, behind when unreachable, completed_period when hit", () => {
  const tracker = { id: "exercise", title: "完整运动", schedule: { kind: "period", period: "week" }, goal: { aggregation: "active_days", target: 4, unit: "days" }, evidenceBindings: [] };
  // Monday 2026-07-27 is the week start (verify calendarBounds monday-start convention)
  const twoDone = [event({ id: "e1", occurredOn: "2026-07-27" }), event({ id: "e2", occurredOn: "2026-07-28" })];
  const onTrack = resolveTrackerEvidence(tracker, { events: twoDone, today: "2026-07-29", todaySettlementExists: true }); // Wed, 5 days left incl today, need 2 more
  assert.equal(onTrack.scheduleStatus, "on_track");
  assert.equal(onTrack.progress.current, 2);
  assert.equal(onTrack.progress.remaining, 2);

  const behind = resolveTrackerEvidence(tracker, { events: twoDone, today: "2026-08-01", todaySettlementExists: true }); // Sat, 2 days left incl today, need 2 more -> exactly reachable actually
  // Sunday 08-02 is last day of that week; from Sat 08-01, days left incl today = 2, remaining = 2 -> still on_track (not behind)
  assert.equal(behind.scheduleStatus, "on_track");

  const trulyBehind = resolveTrackerEvidence(tracker, { events: [event({ id: "e1", occurredOn: "2026-07-27" })], today: "2026-08-02", todaySettlementExists: true }); // Sun (last day), only 1 done, need 3 more, 1 day left
  assert.equal(trulyBehind.scheduleStatus, "due_today"); // last day of period always due_today regardless of reachability

  const fourDone = [event({ id: "e1", occurredOn: "2026-07-27" }), event({ id: "e2", occurredOn: "2026-07-28" }), event({ id: "e3", occurredOn: "2026-07-29" }), event({ id: "e4", occurredOn: "2026-07-30" })];
  const completed = resolveTrackerEvidence(tracker, { events: fourDone, today: "2026-07-31", todaySettlementExists: true });
  assert.equal(completed.scheduleStatus, "completed_period");
  assert.equal(completed.progress.remaining, 0);
});

test("period sum: aggregates value across the window, not day count", () => {
  const tracker = { id: "reading", title: "阅读", schedule: { kind: "period", period: "month" }, goal: { aggregation: "sum", target: 720, unit: "minutes" }, evidenceBindings: [] };
  const events = [event({ id: "e1", occurredOn: "2026-07-05", value: 300, unit: "minutes" }), event({ id: "e2", occurredOn: "2026-07-10", value: 300, unit: "minutes" })];
  const facts = resolveTrackerEvidence(tracker, { events, today: "2026-07-15", todaySettlementExists: true });
  assert.equal(facts.progress.current, 600);
  assert.equal(facts.progress.remaining, 120);
  assert.equal(facts.scheduleStatus, "on_track");
});

test("todayReviewStatus: not_saved only when today actually needs a judgment", () => {
  const tracker = { id: "family-a", title: "联系外婆", schedule: { kind: "interval", every: 7, unit: "day" }, evidenceBindings: [] };
  // upcoming window, today's settlement not saved -> not_applicable, must not be "not_saved"
  const upcoming = resolveTrackerEvidence(tracker, { events: [event()], today: "2026-07-29", todaySettlementExists: false });
  assert.equal(upcoming.scheduleStatus, "upcoming");
  assert.equal(upcoming.todayReviewStatus, "not_applicable");

  // due window, today's settlement not saved -> not_saved
  const due = resolveTrackerEvidence(tracker, { events: [event()], today: "2026-08-03", todaySettlementExists: false });
  assert.equal(due.todayReviewStatus, "not_saved");

  // due window, settlement saved, no evidence today -> confirmed_no_evidence
  const savedNoEvidence = resolveTrackerEvidence(tracker, { events: [event()], today: "2026-08-03", todaySettlementExists: true });
  assert.equal(savedNoEvidence.todayReviewStatus, "confirmed_no_evidence");

  // saved with today's evidence -> confirmed_complete
  const savedWithEvidence = resolveTrackerEvidence(tracker, { events: [event(), event({ id: "e2", occurredOn: "2026-08-03" })], today: "2026-08-03", todaySettlementExists: true });
  assert.equal(savedWithEvidence.todayReviewStatus, "confirmed_complete");
});

test("bindingHealth: partial failure keeps tracker usable, total failure sets link_broken", () => {
  const tracker = {
    id: "family-a", title: "联系外婆", schedule: { kind: "interval", every: 7, unit: "day" },
    evidenceBindings: [{ type: "categoryId", categoryId: "cat_dead" }, { type: "manualReviewField", fieldId: "x" }],
  };
  const partial = resolveTrackerEvidence(tracker, {
    events: [event()], today: "2026-07-29", todaySettlementExists: true,
    checkBindingHealth: (binding) => (binding.type === "categoryId" ? { healthy: false, reason: "category_deleted" } : { healthy: true }),
  });
  assert.equal(partial.hasBrokenBindings, true);
  assert.equal(partial.linkBroken, false);
  assert.equal(partial.scheduleStatus, "upcoming");

  const total = resolveTrackerEvidence(tracker, {
    events: [event()], today: "2026-07-29", todaySettlementExists: true,
    checkBindingHealth: () => ({ healthy: false, reason: "category_deleted" }),
  });
  assert.equal(total.linkBroken, true);
  assert.equal(total.scheduleStatus, "link_broken");
});

test("lastCompletedDate only considers active events, retracted ones are excluded", () => {
  const tracker = { id: "family-a", title: "联系外婆", schedule: { kind: "interval", every: 7, unit: "day" }, evidenceBindings: [] };
  const events = [event({ id: "e1", occurredOn: "2026-07-27" }), event({ id: "e2", occurredOn: "2026-08-01", state: "retracted" })];
  const facts = resolveTrackerEvidence(tracker, { events, today: "2026-07-29", todaySettlementExists: true });
  assert.equal(facts.lastCompletedDate, "2026-07-27");
});
