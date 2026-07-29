// State machine for trackerReconcileJobs — the failure-recovery mechanism so
// a settlement save is never silently lost if the browser closes/loses
// network before the tracker projection catches up. This module owns only
// the job's own state transitions and retry eligibility; the actual
// reconcile work (reading trackers/existing events, calling
// reconcileTrackerEvidence, persisting the result) is injected via
// `execute` so this file has no Firestore/IO dependency and stays fully
// unit-testable.
const PROCESSING_STALE_MS = 2 * 60 * 1000; // a job stuck in "processing" this long is treated as abandoned, not actually in flight

export function buildReconcileJobId(settlementId, settlementRevision) {
  return `${settlementId}:${settlementRevision}`;
}

// The persisted job doc intentionally never copies the settlement itself —
// only enough to look it up and detect staleness. The authoritative
// settlement is always re-read at reconcile time.
export function createReconcileJob(settlement, now = new Date().toISOString()) {
  return {
    id: buildReconcileJobId(settlement.id, settlement.settlementRevision ?? 0),
    settlementId: settlement.id,
    settlementRevision: settlement.settlementRevision ?? 0,
    reviewDate: settlement.reviewDate,
    status: "pending",
    attempts: 0,
    lastError: null,
    nextRetryAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    supersededByRevision: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function isJobRetryable(job, nowMs = Date.now()) {
  if (!job) return false;
  if (job.status === "pending" || job.status === "failed") return true;
  if (job.status === "processing") return nowMs - new Date(job.updatedAt).getTime() > PROCESSING_STALE_MS;
  return false; // "completed" jobs are never retried
}

/**
 * Runs one attempt of a job via the injected `execute(job)` async callback.
 * Idempotent by construction as long as `execute` itself is idempotent
 * (reconcileTrackerEvidence's upsert/retract already is).
 */
export async function processReconcileJob(job, { execute, now = () => new Date().toISOString() } = {}) {
  const processing = { ...job, status: "processing", attempts: job.attempts + 1, updatedAt: now() };
  try {
    await execute(processing);
    return { ...processing, status: "completed", lastError: null, updatedAt: now() };
  } catch (error) {
    return { ...processing, status: "failed", lastError: String(error?.message || error), updatedAt: now() };
  }
}

export async function retryPendingReconcileJobs(jobs = [], { execute, now = () => new Date().toISOString() } = {}) {
  const nowMs = Date.parse(now());
  const eligible = jobs.filter((job) => isJobRetryable(job, Number.isFinite(nowMs) ? nowMs : Date.now()));
  const results = [];
  for (const job of eligible) {
    results.push(await processReconcileJob(job, { execute, now }));
  }
  return results;
}
