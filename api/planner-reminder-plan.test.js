import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintReminderPlan } from "../src/agent/reminderPlanRevision.js";
import { buildPersistedReminderPlan } from "./planner-reminder-plan.js";

function profileWithMath() {
  return {
    timezone: "Asia/Shanghai",
    scheduleAssistantDraft: {
      targetDate: "2026-08-11",
      savedOn: "2026-08-11",
      wakeUpTime: "08:00",
      targetBedTime: "23:20",
      lunchStartTime: "12:00",
      lunchBlockMinutes: 100,
      startupBufferMinutes: 20,
      todayCustomBlocks: [
        { id: "math", title: "数学网课", categoryId: "study.math", categoryStatGroup: "study", segments: [50], breakMinutes: 10, manualStart: 840, placement: "timeline", priority: 1 },
      ],
      todaySegmentOverrides: {},
    },
    scheduleAssistantSettings: {},
  };
}

test("server reminder plan reconstructs study reminders while planner page is closed", () => {
  const profile = profileWithMath();
  const plan = buildPersistedReminderPlan({
    profile,
    date: "2026-08-11",
    accountId: "claire",
    now: new Date("2026-08-11T05:00:00.000Z"),
  });
  assert.equal(plan.source, "catkeeper");
  assert.equal(plan.localDate, "2026-08-11");
  assert.equal(plan.revision, 1);
  assert.ok(plan.reminders.some((item) => item.sourceCardId === "math-1" && item.purpose === "start_task"));
});

test("server reminder recovery emits both nap start and wake reminders", () => {
  const profile = {
    timezone: "Asia/Shanghai",
    scheduleAssistantDraft: {
      targetDate: "2026-08-11",
      savedOn: "2026-08-11",
      wakeUpTime: "08:00",
      targetBedTime: "23:20",
      lunchStartTime: "12:00",
      lunchBlockMinutes: 100,
      startupBufferMinutes: 20,
      todayCustomBlocks: [],
      todaySegmentOverrides: {},
    },
    scheduleAssistantSettings: {},
  };
  const plan = buildPersistedReminderPlan({ profile, date: "2026-08-11", now: new Date("2026-08-11T03:00:00.000Z") });
  const nap = plan.reminders.filter((item) => item.sourceCardId === "nap");
  assert.ok(nap.some((item) => item.purpose === "rest"));
  assert.ok(nap.some((item) => item.purpose === "wake_up"));
});

test("server recovery preserves fixed-card reminder semantics from the browser timeline", () => {
  const profile = profileWithMath();
  const plan = buildPersistedReminderPlan({ profile, date: "2026-08-11", now: new Date("2026-08-11T01:00:00Z") });

  const dailyReview = plan.reminders.find((item) => item.sourceCardId === "daily-review");
  assert.ok(dailyReview, "daily-review keeps its browser specialRole and default reminder");
  assert.equal(dailyReview.purpose, "start_task");

  const wakePrep = plan.reminders.find((item) => item.sourceCardId === "wake-prep");
  assert.equal(wakePrep, undefined, "wake-prep keeps day-start-anchor semantics and is not invented as an extra default reminder");

  const dailyReviewCard = plan.cards.find((item) => item.id === "daily-review");
  const wakePrepCard = plan.cards.find((item) => item.id === "wake-prep");
  assert.equal(dailyReviewCard.specialRole, "daily_review");
  assert.equal(wakePrepCard.systemRole, "day-start-anchor");
});

test("server recovery reuses the browser-accepted revision when content is unchanged", () => {
  const profile = profileWithMath();
  const first = buildPersistedReminderPlan({ profile, date: "2026-08-11", now: new Date("2026-08-11T01:00:00Z") });
  const fingerprint = fingerprintReminderPlan(first);
  profile.scheduleAssistantDraft.reminderPlanSyncByDate = {
    "2026-08-11": { fingerprint, acceptedRevision: 7 },
  };
  const second = buildPersistedReminderPlan({ profile, date: "2026-08-11", now: new Date("2026-08-11T01:05:00Z") });
  assert.equal(second.revision, 7);
  assert.equal(fingerprintReminderPlan(second), fingerprint);
});

test("server recovery uses the persisted Snow reminder settings instead of defaulting them", () => {
  const profile = profileWithMath();
  profile.snowdustDeskVerification = {
    defaultAdvanceMinutes: 7,
    firstFollowUpMinutes: 13,
    reminderIntervalMinutes: 21,
    morning: { enabled: true },
    evening: { enabled: true },
  };
  const plan = buildPersistedReminderPlan({ profile, date: "2026-08-11", now: new Date("2026-08-11T01:00:00Z") });
  const math = plan.reminders.find((item) => item.sourceCardId === "math-1" && item.purpose === "start_task");
  assert.ok(math);
  assert.equal(math.advanceMinutes, 7);
  assert.equal(math.scheduledAt, "2026-08-11T13:53:00+08:00");
});
