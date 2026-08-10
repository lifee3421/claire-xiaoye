import assert from "node:assert/strict";
import test from "node:test";
import { handlePlannerLifeCardRequest } from "./planner-life-card.js";
import { makeAdminFirestoreFake } from "../src/server/__test_mocks__/adminFirestoreFake.js";

const uid = "test-uid";

test("life-card completion updates a prepared archived Today even when live draft is another date", async () => {
  const prepared = { targetDate: "2026-08-11", savedOn: "2026-08-11", todaySegmentOverrides: {} };
  const { db, store } = makeAdminFirestoreFake({
    [`users/${uid}`]: {
      scheduleAssistantDraft: { targetDate: "2026-08-10", savedOn: "2026-08-10", todaySegmentOverrides: {} },
      scheduleAssistantDraftArchive: [prepared],
    },
  });

  const result = await handlePlannerLifeCardRequest({
    db,
    uid,
    body: { date: "2026-08-11", cardId: "lunch", completed: true },
    now: new Date("2026-08-11T04:30:00Z"),
  });

  assert.equal(result.ok, true);
  const profile = store.get(`users/${uid}`);
  assert.equal(profile.scheduleAssistantDraft.targetDate, "2026-08-10", "live page date is not hijacked");
  const archivedToday = profile.scheduleAssistantDraftArchive.find((item) => item.targetDate === "2026-08-11");
  assert.equal(archivedToday.todaySegmentOverrides.lunch.status, "completed");
});

test("life-card completion refuses to fabricate a missing planner day", async () => {
  const { db } = makeAdminFirestoreFake({
    [`users/${uid}`]: { scheduleAssistantDraft: { targetDate: "2026-08-10", todaySegmentOverrides: {} } },
  });
  const result = await handlePlannerLifeCardRequest({ db, uid, body: { date: "2026-08-11", cardId: "lunch", completed: true } });
  assert.deepEqual(result, { ok: false, reason: "planner_day_not_found", date: "2026-08-11" });
});
