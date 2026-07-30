// Pure decision logic for the lease-based, revision-safe reconcile job
// lifecycle. Zero Firestore dependency — src/services/trackerReconcileFirestore.js
// is the thin adapter that reads/writes real documents and calls these
// functions to decide what to write. Kept separate so the actual safety
// rules (supersede-by-revision, lease contention, stale-lease recovery,
// revision-guarded event writes) are fully unit-testable without a Firestore
// emulator.
import { normalizeRevision } from "../utils/trackerIdentity.js";

const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const RETRY_BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000]; // attempt 1/2/3+ backoff

function leaseIsActive(job, nowMs) {
  return job.status === "processing" && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > nowMs;
}

/**
 * Phase 1: decide whether this worker may claim the job, BEFORE doing any
 * of the actual per-tracker reconcile work. Must run inside a Firestore
 * transaction (job doc + settlement doc both read via transaction.get) so
 * the claim itself is atomic against concurrent workers.
 */
export function planClaimReconcileJob({ job, settlement, leaseOwner, now = new Date().toISOString(), leaseDurationMs = DEFAULT_LEASE_MS } = {}) {
  if (!job) return { outcome: "not_found", jobPatch: null };

  const currentRevision = normalizeRevision(settlement?.settlementRevision);
  const jobRevision = normalizeRevision(job.settlementRevision);
  if (currentRevision > jobRevision) {
    // A newer save already superseded this job. Its own job (settlementId:currentRevision)
    // is the one responsible for reconciling — this stale job must NOT touch
    // any CompletionEvent, it just marks itself done-by-supersession.
    return {
      outcome: "superseded",
      jobPatch: { status: "completed", supersededByRevision: currentRevision, completedAt: now, leaseOwner: null, leaseExpiresAt: null, updatedAt: now },
    };
  }

  if (job.status === "completed") return { outcome: "already_completed", jobPatch: null };

  const nowMs = Date.parse(now);
  if (leaseIsActive(job, nowMs) && job.leaseOwner !== leaseOwner) {
    return { outcome: "lease_denied", jobPatch: null };
  }

  const leaseExpiresAt = new Date(nowMs + leaseDurationMs).toISOString();
  return {
    outcome: "claimed",
    jobPatch: { status: "processing", leaseOwner, leaseExpiresAt, attempts: Number(job.attempts || 0) + 1, updatedAt: now },
  };
}

/**
 * Phase 3: after the (non-transactional) per-tracker reconcile work in
 * phase 2 either succeeds or throws, finalize the job. If another worker's
 * lease has since taken over (ours expired mid-flight and was reclaimed),
 * we must NOT stomp their state — that is the `lease_lost` outcome.
 */
export function planFinalizeReconcileJob({ job, leaseOwner, now = new Date().toISOString(), success, error, attemptCountForBackoff } = {}) {
  if (!job) return { outcome: "not_found", jobPatch: null };
  if (job.leaseOwner !== leaseOwner) return { outcome: "lease_lost", jobPatch: null };

  if (success) {
    return {
      outcome: "finalized",
      jobPatch: { status: "completed", completedAt: now, lastError: null, nextRetryAt: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now },
    };
  }

  const attempt = Math.max(1, Number(attemptCountForBackoff ?? job.attempts ?? 1));
  const backoffMs = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
  const nextRetryAt = new Date(Date.parse(now) + backoffMs).toISOString();
  return {
    outcome: "failed",
    jobPatch: { status: "failed", lastError: String(error?.message || error || "unknown error"), nextRetryAt, leaseOwner: null, leaseExpiresAt: null, updatedAt: now },
  };
}

/**
 * Final safety net before actually writing CompletionEvent upserts/retracts:
 * even though phase 1 already refused to claim a superseded job, this
 * double-checks against a FRESH read of each specific event doc (taken right
 * before the write) and refuses to let a lower-revision write clobber a
 * higher-revision one that may have landed via a different job in between.
 */
export function applyRevisionGuard({ toUpsert = [], toRetract = [], freshExistingById = new Map(), jobRevision = 0 } = {}) {
  const normalizedJobRevision = normalizeRevision(jobRevision);
  const isStale = (event) => {
    const fresh = freshExistingById.get(event.id);
    return fresh && normalizeRevision(fresh.sourceRevision) > normalizedJobRevision;
  };
  const skipped = [];
  const safeUpsert = toUpsert.filter((event) => {
    if (isStale(event)) { skipped.push({ id: event.id, reason: "newer_revision_already_present" }); return false; }
    return true;
  });
  const safeRetract = toRetract.filter((event) => {
    if (isStale(event)) { skipped.push({ id: event.id, reason: "newer_revision_already_present" }); return false; }
    return true;
  });
  return { toUpsert: safeUpsert, toRetract: safeRetract, skipped };
}
