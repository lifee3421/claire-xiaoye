import test from "node:test";
import assert from "node:assert/strict";
import { buildReconcileJobId, createReconcileJob, isJobRetryable, processReconcileJob, retryPendingReconcileJobs } from "./trackerReconcileJobs.js";

test("createReconcileJob: id is deterministic from settlementId + revision", () => {
  const job = createReconcileJob({ id: "s1", settlementRevision: 2 }, "2026-07-27T00:00:00Z");
  assert.equal(job.id, buildReconcileJobId("s1", 2));
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 0);
});

test("processReconcileJob: success transitions pending -> processing -> completed", async () => {
  const job = createReconcileJob({ id: "s1", settlementRevision: 0 }, "2026-07-27T00:00:00Z");
  const calls = [];
  const result = await processReconcileJob(job, { execute: async (running) => calls.push(running.status), now: () => "2026-07-27T00:01:00Z" });
  assert.deepEqual(calls, ["processing"]);
  assert.equal(result.status, "completed");
  assert.equal(result.attempts, 1);
  assert.equal(result.lastError, null);
});

test("processReconcileJob: failure records lastError and status=failed, does not throw", async () => {
  const job = createReconcileJob({ id: "s1", settlementRevision: 0 }, "2026-07-27T00:00:00Z");
  const result = await processReconcileJob(job, { execute: async () => { throw new Error("firestore unavailable"); }, now: () => "2026-07-27T00:01:00Z" });
  assert.equal(result.status, "failed");
  assert.equal(result.lastError, "firestore unavailable");
});

test("isJobRetryable: pending and failed are retryable, completed never is, processing only if stale", () => {
  const base = { status: "pending", updatedAt: "2026-07-27T00:00:00Z" };
  assert.equal(isJobRetryable(base), true);
  assert.equal(isJobRetryable({ ...base, status: "failed" }), true);
  assert.equal(isJobRetryable({ ...base, status: "completed" }), false);
  const freshProcessing = { ...base, status: "processing", updatedAt: new Date().toISOString() };
  assert.equal(isJobRetryable(freshProcessing, Date.now()), false);
  const staleProcessing = { ...base, status: "processing", updatedAt: "2020-01-01T00:00:00Z" };
  assert.equal(isJobRetryable(staleProcessing, Date.now()), true);
});

test("retryPendingReconcileJobs: reprocesses only eligible jobs, each idempotently", async () => {
  const jobs = [
    createReconcileJob({ id: "s1", settlementRevision: 0 }, "2026-07-27T00:00:00Z"),
    { ...createReconcileJob({ id: "s2", settlementRevision: 0 }, "2026-07-27T00:00:00Z"), status: "completed" },
  ];
  const executed = [];
  const results = await retryPendingReconcileJobs(jobs, { execute: async (job) => executed.push(job.settlementId), now: () => "2026-07-28T00:00:00Z" });
  assert.deepEqual(executed, ["s1"]); // s2 already completed, never re-executed
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "completed");
});

test("processReconcileJob is safe to call twice for the same job (simulates browser resuming an interrupted save)", async () => {
  const job = createReconcileJob({ id: "s1", settlementRevision: 0 }, "2026-07-27T00:00:00Z");
  let sideEffectCount = 0;
  const execute = async () => { sideEffectCount += 1; }; // stand-in for reconcileTrackerEvidence's own idempotent upsert
  const first = await processReconcileJob(job, { execute, now: () => "2026-07-27T00:01:00Z" });
  const second = await processReconcileJob(first, { execute, now: () => "2026-07-27T00:02:00Z" });
  assert.equal(sideEffectCount, 2); // execute ran twice, but each run is itself idempotent (tested in completionEvents.test.js)
  assert.equal(second.status, "completed");
  assert.equal(second.attempts, 2);
});
