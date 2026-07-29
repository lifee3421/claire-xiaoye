// Thin Firestore adapter for the tracker-reconcile job lifecycle. All actual
// decision-making lives in the pure, unit-tested modules this file wires
// together — src/services/trackerReconcilePlanner.js (claim/finalize/
// revision-guard) and src/services/completionEvents.js (per-tracker evidence
// extraction + upsert/retract diffing). This file's own logic is
// deliberately minimal: read the right docs, call the pure planner, write
// what it says to write.
//
// NOTE: this file has not been exercised against a real Firestore instance
// or the Firestore emulator in this environment (none was available). Its
// call shapes mirror the already-shipped saveReviewWorkbenchSettlement
// pattern in dataService.js as closely as possible, but it should be
// smoke-tested against a real project or the emulator before depending on it
// in production.
//
// Firestore layout:
//   users/{uid}/trackerReconcileJobs/{settlementId}:{settlementRevision}
//   users/{uid}/completionEvents/{trackerId}:{sourceDocumentId}:{sourceFieldKey}:{sourceType}
import { collection, doc, getDoc, getDocs, query, runTransaction, where, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import { applyRevisionGuard, planClaimReconcileJob, planFinalizeReconcileJob } from "./trackerReconcilePlanner.js";
import { reconcileTrackerEvidence } from "./completionEvents.js";

function jobRef(uid, jobId) {
  return doc(db, "users", uid, "trackerReconcileJobs", jobId);
}

function eventRef(uid, eventId) {
  return doc(db, "users", uid, "completionEvents", eventId);
}

function settlementRef(uid, settlementId) {
  return doc(db, "users", uid, "settlements", settlementId);
}

function profileRef(uid) {
  return doc(db, "users", uid);
}

async function fetchExistingEventsForSettlement(uid, settlementId) {
  // Discovery query, run OUTSIDE any transaction (Firestore transactions can
  // only get() by direct reference, not run queries). This only discovers
  // which event ids might need a transactionally-consistent re-read in
  // phase 2/3 below — it is never itself the source of truth for a write
  // decision.
  const snapshot = await getDocs(query(collection(db, "users", uid, "completionEvents"), where("sourceDocumentId", "==", settlementId)));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/**
 * Phase 1: atomically claim (or bail out on) the job. Small transaction —
 * only the job and settlement docs are read.
 */
async function claimJob(uid, jobId, { leaseOwner, now, leaseDurationMs }) {
  return runTransaction(db, async (transaction) => {
    const jobSnapshot = await transaction.get(jobRef(uid, jobId));
    if (!jobSnapshot.exists()) return { outcome: "not_found", job: null };
    const job = { id: jobSnapshot.id, ...jobSnapshot.data() };

    const settlementSnapshot = await transaction.get(settlementRef(uid, job.settlementId));
    const settlement = settlementSnapshot.exists() ? { id: settlementSnapshot.id, ...settlementSnapshot.data() } : null;
    if (!settlement) return { outcome: "not_found", job };

    const plan = planClaimReconcileJob({ job, settlement, leaseOwner, now, leaseDurationMs });
    if (plan.jobPatch) transaction.set(jobRef(uid, jobId), plan.jobPatch, { merge: true });
    return { outcome: plan.outcome, job: plan.jobPatch ? { ...job, ...plan.jobPatch } : job, settlement };
  });
}

/**
 * Phase 2: the actual per-tracker reconcile work. Not run inside a
 * transaction — it may touch many trackers/events, which is unbounded work
 * Firestore client transactions aren't meant to hold open. Safety against
 * concurrent workers is provided by the phase-1 lease claim, and against
 * stale-revision writes by applyRevisionGuard using a fresh per-event read
 * taken right before each write.
 */
async function runReconcileWork(uid, job, settlement, trackers) {
  const existingEvents = await fetchExistingEventsForSettlement(uid, settlement.id);
  const existingByTracker = new Map();
  for (const event of existingEvents) {
    if (!existingByTracker.has(event.trackerId)) existingByTracker.set(event.trackerId, []);
    existingByTracker.get(event.trackerId).push(event);
  }

  const allUpserts = [];
  const allRetracts = [];
  for (const tracker of trackers) {
    const { toUpsert, toRetract } = reconcileTrackerEvidence(tracker, settlement, existingByTracker.get(tracker.id) || []);
    allUpserts.push(...toUpsert);
    allRetracts.push(...toRetract);
  }
  if (!allUpserts.length && !allRetracts.length) return;

  // Fresh, immediately-pre-write reads of exactly the docs we're about to
  // touch — this is the last line of defense against a lower-revision job
  // clobbering a higher-revision one that landed in between phase 1 and now.
  const idsToCheck = [...new Set([...allUpserts, ...allRetracts].map((event) => event.id))];
  const freshDocs = await Promise.all(idsToCheck.map((id) => getDoc(eventRef(uid, id))));
  const freshExistingById = new Map(freshDocs.filter((snapshot) => snapshot.exists()).map((snapshot) => [snapshot.id, snapshot.data()]));

  const guarded = applyRevisionGuard({ toUpsert: allUpserts, toRetract: allRetracts, freshExistingById, jobRevision: job.settlementRevision });

  const batch = writeBatch(db);
  guarded.toUpsert.forEach((event) => batch.set(eventRef(uid, event.id), event, { merge: true }));
  guarded.toRetract.forEach((event) => batch.set(eventRef(uid, event.id), event, { merge: true }));
  await batch.commit();

  return guarded;
}

/**
 * Phase 3: finalize. Small transaction — only the job doc.
 */
async function finalizeJob(uid, jobId, { leaseOwner, now, success, error, attemptCountForBackoff }) {
  return runTransaction(db, async (transaction) => {
    const jobSnapshot = await transaction.get(jobRef(uid, jobId));
    if (!jobSnapshot.exists()) return { outcome: "not_found" };
    const job = { id: jobSnapshot.id, ...jobSnapshot.data() };
    const plan = planFinalizeReconcileJob({ job, leaseOwner, now, success, error, attemptCountForBackoff });
    if (plan.jobPatch) transaction.set(jobRef(uid, jobId), plan.jobPatch, { merge: true });
    return plan;
  });
}

/**
 * Runs one full attempt of a settlement's reconcile job end to end. Safe to
 * call repeatedly/concurrently from multiple tabs — only one call actually
 * does the work per attempt, the rest observe lease_denied/already_completed
 * /superseded and return without writing anything.
 */
export async function runSettlementReconcileJob(uid, jobId, { leaseOwner, leaseDurationMs = 2 * 60 * 1000 } = {}) {
  const now = () => new Date().toISOString();
  const claim = await claimJob(uid, jobId, { leaseOwner, now: now(), leaseDurationMs });
  if (claim.outcome !== "claimed") return claim;

  const profileSnapshot = await getDoc(profileRef(uid));
  const trackers = (Array.isArray(profileSnapshot.data()?.trackers) ? profileSnapshot.data().trackers : []).filter((tracker) => tracker.enabled !== false);

  try {
    await runReconcileWork(uid, claim.job, claim.settlement, trackers);
    const finalized = await finalizeJob(uid, jobId, { leaseOwner, now: now(), success: true });
    return { outcome: finalized.outcome, job: claim.job };
  } catch (error) {
    const finalized = await finalizeJob(uid, jobId, { leaseOwner, now: now(), success: false, error, attemptCountForBackoff: claim.job.attempts });
    return { outcome: finalized.outcome, job: claim.job, error };
  }
}

/**
 * Called from app-startup and from entering the review/tracker pages —
 * finds jobs that are pending, failed-and-due-for-retry, or stuck in a
 * stale "processing" state, and re-runs them. This is the actual failure-
 * recovery path: a settlement save that completed but whose reconcile never
 * ran (browser closed, network dropped) gets caught up here.
 */
export async function retryPendingReconcileJobsForUser(uid, { leaseOwner } = {}) {
  const nowIso = new Date().toISOString();
  const snapshot = await getDocs(query(collection(db, "users", uid, "trackerReconcileJobs"), where("status", "in", ["pending", "processing", "failed"])));
  const jobs = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  const eligible = jobs.filter((job) => {
    if (job.status === "pending") return true;
    if (job.status === "failed") return !job.nextRetryAt || job.nextRetryAt <= nowIso;
    if (job.status === "processing") return !job.leaseExpiresAt || job.leaseExpiresAt <= nowIso; // abandoned lease
    return false;
  });
  const results = [];
  for (const job of eligible) results.push(await runSettlementReconcileJob(uid, job.id, { leaseOwner }));
  return results;
}
