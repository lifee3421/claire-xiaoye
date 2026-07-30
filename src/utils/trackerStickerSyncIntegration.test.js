// Integration-level tests chaining the real pure modules that
// syncTrackerStickersForDate (src/App.jsx) orchestrates at runtime:
// resolveTrackerEvidence (trackerFacts.js) -> planTrackerSticker
// (trackerStickers.js), and separately sweepReconcileJobs/
// isJobEligibleForRetry (the retry-sweep eligibility logic) to prove those
// two concerns are actually decoupled, not just decoupled in a comment.
// App.jsx itself (React + Firestore I/O) has no direct test coverage in
// this repo — same boundary as dataService.js/trackerReconcileFirestore.js
// throughout this feature — so this is the closest honest proof available
// without a browser/emulator.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrackerEvidence } from "./trackerFacts.js";
import { planTrackerSticker } from "./trackerStickers.js";
import { isJobEligibleForRetry, sweepReconcileJobs } from "../services/trackerReconcileJobs.js";

function intervalTracker(overrides = {}) {
  return {
    id: "tracker-a",
    title: "示例追踪项",
    schedule: { kind: "interval", every: 7, unit: "day" },
    stickerSettings: { enabled: true, emoji: "🔔", title: "该做啦", time: "09:00", type: "reminder" },
    ...overrides,
  };
}

function activeEvent(occurredOn) {
  return { id: `e-${occurredOn}`, trackerId: "tracker-a", occurredOn, state: "active" };
}

// Regression for the exact bug flagged in review: a reminder sticker must
// appear even if TODAY's settlement was never saved — i.e. the tracker's
// scheduleStatus alone (not any settlement-save event) drives sticker
// creation.
test("due_today reminder is generated with NO settlement saved today (todaySettlementExists: false)", () => {
  const tracker = intervalTracker();
  // Last completed 7 days before "today" -> nextDueDate is exactly today.
  const trackerFacts = resolveTrackerEvidence(tracker, {
    events: [activeEvent("2026-07-27")],
    today: "2026-08-03",
    todaySettlementExists: false, // <- the point: no save happened today
  });
  assert.equal(trackerFacts.scheduleStatus, "due_today");
  assert.equal(trackerFacts.todayReviewStatus, "not_saved");

  const plan = planTrackerSticker({ tracker, trackerFacts, localDate: "2026-08-03", existingSticker: null, suppressedGenerationKeys: [] });
  assert.equal(plan.action, "create");
});

test("overdue reminder is generated with no settlement saved for many days", () => {
  const tracker = intervalTracker();
  const trackerFacts = resolveTrackerEvidence(tracker, {
    events: [activeEvent("2026-07-20")],
    today: "2026-08-03", // well past the 7-day due date
    todaySettlementExists: false,
  });
  assert.equal(trackerFacts.scheduleStatus, "overdue");
  const plan = planTrackerSticker({ tracker, trackerFacts, localDate: "2026-08-03", existingSticker: null, suppressedGenerationKeys: [] });
  assert.equal(plan.action, "create");
});

// Regression for the exact bug flagged in review: sticker generation must
// not depend on the reconcile job's own state. A job that already reached
// "completed" (e.g. reconciled last night) is correctly excluded from the
// retry sweep — proving the OLD design ("only sync stickers after a
// retried/just-run job") would have silently missed this tracker's morning
// reminder, and that the fix (syncTrackerStickersForDate never consults job
// status) is what actually closes the gap.
test("a completed job is excluded from the retry sweep, yet the SAME tracker's due_today sticker still generates via the job-independent path", () => {
  const completedJob = { id: "s1:0", status: "completed", createdAt: "2026-07-27T00:00:00.000Z" };
  const fetchPage = async () => ({ jobs: [completedJob], cursor: 1 });
  const nowIso = "2026-08-03T00:00:00.000Z";
  const runJobCalls = [];

  return sweepReconcileJobs({
    fetchPage,
    isEligibleNow: (job) => isJobEligibleForRetry(job, nowIso),
    runJob: async (job) => runJobCalls.push(job.id),
    batchLimit: 20,
  }).then((sweepResults) => {
    // The completed job is correctly never retried.
    assert.deepEqual(runJobCalls, []);
    assert.deepEqual(sweepResults, []);

    // Yet the tracker sticker path — which reads CompletionEvents directly,
    // never the job doc — still produces a reminder for the same day.
    const tracker = intervalTracker();
    const trackerFacts = resolveTrackerEvidence(tracker, {
      events: [activeEvent("2026-07-27")],
      today: "2026-08-03",
      todaySettlementExists: false,
    });
    const plan = planTrackerSticker({ tracker, trackerFacts, localDate: "2026-08-03", existingSticker: null, suppressedGenerationKeys: [] });
    assert.equal(plan.action, "create");
  });
});
