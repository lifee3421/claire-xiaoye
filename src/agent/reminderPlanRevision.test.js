import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintReminderPlan, prepareReminderPlanForSync, recordAcceptedReminderPlanRevision, resolveReminderPlanRevision } from "./reminderPlanRevision.js";

function plan(localDate, title = "math") {
  return { schemaVersion: 1, source: "catkeeper", accountId: "claire", localDate, timezone: "Asia/Shanghai", revision: 99, generatedAt: "2026-07-28T00:00:00.000Z", reminders: [{ sourceCardId: "card", scheduledAt: `${localDate}T09:00:00+08:00`, text: title, studyStartVerification: { required: true } }] };
}

test("first sync starts at revision 1 and unchanged plan keeps its accepted revision", () => {
  const first = resolveReminderPlanRevision({}, "2026-07-28", plan("2026-07-28"));
  assert.equal(first.revision, 1);
  const persisted = recordAcceptedReminderPlanRevision({}, first);
  assert.equal(resolveReminderPlanRevision(persisted.reminderPlanSyncByDate, "2026-07-28", plan("2026-07-28")).revision, 1);
});

test("each content change increments once while dates remain independent", () => {
  const first = resolveReminderPlanRevision({}, "2026-07-28", plan("2026-07-28"));
  const state = recordAcceptedReminderPlanRevision({}, first);
  const second = resolveReminderPlanRevision(state.reminderPlanSyncByDate, "2026-07-28", plan("2026-07-28", "physics"));
  const thirdState = recordAcceptedReminderPlanRevision(state, second);
  const third = resolveReminderPlanRevision(thirdState.reminderPlanSyncByDate, "2026-07-28", plan("2026-07-28", "chemistry"));
  assert.equal(second.revision, 2);
  assert.equal(third.revision, 3);
  assert.equal(resolveReminderPlanRevision(thirdState.reminderPlanSyncByDate, "2026-07-29", plan("2026-07-29")).revision, 1);
});

test("fingerprint ignores transient revision and generatedAt fields", () => {
  const first = plan("2026-07-28");
  const second = { ...first, revision: 2, generatedAt: "2026-07-28T03:00:00.000Z" };
  assert.equal(fingerprintReminderPlan(first), fingerprintReminderPlan(second));
});

test("the preview plan is the exact plan that is ready for POST", () => {
  const provisional = plan("2026-07-28");
  const prepared = prepareReminderPlanForSync({}, provisional);
  assert.equal(prepared.plan.revision, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.plan)), prepared.plan);
  assert.equal(prepared.plan.reminders[0].studyStartVerification.required, true);
});

test("a failed or invalid acceptance leaves the accepted revision state untouched", () => {
  const prior = { reminderPlanSyncByDate: { "2026-07-28": { fingerprint: "v1:old", acceptedRevision: 1 } } };
  assert.equal(recordAcceptedReminderPlanRevision(prior, { localDate: "2026-07-28", fingerprint: "", revision: 2 }), prior);
  assert.deepEqual(prior.reminderPlanSyncByDate["2026-07-28"], { fingerprint: "v1:old", acceptedRevision: 1 });
});
