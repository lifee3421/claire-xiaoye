// State machine for trackerReconcileJobs — the failure-recovery mechanism so
// a settlement save is never silently lost if the browser closes/loses
// network before the tracker projection catches up. This module owns only
// the job's own state transitions and retry eligibility; the actual
// reconcile work (reading trackers/existing events, calling
// reconcileTrackerEvidence, persisting the result) is injected via
// `execute` so this file has no Firestore/IO dependency and stays fully
// unit-testable.
import { normalizeRevision } from "../utils/trackerIdentity.js";

const PROCESSING_STALE_MS = 2 * 60 * 1000; // a job stuck in "processing" this long is treated as abandoned, not actually in flight

// settlementRevision is part of the job's own document id, so it must be
// normalized to a number BEFORE interpolation — a numeric 2 and a legacy
// string "2" must produce the identical job id, never two different docs
// for what is really the same revision.
export function buildReconcileJobId(settlementId, settlementRevision) {
  return `${settlementId}:${normalizeRevision(settlementRevision)}`;
}

// The persisted job doc intentionally never copies the settlement itself —
// only enough to look it up and detect staleness. The authoritative
// settlement is always re-read at reconcile time.
export function createReconcileJob(settlement, now = new Date().toISOString()) {
  const settlementRevision = normalizeRevision(settlement.settlementRevision);
  return {
    id: buildReconcileJobId(settlement.id, settlementRevision),
    settlementId: settlement.id,
    settlementRevision,
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
