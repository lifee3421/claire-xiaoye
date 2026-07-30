import test from "node:test";
import assert from "node:assert/strict";
import { applyRevisionGuard, planClaimReconcileJob, planFinalizeReconcileJob } from "./trackerReconcilePlanner.js";

function job(overrides = {}) {
  return {
    id: "s1:2", settlementId: "s1", settlementRevision: 2, reviewDate: "2026-07-27",
    status: "pending", attempts: 0, lastError: null, nextRetryAt: null,
    leaseOwner: null, leaseExpiresAt: null, supersededByRevision: null, completedAt: null,
    createdAt: "2026-07-27T00:00:00Z", updatedAt: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

test("planClaimReconcileJob: missing job is a no-op", () => {
  const result = planClaimReconcileJob({ job: null, settlement: { settlementRevision: 2 }, leaseOwner: "tabA" });
  assert.equal(result.outcome, "not_found");
  assert.equal(result.jobPatch, null);
});

// Direct regression for the scenario the user described: revision 2's job
// runs late, after revision 3 has already been saved. It must not reconcile
// using the stale revision-2 settlement snapshot at all.
test("planClaimReconcileJob: a stale job whose settlement has since moved to a higher revision is superseded, not executed", () => {
  const result = planClaimReconcileJob({ job: job({ settlementRevision: 2 }), settlement: { settlementRevision: 3 }, leaseOwner: "tabA", now: "2026-07-28T00:00:00Z" });
  assert.equal(result.outcome, "superseded");
  assert.equal(result.jobPatch.status, "completed");
  assert.equal(result.jobPatch.supersededByRevision, 3);
});

test("planClaimReconcileJob: already-completed job is left alone", () => {
  const result = planClaimReconcileJob({ job: job({ status: "completed" }), settlement: { settlementRevision: 2 }, leaseOwner: "tabA" });
  assert.equal(result.outcome, "already_completed");
  assert.equal(result.jobPatch, null);
});

test("planClaimReconcileJob: an active lease held by another worker is denied", () => {
  const held = job({ status: "processing", leaseOwner: "tabA", leaseExpiresAt: "2026-07-27T00:05:00Z" });
  const result = planClaimReconcileJob({ job: held, settlement: { settlementRevision: 2 }, leaseOwner: "tabB", now: "2026-07-27T00:01:00Z" });
  assert.equal(result.outcome, "lease_denied");
  assert.equal(result.jobPatch, null);
});

test("planClaimReconcileJob: a pending job is claimed, setting lease and incrementing attempts", () => {
  const result = planClaimReconcileJob({ job: job({ attempts: 0 }), settlement: { settlementRevision: 2 }, leaseOwner: "tabA", now: "2026-07-27T00:00:00Z", leaseDurationMs: 120_000 });
  assert.equal(result.outcome, "claimed");
  assert.equal(result.jobPatch.status, "processing");
  assert.equal(result.jobPatch.leaseOwner, "tabA");
  assert.equal(result.jobPatch.attempts, 1);
  assert.equal(result.jobPatch.leaseExpiresAt, "2026-07-27T00:02:00.000Z");
});

test("planClaimReconcileJob: an expired lease can be reclaimed by a different worker", () => {
  const expired = job({ status: "processing", leaseOwner: "tabA", leaseExpiresAt: "2026-07-27T00:00:00Z", attempts: 1 });
  const result = planClaimReconcileJob({ job: expired, settlement: { settlementRevision: 2 }, leaseOwner: "tabB", now: "2026-07-27T00:05:00Z" });
  assert.equal(result.outcome, "claimed");
  assert.equal(result.jobPatch.leaseOwner, "tabB");
  assert.equal(result.jobPatch.attempts, 2);
});

test("planFinalizeReconcileJob: success clears the lease and marks completed", () => {
  const claimed = job({ status: "processing", leaseOwner: "tabA", leaseExpiresAt: "2026-07-27T00:02:00Z", attempts: 1 });
  const result = planFinalizeReconcileJob({ job: claimed, leaseOwner: "tabA", now: "2026-07-27T00:01:00Z", success: true });
  assert.equal(result.outcome, "finalized");
  assert.equal(result.jobPatch.status, "completed");
  assert.equal(result.jobPatch.leaseOwner, null);
});

test("planFinalizeReconcileJob: failure preserves attempts/lastError and schedules a retry", () => {
  const claimed = job({ status: "processing", leaseOwner: "tabA", leaseExpiresAt: "2026-07-27T00:02:00Z", attempts: 1 });
  const result = planFinalizeReconcileJob({ job: claimed, leaseOwner: "tabA", now: "2026-07-27T00:01:00Z", success: false, error: new Error("firestore write failed"), attemptCountForBackoff: 1 });
  assert.equal(result.outcome, "failed");
  assert.equal(result.jobPatch.status, "failed");
  assert.equal(result.jobPatch.lastError, "firestore write failed");
  assert.equal(result.jobPatch.nextRetryAt, "2026-07-27T00:01:30.000Z");
  assert.equal(result.jobPatch.leaseOwner, null); // lease released so a retry can reclaim it
});

test("planFinalizeReconcileJob: does not overwrite a job whose lease has since been reclaimed by someone else", () => {
  const reclaimed = job({ status: "processing", leaseOwner: "tabB", leaseExpiresAt: "2026-07-27T00:10:00Z", attempts: 2 });
  const result = planFinalizeReconcileJob({ job: reclaimed, leaseOwner: "tabA", now: "2026-07-27T00:05:00Z", success: true });
  assert.equal(result.outcome, "lease_lost");
  assert.equal(result.jobPatch, null);
});

test("applyRevisionGuard: refuses to let a lower-revision write clobber an already-fresher event", () => {
  const staleUpsert = { id: "family-a:s1:categoryReviewEntries.cat_9f2a:categoryEntry", value: 20 };
  const okUpsert = { id: "family-a:s1:health.maintenanceCompleted.family-a:maintenance", value: null };
  const freshExistingById = new Map([
    [staleUpsert.id, { id: staleUpsert.id, sourceRevision: "3" }], // revision 3 already stored
  ]);
  const result = applyRevisionGuard({ toUpsert: [staleUpsert, okUpsert], toRetract: [], freshExistingById, jobRevision: 2 });
  assert.deepEqual(result.toUpsert, [okUpsert]);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, staleUpsert.id);
});

test("applyRevisionGuard: same-or-lower stored revision is not treated as stale", () => {
  const upsert = { id: "e1", value: 1 };
  const freshExistingById = new Map([["e1", { id: "e1", sourceRevision: "2" }]]);
  const result = applyRevisionGuard({ toUpsert: [upsert], toRetract: [], freshExistingById, jobRevision: 2 });
  assert.deepEqual(result.toUpsert, [upsert]);
  assert.equal(result.skipped.length, 0);
});
