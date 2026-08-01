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
import { collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, startAfter, where, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import { applyRevisionGuard, planClaimReconcileJob, planFinalizeReconcileJob } from "./trackerReconcilePlanner.js";
import { reconcileTrackerEvidence } from "./completionEvents.js";
import { isJobEligibleForRetry, sweepReconcileJobs } from "./trackerReconcileJobs.js";
import { assertNoCompletionEventIdCollision, normalizeRevision } from "../utils/trackerIdentity.js";
import { resolveTrackerEvidence } from "../utils/trackerFacts.js";
import { resolveEffectiveTrackers } from "../utils/trackerDefaults.js";

// How many pending/failed/stuck-processing jobs a single retry sweep will
// pick up. Deliberately small and bounded — app startup and page-entry must
// never pull a user's entire reconcile-job history; a backlog larger than
// this is caught up over several sweeps, not one.
const RETRY_BATCH_LIMIT = 20;
// Hard cap on total jobs examined in one sweep (across all internal pages) —
// see sweepReconcileJobs's own doc comment for why this must exist even
// though the cursor already keeps making forward progress.
const RETRY_MAX_EXAMINED_PER_SWEEP = 200;

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
    const { toUpsert, toRetract } = await reconcileTrackerEvidence(tracker, settlement, existingByTracker.get(tracker.id) || []);
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

  // A SHA-256 id collision across two genuinely different identity tuples is
  // cryptographically implausible, but "the id matches" must never be
  // trusted as identity proof on its own — this throws loudly (which
  // finalizeJob below records as a failed/retryable job) rather than
  // silently letting one CompletionEvent's write clobber an unrelated one
  // that happens to hash to the same id.
  [...allUpserts, ...allRetracts].forEach((event) => assertNoCompletionEventIdCollision(event, freshExistingById.get(event.id)));

  const guarded = applyRevisionGuard({ toUpsert: allUpserts, toRetract: allRetracts, freshExistingById, jobRevision: normalizeRevision(job.settlementRevision) });

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
 * TrackerFacts is a pure read projected from active CompletionEvents (see
 * src/utils/trackerFacts.js) — this is the thin Firestore-backed query for
 * "give me the facts for these trackers right now", used both right after a
 * successful reconcile and by the tracker panel on its own. Two equality
 * filters (trackerId, state) — see the index note in the phase-2 report for
 * why this is still declared as a required composite index rather than
 * assumed automatic.
 */
export async function fetchTrackerFacts(uid, trackers, { today, todaySettlementExists = false } = {}) {
  const results = [];
  for (const tracker of trackers) {
    const snapshot = await getDocs(query(
      collection(db, "users", uid, "completionEvents"),
      where("trackerId", "==", tracker.id),
      where("state", "==", "active"),
    ));
    const events = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
    results.push(resolveTrackerEvidence(tracker, { events, today, todaySettlementExists }));
  }
  return results;
}

// Monthly overview reads the same authoritative collection as TrackerFacts.
// Filtering state in Firestore limits the UI to active evidence; the pure
// overview projection defensively filters again so retracted records can
// never affect a calendar if this adapter changes later.
export async function fetchActiveCompletionEventsForTracker(uid, trackerId) {
  if (!uid || !trackerId) return [];
  const snapshot = await getDocs(query(
    collection(db, "users", uid, "completionEvents"),
    where("trackerId", "==", trackerId),
    where("state", "==", "active"),
  ));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

// Migration reads only persisted settlements and existing CompletionEvents.
// The latter are consulted solely for idempotency; they never become evidence.
export async function fetchTrackerMigrationSnapshot(uid) {
  if (!uid) return { settlements: [], events: [] };
  const [settlementsSnapshot, eventsSnapshot] = await Promise.all([
    getDocs(collection(db, "users", uid, "settlements")),
    getDocs(collection(db, "users", uid, "completionEvents")),
  ]);
  return {
    settlements: settlementsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    events: eventsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
  };
}

// Writes are deliberately opt-in from the migration preview's confirmation
// button. A pre-write direct read retains the same deterministic event-id
// semantics as live reconcile and makes retries safe after partial failure.
export async function writeConfirmedMigrationEvents(uid, events = []) {
  const unique = [...new Map((Array.isArray(events) ? events : []).filter((event) => event?.id).map((event) => [event.id, event])).values()];
  const fresh = await Promise.all(unique.map((event) => getDoc(eventRef(uid, event.id))));
  const toCreate = []; let skipped = 0;
  unique.forEach((event, index) => {
    const existing = fresh[index];
    if (existing.exists()) { assertNoCompletionEventIdCollision(event, existing.data()); skipped += 1; return; }
    toCreate.push(event);
  });
  let created = 0;
  for (let offset = 0; offset < toCreate.length; offset += 450) {
    const batch = writeBatch(db); const chunk = toCreate.slice(offset, offset + 450);
    chunk.forEach((event) => batch.set(eventRef(uid, event.id), event, { merge: false }));
    try { await batch.commit(); created += chunk.length; } catch (error) { return { created, skipped, failed: toCreate.length - created, error }; }
  }
  return { created, skipped, failed: 0 };
}

/**
 * Runs one full attempt of a settlement's reconcile job end to end. Safe to
 * call repeatedly/concurrently from multiple tabs — only one call actually
 * does the work per attempt, the rest observe lease_denied/already_completed
 * /superseded and return without writing anything. On success, also returns
 * the freshly-recomputed TrackerFacts for whichever trackers this job's
 * settlement actually touched, as of that settlement's own reviewDate.
 */
export async function runSettlementReconcileJob(uid, jobId, { leaseOwner, leaseDurationMs = 2 * 60 * 1000 } = {}) {
  const now = () => new Date().toISOString();
  const claim = await claimJob(uid, jobId, { leaseOwner, now: now(), leaseDurationMs });
  if (claim.outcome !== "claimed") return claim;

  const profileSnapshot = await getDoc(profileRef(uid));
  // resolveEffectiveTrackers, not raw profile.trackers — the built-in
  // "联系外婆" default must be reconciled (real CompletionEvents generated
  // from its evidenceBindings) even for a profile that has never had any
  // Tracker config saved to it.
  const trackers = resolveEffectiveTrackers(profileSnapshot.data()).filter((tracker) => tracker.enabled !== false);

  try {
    const guarded = await runReconcileWork(uid, claim.job, claim.settlement, trackers);
    const finalized = await finalizeJob(uid, jobId, { leaseOwner, now: now(), success: true });
    const touchedTrackerIds = new Set([...(guarded?.toUpsert || []), ...(guarded?.toRetract || [])].map((event) => event.trackerId));
    const touchedTrackers = trackers.filter((tracker) => touchedTrackerIds.has(tracker.id));
    const trackerFacts = touchedTrackers.length
      ? await fetchTrackerFacts(uid, touchedTrackers, { today: claim.settlement.reviewDate, todaySettlementExists: true })
      : [];
    return { outcome: finalized.outcome, job: claim.job, trackerFacts };
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
 *
 * Paginates via sweepReconcileJobs (src/services/trackerReconcileJobs.js):
 * the cursor advances past every page it reads regardless of how many jobs
 * in it turned out eligible, so up to RETRY_BATCH_LIMIT stuck/not-yet-due
 * jobs at the head of the queue can never block eligible jobs further back
 * — and the whole sweep is capped at RETRY_MAX_EXAMINED_PER_SWEEP jobs
 * examined, so a pathological backlog still terminates in bounded time
 * rather than looping forever.
 *
 * REQUIRES a composite index: trackerReconcileJobs (status ASC/IN, createdAt
 * ASC) — an "in" filter combined with an orderBy on a different field always
 * needs a composite index in Firestore; this is not covered by automatic
 * single-field indexing.
 */
export async function retryPendingReconcileJobsForUser(uid, { leaseOwner, batchLimit = RETRY_BATCH_LIMIT, maxExamined = RETRY_MAX_EXAMINED_PER_SWEEP } = {}) {
  const nowIso = new Date().toISOString();
  const fetchPage = async ({ cursor, limit: pageLimit }) => {
    const constraints = [
      collection(db, "users", uid, "trackerReconcileJobs"),
      where("status", "in", ["pending", "processing", "failed"]),
      orderBy("createdAt", "asc"),
    ];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageLimit));
    const snapshot = await getDocs(query(...constraints));
    return {
      jobs: snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })),
      cursor: snapshot.docs.length ? snapshot.docs[snapshot.docs.length - 1] : cursor, // the QueryDocumentSnapshot itself, as startAfter() expects
    };
  };
  return sweepReconcileJobs({
    fetchPage,
    isEligibleNow: (job) => isJobEligibleForRetry(job, nowIso),
    runJob: (job) => runSettlementReconcileJob(uid, job.id, { leaseOwner }),
    batchLimit,
    maxExamined,
  });
}
