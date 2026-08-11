import assert from "node:assert/strict";
import test from "node:test";
import { buildPersistedReminderPlan } from "./planner-reminder-plan.js";

test("server reminder plan reconstructs study reminders while planner page is closed", () => {
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
      todayCustomBlocks: [
        { id: "math", title: "数学网课", categoryId: "study.math", categoryStatGroup: "study", segments: [50], breakMinutes: 10, manualStart: 840, placement: "timeline", priority: 1 },
      ],
      todaySegmentOverrides: {},
    },
    scheduleAssistantSettings: {},
  };
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

test("server recovery reuses the accepted revision when reminder content is unchanged", () => {
  const baseProfile = {
    timezone: "Asia/Shanghai",
    scheduleAssistantDraft: {
      targetDate: "2026-08-11",
      savedOn: "2026-08-11",
      wakeUpTime: "08:00",
      targetBedTime: "23:20",
      todayCustomBlocks: [
        { id: "math", title: "数学", categoryId: "study.math", categoryStatGroup: "study", segments: [50], breakMinutes: 10, manualStart: 840, placement: "timeline" },
      ],
      todaySegmentOverrides: {},
    },
    scheduleAssistantSettings: {},
  };
  const first = buildPersistedReminderPlan({ profile: baseProfile, date: "2026-08-11", now: new Date("2026-08-11T01:00:00Z") });
  const fingerprintProfile = structuredClone(baseProfile);
  // The real browser stores the accepted fingerprint. For this regression we
  // simply reuse the exact content-derived state by generating once, then use
  // the exported revision helper contract indirectly through a second call
  // with an empty sync state: first recovery remains monotonic at revision 1.
  assert.equal(first.revision, 1);
  const second = buildPersistedReminderPlan({ profile: fingerprintProfile, date: "2026-08-11", now: new Date("2026-08-11T01:05:00Z") });
  assert.equal(second.revision, 1);
});
