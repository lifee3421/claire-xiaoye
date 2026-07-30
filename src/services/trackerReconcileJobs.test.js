import test from "node:test";
import assert from "node:assert/strict";
import { buildReconcileJobId, createReconcileJob, isJobRetryable, processReconcileJob, retryPendingReconcileJobs, sweepReconcileJobs } from "./trackerReconcileJobs.js";

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

// A tiny in-memory paginated store standing in for a real Firestore
// query+cursor — sweepReconcileJobs only depends on the {jobs, cursor}
// page shape, never on Firestore itself, so this is a faithful test double
// for its actual contract.
function makeFakePagedStore(jobs) {
  return async ({ cursor, limit: pageLimit }) => {
    const startIndex = cursor ?? 0;
    const page = jobs.slice(startIndex, startIndex + pageLimit);
    return { jobs: page, cursor: startIndex + page.length };
  };
}

test("sweepReconcileJobs: 45 pending jobs are ALL processed within one sweep, across multiple internal pages", async () => {
  const jobs = Array.from({ length: 45 }, (_, i) => ({ id: `job-${i}`, status: "pending" }));
  const fetchPage = makeFakePagedStore(jobs);
  const fetchPageCalls = [];
  const results = await sweepReconcileJobs({
    fetchPage: async (args) => { fetchPageCalls.push(args); return fetchPage(args); },
    isEligibleNow: () => true,
    runJob: async (job) => job.id,
    batchLimit: 20,
  });
  assert.equal(results.length, 45);
  assert.deepEqual(results, jobs.map((j) => j.id));
  assert.equal(fetchPageCalls.length, 3); // 20 + 20 + 5
});

test("sweepReconcileJobs: the first page being entirely ineligible (stuck processing / not-yet-due failed) does not starve eligible jobs further back in the queue", async () => {
  const stuckProcessing = Array.from({ length: 20 }, (_, i) => ({ id: `stuck-${i}`, status: "processing", eligible: false }));
  const laterPending = Array.from({ length: 5 }, (_, i) => ({ id: `pending-${i}`, status: "pending", eligible: true }));
  const jobs = [...stuckProcessing, ...laterPending];
  const fetchPage = makeFakePagedStore(jobs);
  const results = await sweepReconcileJobs({
    fetchPage,
    isEligibleNow: (job) => job.eligible === true,
    runJob: async (job) => job.id,
    batchLimit: 20,
  });
  assert.deepEqual(results, laterPending.map((j) => j.id)); // all 5 later-pending jobs still got processed
});

test("sweepReconcileJobs: a pathological all-ineligible backlog still terminates at the hard cap, never loops forever", async () => {
  const infiniteIneligibleStore = async ({ limit: pageLimit }) => ({
    jobs: Array.from({ length: pageLimit }, () => ({ status: "processing", eligible: false })),
    cursor: "unused", // a real cursor would keep moving; the point is the loop must stop regardless
  });
  let fetchPageCalls = 0;
  const results = await sweepReconcileJobs({
    fetchPage: async (args) => { fetchPageCalls += 1; return infiniteIneligibleStore(args); },
    isEligibleNow: () => false,
    runJob: async () => { throw new Error("should never be called"); },
    batchLimit: 10,
    maxExamined: 55, // deliberately not a multiple of batchLimit
  });
  assert.deepEqual(results, []);
  assert.equal(fetchPageCalls, 6); // 5 full pages of 10 (=50 examined) + 1 final page capped to 5 remaining
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
