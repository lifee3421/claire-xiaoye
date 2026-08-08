import test from "node:test";
import assert from "node:assert/strict";
import { handleExerciseRecordSyncRequest, default as handler, config } from "./exercise-record-sync.js";
import { makeAdminFirestoreFake } from "../src/server/__test_mocks__/adminFirestoreFake.js";
import { buildCompletionEventId } from "../src/services/completionEvents.js";

const uid = "test-uid";
const now = new Date("2026-08-08T10:00:00.000Z");

function keepPayload(overrides = {}) {
  return {
    date: "2026-08-08",
    timezone: "Asia/Shanghai",
    summary: { sourceDisplayedMinutes: 36, calories: 250, sessionCount: 2 },
    sessions: [
      { title: "燃脂派对 第1次", durationSeconds: 900, calories: 80, displayTime: "17:30" },
      { title: "燃脂派对 第2次", durationSeconds: 1260, calories: 170, displayTime: "17:46" },
    ],
    source: { sourceSnapshotHash: "hash-test-abc" },
    schemaVersion: 1,
    ...overrides,
  };
}

// Minimal normalized payload (skips validation — tests call the core function directly).
function normalizedPayload(overrides = {}) {
  const base = keepPayload(overrides);
  return {
    ...base,
    sessions: base.sessions.map((s, i) => ({ ...s, id: `keep-${i + 1}` })),
  };
}

test("module exports: handler default, config, and testable handleExerciseRecordSyncRequest", () => {
  assert.equal(typeof handler, "function");
  assert.deepEqual(config, { api: { bodyParser: false } });
  assert.equal(typeof handleExerciseRecordSyncRequest, "function");
});

// ─── Test 1: Atomic transaction ──────────────────────────────────────────────
// Verifies that exerciseRecord + durable reconcile job are written in the SAME
// Firestore transaction: if the transaction throws, NEITHER document is
// committed. This is the key safety property — a half-written state (record
// without a job, or job without a record) must never exist.
test("T1: transaction failure leaves neither exerciseRecord nor reconcile job in the store", async () => {
  let transactionCallCount = 0;
  const throwingDb = {
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return {
            collection(sub) { return throwingDb.collection(`${path}/${sub}`); },
            async get() { return { exists: false, data: () => undefined, id }; },
            async set() { throw new Error("simulated set outside transaction"); },
          };
        },
      };
    },
    async runTransaction() {
      transactionCallCount++;
      throw new Error("simulated Firestore transaction failure");
    },
  };

  const normalized = normalizedPayload();
  await assert.rejects(
    () => handleExerciseRecordSyncRequest({ db: throwingDb, uid, normalized, now }),
    /simulated Firestore transaction failure/,
  );

  assert.equal(transactionCallCount, 1, "transaction was attempted exactly once");
  // The throwing runTransaction guarantees nothing was written — there is no
  // partial state to inspect in a fake store; the assertion is that the call
  // throws rather than returning a partial result.
});

// ─── Test 2: Immediate reconcile success ─────────────────────────────────────
// Verifies the happy path: transaction commits exerciseRecord + job as "pending",
// then the best-effort immediate reconcile runs, writes the CompletionEvent,
// and marks the job "completed" — all before the sync response is returned.
test("T2: successful immediate reconcile writes CompletionEvent and marks job completed", async () => {
  // Seed an empty user profile — resolveEffectiveTrackers({}) provides the
  // default exercise-complete tracker with its exerciseRecord binding (v4).
  const { db, store } = makeAdminFirestoreFake({ [`users/${uid}`]: {} });
  const normalized = normalizedPayload();

  const result = await handleExerciseRecordSyncRequest({ db, uid, normalized, now });

  assert.equal(result.status, "created");
  assert.equal(result.totalMinutes, 36);

  // exerciseRecord and draftRef were both written by the transaction.
  const recordPath = `users/${uid}/exerciseRecords/${normalized.date}`;
  assert.ok(store.has(recordPath), "exerciseRecord doc was written");
  assert.equal(store.get(recordPath).date, normalized.date);
  assert.equal(store.get(recordPath).summary.sourceDisplayedMinutes, 36);

  // Job was committed as "pending" first, then immediately updated to "completed".
  const jobPath = `users/${uid}/trackerReconcileJobs/exerciseRecord:${normalized.date}`;
  assert.ok(store.has(jobPath), "reconcile job doc was written");
  assert.equal(store.get(jobPath).status, "completed",
    "immediate reconcile succeeded → job should be completed, not pending");
  assert.equal(store.get(jobPath).type, "exerciseRecord");
  assert.equal(store.get(jobPath).date, normalized.date);

  // The CompletionEvent for exercise-complete was written by the immediate reconcile.
  const expectedEventId = await buildCompletionEventId(
    "exercise-complete", normalized.date, "summary.sourceDisplayedMinutes", "exerciseRecord",
  );
  const eventPath = `users/${uid}/completionEvents/${expectedEventId}`;
  assert.ok(store.has(eventPath), "CompletionEvent was written by the immediate reconcile");
  const event = store.get(eventPath);
  assert.equal(event.trackerId, "exercise-complete");
  assert.equal(event.occurredOn, normalized.date);
  assert.equal(event.sourceType, "exerciseRecord");
  assert.equal(event.value, 36);
  assert.equal(event.sourceRevision, 0);
  assert.equal(event.state, "active");
});

// ─── Test 3: Immediate reconcile failure → job stays pending ─────────────────
// Verifies the fallback path: when the best-effort immediate reconcile throws
// (simulated here by a db.get() error on the user profile read), the durable
// job STAYS "pending" — it is never silently swallowed. The pending job is
// then available for the client-side retryPendingReconcileJobsForUser sweep to
// pick up and retry.
//
// The sweep path (runExerciseRecordReconcileJob in trackerReconcileFirestore.js)
// executes the same evidence-extraction + CompletionEvent upsert logic as the
// immediate reconcile above; its CompletionEvent-exactly-once guarantee is
// provided by the upsert idempotency of reconcileExerciseRecordEvidence
// (tested in src/services/completionEvents.test.js).
test("T3: immediate reconcile failure leaves durable job pending for client sweep", async () => {
  // throwOnDocGet on the profile path causes the immediate reconcile to throw
  // right at the profile read — before any CompletionEvent is written.
  const { db, store } = makeAdminFirestoreFake(
    { [`users/${uid}`]: {} },
    { throwOnDocGet: new Set([`users/${uid}`]) },
  );
  const normalized = normalizedPayload();

  // The handler itself must NOT throw — reconcile failure is swallowed so
  // the sync response is still 200.
  const result = await handleExerciseRecordSyncRequest({ db, uid, normalized, now });
  assert.equal(result.status, "created");

  // exerciseRecord was committed by the transaction before the reconcile failed.
  const recordPath = `users/${uid}/exerciseRecords/${normalized.date}`;
  assert.ok(store.has(recordPath), "exerciseRecord doc was written by the transaction");

  // Job was committed as "pending" in the transaction and STAYS "pending"
  // because the reconcile failed — never advanced to "completed".
  const jobPath = `users/${uid}/trackerReconcileJobs/exerciseRecord:${normalized.date}`;
  assert.ok(store.has(jobPath), "reconcile job doc was written by the transaction");
  assert.equal(store.get(jobPath).status, "pending",
    "reconcile failure must leave job pending for client sweep, not complete or delete it");

  // No CompletionEvent was written (reconcile didn't get that far).
  const completionEventsPrefix = `users/${uid}/completionEvents/`;
  const eventKeys = [...store.keys()].filter((k) => k.startsWith(completionEventsPrefix));
  assert.equal(eventKeys.length, 0, "no CompletionEvent written when reconcile fails");
});
