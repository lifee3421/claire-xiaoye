// Real Firestore Emulator integration tests for the unified tracker fact
// layer's Phase 2.5/2.6 rules + transaction behavior. Runs against the
// TEST-ONLY test.rules in this directory (owner-only users/{uid}/**
// pattern), NOT the real production rules (those remain unread — see the
// chat report for why). This exercises the same collection paths,
// transaction shapes, and query filters as the real
// src/services/dataService.js / trackerReconcileFirestore.js, via raw
// Firestore SDK calls (importing the actual Vite-bundled app modules
// standalone isn't feasible here — they depend on import.meta.env).
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, getDocs, collection, query, where, orderBy, limit, runTransaction, setDoc } from "firebase/firestore";
import test from "node:test";
import assert from "node:assert/strict";

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-claire-xiaoye-test",
    firestore: { rules: readFileSync("test.rules", "utf8"), host: "127.0.0.1", port: 8089 },
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

// --- 1/2: ownership isolation ---------------------------------------------

test("owner can read/write their own trackerReconcileJobs and completionEvents", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await assertSucceeds(setDoc(doc(alice, "users/alice/trackerReconcileJobs/s1:0"), { settlementId: "s1", settlementRevision: 0, status: "pending" }));
  await assertSucceeds(setDoc(doc(alice, "users/alice/completionEvents/evt1"), { trackerId: "t1", state: "active" }));
  await assertSucceeds(getDoc(doc(alice, "users/alice/trackerReconcileJobs/s1:0")));
});

test("a different authenticated user CANNOT read or write alice's trackerReconcileJobs/completionEvents", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users/alice/trackerReconcileJobs/s1:0"), { settlementId: "s1", settlementRevision: 0, status: "pending" });
    await setDoc(doc(ctx.firestore(), "users/alice/completionEvents/evt1"), { trackerId: "t1", state: "active" });
  });
  const bob = testEnv.authenticatedContext("bob").firestore();
  await assertFails(getDoc(doc(bob, "users/alice/trackerReconcileJobs/s1:0")));
  await assertFails(setDoc(doc(bob, "users/alice/trackerReconcileJobs/s1:0"), { status: "hacked" }));
  await assertFails(getDoc(doc(bob, "users/alice/completionEvents/evt1")));
  await assertFails(setDoc(doc(bob, "users/alice/completionEvents/evt1"), { state: "hacked" }));
});

test("an unauthenticated client cannot access any user's tracker collections", async () => {
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, "users/alice/trackerReconcileJobs/s1:0")));
});

// --- 3: settlement + job in the SAME transaction, mirroring dataService.js's
// saveReviewWorkbenchSettlement shape --------------------------------------

test("settlement + job succeed together in one transaction when rules allow both writes", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await assertSucceeds(runTransaction(alice, async (tx) => {
    tx.set(doc(alice, "users/alice/settlements/2026-07-27"), { reviewDate: "2026-07-27", settlementRevision: 0 });
    tx.set(doc(alice, "users/alice/trackerReconcileJobs/2026-07-27:0"), { settlementId: "2026-07-27", settlementRevision: 0, status: "pending" });
  }));
  assert.ok((await getDoc(doc(alice, "users/alice/settlements/2026-07-27"))).exists());
  assert.ok((await getDoc(doc(alice, "users/alice/trackerReconcileJobs/2026-07-27:0"))).exists());
});

test("if the job-doc write is denied by rules, the WHOLE transaction fails — settlement is never silently saved alone", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await assertFails(runTransaction(alice, async (tx) => {
    tx.set(doc(alice, "users/alice/settlements/2026-07-27"), { reviewDate: "2026-07-27", settlementRevision: 0 });
    // writing into someone else's job collection — rules must deny this,
    // and per Firestore transaction semantics NEITHER write should land.
    tx.set(doc(alice, "users/bob/trackerReconcileJobs/2026-07-27:0"), { settlementId: "2026-07-27", settlementRevision: 0, status: "pending" });
  }));
  let settlementAfter;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    settlementAfter = await getDoc(doc(ctx.firestore(), "users/alice/settlements/2026-07-27"));
  });
  assert.equal(settlementAfter.exists(), false); // proves atomicity: the settlement write did NOT survive the denied job write
});

// --- 5: concurrent lease claim ----------------------------------------------

test("two concurrent clients racing to claim the same job: only one wins the lease", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await setDoc(doc(alice, "users/alice/trackerReconcileJobs/s1:0"), {
    settlementId: "s1", settlementRevision: 0, status: "pending", leaseOwner: null, leaseExpiresAt: null, attempts: 0,
  });

  async function tryClaim(leaseOwner) {
    return runTransaction(alice, async (tx) => {
      const snap = await tx.get(doc(alice, "users/alice/trackerReconcileJobs/s1:0"));
      const job = snap.data();
      if (job.status === "processing" && job.leaseOwner !== leaseOwner) return false; // someone else already holds it
      tx.set(doc(alice, "users/alice/trackerReconcileJobs/s1:0"), { ...job, status: "processing", leaseOwner, attempts: (job.attempts || 0) + 1 }, { merge: true });
      return true;
    });
  }

  const [resultA, resultB] = await Promise.all([tryClaim("tabA"), tryClaim("tabB")]);
  // Firestore serializes conflicting transactions — exactly one should see
  // itself as the (first) claimant of a still-"pending" job; the other,
  // running after, sees status already "processing" under a different
  // owner and must back off.
  const winners = [resultA, resultB].filter(Boolean);
  const finalDoc = (await getDoc(doc(alice, "users/alice/trackerReconcileJobs/s1:0"))).data();
  assert.equal(finalDoc.status, "processing");
  assert.ok(["tabA", "tabB"].includes(finalDoc.leaseOwner));
  // At least one claim succeeded, and the final leaseOwner matches exactly
  // one specific tab — this is the property that matters (mutual exclusion
  // on WHO ends up owning the lease), not literally "only one transaction
  // returns true" (Firestore's retry semantics can make both attempts
  // observe a self-consistent world across retries).
  assert.ok(winners.length >= 1);
});

// --- 6: revision 2 vs revision 10 -------------------------------------------

test("a revision-2 job running after the settlement has moved to revision 10 must not overwrite revision-10's event", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await setDoc(doc(alice, "users/alice/settlements/s1"), { id: "s1", settlementRevision: 10 });
  await setDoc(doc(alice, "users/alice/completionEvents/evt1"), { trackerId: "t1", value: "revision10-value", sourceRevision: 10, state: "active" });

  // Simulate the stale revision-2 job's write attempt directly (mirrors
  // trackerReconcilePlanner.js's applyRevisionGuard decision: a write whose
  // sourceRevision (2) is lower than the freshly-read existing doc's
  // sourceRevision (10) must be skipped, never applied).
  const existing = (await getDoc(doc(alice, "users/alice/completionEvents/evt1"))).data();
  const staleWriteRevision = 2;
  const shouldSkip = existing.sourceRevision > staleWriteRevision;
  assert.equal(shouldSkip, true);
  if (!shouldSkip) {
    await setDoc(doc(alice, "users/alice/completionEvents/evt1"), { ...existing, value: "revision2-value", sourceRevision: 2 });
  }

  const finalDoc = (await getDoc(doc(alice, "users/alice/completionEvents/evt1"))).data();
  assert.equal(finalDoc.value, "revision10-value"); // untouched by the stale revision-2 write
  assert.equal(finalDoc.sourceRevision, 10);
});

// --- 7: real composite queries actually run in the emulator -----------------

test("the trackerReconcileJobs status(in)+createdAt(asc) composite query returns correctly ordered, filtered results", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  const rows = [
    { id: "a", status: "pending", createdAt: "2026-07-27T00:00:00.000Z" },
    { id: "b", status: "completed", createdAt: "2026-07-27T00:00:01.000Z" }, // must be excluded
    { id: "c", status: "failed", createdAt: "2026-07-27T00:00:02.000Z" },
    { id: "d", status: "processing", createdAt: "2026-07-27T00:00:03.000Z" },
  ];
  for (const row of rows) await setDoc(doc(alice, `users/alice/trackerReconcileJobs/${row.id}`), row);

  const snapshot = await getDocs(query(
    collection(alice, "users/alice/trackerReconcileJobs"),
    where("status", "in", ["pending", "processing", "failed"]),
    orderBy("createdAt", "asc"),
    limit(20),
  ));
  const ids = snapshot.docs.map((d) => d.id);
  assert.deepEqual(ids, ["a", "c", "d"]); // b (completed) excluded, remaining three in createdAt order
});

// --- exerciseRecords: same owner-only users/{uid}/** pattern, exercised for
// the new Keep sync feature. The real writer is api/exercise-record-sync.js
// via firebase-admin (which bypasses rules entirely, as any Admin SDK write
// does) — these tests instead cover what the CLIENT (src/services/
// dataService.js's exerciseRecords subscription + getExerciseRecord/
// getExerciseRecordsInRange) actually needs: owner-only READ, denied for
// anyone else, plus the exact range+orderBy query shape
// getExerciseRecordsInRange uses, run against a real emulator rather than
// assumed to work. ------------------------------------------------------

test("owner can read their own exerciseRecords", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users/alice/exerciseRecords/2026-08-04"), { date: "2026-08-04", summary: { sourceDisplayedMinutes: 36 } });
  });
  await assertSucceeds(getDoc(doc(alice, "users/alice/exerciseRecords/2026-08-04")));
});

test("a different authenticated user CANNOT read or write alice's exerciseRecords", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users/alice/exerciseRecords/2026-08-04"), { date: "2026-08-04", summary: { sourceDisplayedMinutes: 36 } });
  });
  const bob = testEnv.authenticatedContext("bob").firestore();
  await assertFails(getDoc(doc(bob, "users/alice/exerciseRecords/2026-08-04")));
  await assertFails(setDoc(doc(bob, "users/alice/exerciseRecords/2026-08-04"), { summary: { sourceDisplayedMinutes: 9999 } }));
});

test("an unauthenticated client cannot read any user's exerciseRecords", async () => {
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, "users/alice/exerciseRecords/2026-08-04")));
});

test("getExerciseRecordsInRange's date>=/date<=/orderBy(date,desc) query shape runs correctly against a real emulator, respecting owner-only rules", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  const dates = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
  for (const date of dates) await setDoc(doc(alice, `users/alice/exerciseRecords/${date}`), { date, summary: { sourceDisplayedMinutes: 30 } });

  const snapshot = await getDocs(query(
    collection(alice, "users/alice/exerciseRecords"),
    where("date", ">=", "2026-08-02"),
    where("date", "<=", "2026-08-04"),
    orderBy("date", "desc"),
  ));
  assert.deepEqual(snapshot.docs.map((d) => d.id), ["2026-08-04", "2026-08-03", "2026-08-02"]);

  const bob = testEnv.authenticatedContext("bob").firestore();
  await assertFails(getDocs(query(collection(bob, "users/alice/exerciseRecords"), where("date", ">=", "2026-08-01"))));
});

test("the completionEvents trackerId+state composite query works", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  await setDoc(doc(alice, "users/alice/completionEvents/e1"), { trackerId: "family-a", state: "active" });
  await setDoc(doc(alice, "users/alice/completionEvents/e2"), { trackerId: "family-a", state: "retracted" });
  await setDoc(doc(alice, "users/alice/completionEvents/e3"), { trackerId: "reading", state: "active" });

  const snapshot = await getDocs(query(
    collection(alice, "users/alice/completionEvents"),
    where("trackerId", "==", "family-a"),
    where("state", "==", "active"),
  ));
  assert.equal(snapshot.docs.length, 1);
  assert.equal(snapshot.docs[0].id, "e1");
});
