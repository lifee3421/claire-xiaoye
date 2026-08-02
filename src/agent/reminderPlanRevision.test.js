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

// --- Test H: monotonic revision guard ---
//
// Scenario: revision 3 is accepted and recorded. Then a stale in-flight send
// from revision 2 returns late (e.g. network delay). The stale acceptance
// must NOT downgrade the recorded acceptedRevision from 3 back to 2 — that
// would cause the next sync to reuse revision 2, which Snow-dust already
// rejected as stale, creating a permanent stuck loop.
test("a stale in-flight acceptance cannot downgrade a newer accepted revision (test H)", () => {
  // Accept revision 3
  let draft = recordAcceptedReminderPlanRevision({}, { localDate: "2026-07-28", fingerprint: "v1:fp3", revision: 3 });
  assert.equal(draft.reminderPlanSyncByDate["2026-07-28"].acceptedRevision, 3);
  assert.equal(draft.reminderPlanSyncByDate["2026-07-28"].fingerprint, "v1:fp3");

  // Stale revision 2 arrives late — must NOT overwrite
  draft = recordAcceptedReminderPlanRevision(draft, { localDate: "2026-07-28", fingerprint: "v1:fp2", revision: 2 });
  assert.equal(draft.reminderPlanSyncByDate["2026-07-28"].acceptedRevision, 3, "stale revision 2 must not downgrade from 3");
  assert.equal(draft.reminderPlanSyncByDate["2026-07-28"].fingerprint, "v1:fp3", "fingerprint must stay as the newer one");

  // Equal revision is allowed through (idempotent re-confirm — same revision arriving twice is safe)
  draft = recordAcceptedReminderPlanRevision(draft, { localDate: "2026-07-28", fingerprint: "v1:fp3b", revision: 3 });
  assert.equal(draft.reminderPlanSyncByDate["2026-07-28"].acceptedRevision, 3);
  // The fingerprint gets updated since the revision is equal (not lower)
  assert.equal(draft.reminderPlanSyncByDate["2026-07-28"].fingerprint, "v1:fp3b");

  // Newer revision always overwrites
  draft = recordAcceptedReminderPlanRevision(draft, { localDate: "2026-07-28", fingerprint: "v1:fp4", revision: 4 });
  assert.equal(draft.reminderPlanSyncByDate["2026-07-28"].acceptedRevision, 4);
  assert.equal(draft.reminderPlanSyncByDate["2026-07-28"].fingerprint, "v1:fp4");
});
