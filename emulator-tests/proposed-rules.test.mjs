// Real Firestore Emulator verification of ../firestore.rules.proposed.
//
// The point of moving every reward-shop write behind /api/reward-shop is not
// just "the app calls the API now" — it's "the app CANNOT do it any other
// way". That second half is a rules claim, and a rules claim you haven't run
// against an emulator is a guess. So this file runs the proposal for real.
//
// It asserts BOTH directions, because either one alone is useless:
//   1. the browser can no longer write rewardInstances / rewardIdempotency,
//      not by set, not by update, not by delete, not smuggled inside a
//      transaction next to a legitimate write;
//   2. everything the app legitimately still does keeps working — the Mall's
//      onSnapshot reads, and the points / pointTransactions / redemptions /
//      products writes that the settlement, 时段目标, 娱乐加时, 结项奖励 and
//      first-login seeding paths still perform from the client today.
//
// (2) is the guard against the failure mode the user explicitly called out:
// don't lock things down so hard that working features break.
//
// NOTE: ../firestore.rules.proposed is NOT deployed and is not the live
// rules. This test proves the proposal is sound; it does not prove anything
// about what is currently running in production. See the header of that file.
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import test from "node:test";
import assert from "node:assert/strict";

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-claire-xiaoye-proposed",
    firestore: {
      rules: readFileSync("../firestore.rules.proposed", "utf8"),
      host: "127.0.0.1",
      port: 8089,
    },
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Seed as the server would (Admin SDK bypasses rules; so does this). */
const seedAsServer = (path, data) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });

/**
 * Read a document bypassing rules, to inspect true stored state.
 * withSecurityRulesDisabled resolves to void — it does NOT forward the
 * callback's return value — so the result has to be captured by closure.
 */
const readAsServer = async (path) => {
  let snapshot;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    snapshot = await getDoc(doc(ctx.firestore(), path));
  });
  return snapshot;
};

// --- the lock ---------------------------------------------------------------

test("owner CANNOT create, update or delete their own rewardInstances", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();

  // create out of thin air — this is the "mint myself a free reward" attack
  await assertFails(
    setDoc(doc(alice, "users/alice/rewardInstances/forged"), {
      itemId: "milk-tea",
      status: "owned",
      acquiredAt: Date.now(),
    })
  );

  await seedAsServer("users/alice/rewardInstances/r1", {
    itemId: "milk-tea",
    status: "used",
    usedAt: Date.now(),
  });

  // flip a used reward back to owned — the "use it twice" attack
  await assertFails(updateDoc(doc(alice, "users/alice/rewardInstances/r1"), { status: "owned" }));
  await assertFails(deleteDoc(doc(alice, "users/alice/rewardInstances/r1")));
});

test("owner CANNOT create or delete rewardIdempotency sentinels", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();

  await assertFails(
    setDoc(doc(alice, "users/alice/rewardIdempotency/wx:dm:123:redeem:milk-tea"), {
      action: "redeem_shop_item",
      createdAt: Date.now(),
    })
  );

  await seedAsServer("users/alice/rewardIdempotency/wx:dm:123:redeem:milk-tea", {
    action: "redeem_shop_item",
    result: { ok: true },
  });

  // deleting the sentinel is how you'd make one retry charge twice
  await assertFails(deleteDoc(doc(alice, "users/alice/rewardIdempotency/wx:dm:123:redeem:milk-tea")));
  await assertFails(
    updateDoc(doc(alice, "users/alice/rewardIdempotency/wx:dm:123:redeem:milk-tea"), {
      result: { ok: true, tampered: true },
    })
  );
});

test("a locked write cannot be smuggled through a transaction alongside a legal one", async () => {
  await seedAsServer("users/alice", { points: 100 });
  const alice = testEnv.authenticatedContext("alice").firestore();

  // points alone is still allowed (see the "not broken" section below), so if
  // rules were evaluated per-transaction instead of per-write, this would slip
  // the forged reward through on the back of a legitimate points update.
  await assertFails(
    runTransaction(alice, async (tx) => {
      tx.update(doc(alice, "users/alice"), { points: 90 });
      tx.set(doc(alice, "users/alice/rewardInstances/smuggled"), {
        itemId: "milk-tea",
        status: "owned",
      });
    })
  );

  // and the legitimate half must not have landed either
  const after = await readAsServer("users/alice");
  assert.equal(after.data().points, 100, "transaction must be atomic: points must not have changed");
});

test("another user and an anonymous client get nothing from the reward collections", async () => {
  await seedAsServer("users/alice/rewardInstances/r1", { itemId: "milk-tea", status: "owned" });

  const bob = testEnv.authenticatedContext("bob").firestore();
  await assertFails(getDoc(doc(bob, "users/alice/rewardInstances/r1")));
  await assertFails(setDoc(doc(bob, "users/alice/rewardInstances/r1"), { status: "owned" }));

  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, "users/alice/rewardInstances/r1")));
});

// --- the server still gets through ------------------------------------------

test("the server (Admin SDK, rules-exempt) can still write both locked collections", async () => {
  // This is the whole reason the lock is safe: rewardShopEngine.js runs under
  // the Admin SDK, which is not subject to rules at all. Locking the client
  // out of these collections must not lock the engine out of them.
  await seedAsServer("users/alice/rewardInstances/r1", { itemId: "milk-tea", status: "owned" });
  await seedAsServer("users/alice/rewardIdempotency/k1", { action: "redeem_shop_item" });

  assert.equal((await readAsServer("users/alice/rewardInstances/r1")).data().status, "owned");
  assert.equal((await readAsServer("users/alice/rewardIdempotency/k1")).data().action, "redeem_shop_item");
});

// --- nothing that works today stops working ---------------------------------

test("the Mall can still READ rewardInstances, including live via onSnapshot", async () => {
  await seedAsServer("users/alice/rewardInstances/r1", { itemId: "milk-tea", status: "owned" });
  const alice = testEnv.authenticatedContext("alice").firestore();

  await assertSucceeds(getDoc(doc(alice, "users/alice/rewardInstances/r1")));

  // the Mall subscribes rather than polls; a read rule that only satisfies
  // getDoc but trips a listener would still break the page.
  const snapshot = await new Promise((resolve, reject) => {
    const stop = onSnapshot(
      doc(alice, "users/alice/rewardInstances/r1"),
      (snap) => {
        stop();
        resolve(snap);
      },
      (error) => {
        stop();
        reject(error);
      }
    );
  });
  assert.equal(snapshot.data().itemId, "milk-tea");
});

test("owner can still read rewardIdempotency (needed to resolve a retried redeem)", async () => {
  await seedAsServer("users/alice/rewardIdempotency/k1", { action: "redeem_shop_item" });
  const alice = testEnv.authenticatedContext("alice").firestore();
  await assertSucceeds(getDoc(doc(alice, "users/alice/rewardIdempotency/k1")));
});

test("the non-shop client writes the app still depends on are untouched", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();

  // ensureUserSeed() — first-login starter shelf
  await assertSucceeds(setDoc(doc(alice, "users/alice"), { points: 0, rewardTotalEarned: 0 }));
  await assertSucceeds(setDoc(doc(alice, "users/alice/products/p1"), { name: "奶茶", cost: 30 }));

  // saveSettlement() / completeScheduleSegmentGoal() — points + ledger row
  await assertSucceeds(updateDoc(doc(alice, "users/alice"), { points: 30, rewardTotalEarned: 30 }));
  await assertSucceeds(
    setDoc(doc(alice, "users/alice/pointTransactions/t1"), { delta: 30, reason: "settlement" })
  );

  // redeemEntertainmentExtension() / saveProjectRewardApplication() — redemptions
  await assertSucceeds(
    setDoc(doc(alice, "users/alice/redemptions/x1"), { kind: "entertainment_extension", cost: 10 })
  );

  // deleteLatestSettlement() / rollbackSettlementsTo() — deletes still allowed
  await assertSucceeds(deleteDoc(doc(alice, "users/alice/pointTransactions/t1")));
});

test("the exclusion is scoped to exactly two collections and nothing else", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();

  // The catch-all is what grants these; if the exclusion were written too
  // broadly (e.g. a prefix match on "reward") it would take them out too.
  // trackerReconcileJobs / completionEvents are the Phase 2.5 collections the
  // baseline emulator.test.mjs covers under test.rules — they must survive
  // this proposal unchanged.
  await assertSucceeds(
    setDoc(doc(alice, "users/alice/trackerReconcileJobs/s1:0"), { settlementId: "s1", status: "pending" })
  );
  await assertSucceeds(
    setDoc(doc(alice, "users/alice/completionEvents/evt1"), { trackerId: "t1", state: "active" })
  );
  // a collection whose name merely starts with the same word
  await assertSucceeds(setDoc(doc(alice, "users/alice/rewardRules/cfg"), { dailyCap: 3 }));
});

test("the lock survives a deeper nested path, not just the top document", async () => {
  const alice = testEnv.authenticatedContext("alice").firestore();
  // document[0] is the sub-collection segment, so anything below it is
  // covered too — no writing into a sub-collection of a locked instance.
  await assertFails(
    setDoc(doc(alice, "users/alice/rewardInstances/r1/audit/a1"), { note: "forged" })
  );
});

test("a settlement-shaped multi-write transaction still commits atomically", async () => {
  await seedAsServer("users/alice", { points: 100 });
  const alice = testEnv.authenticatedContext("alice").firestore();

  // This is the shape the header of firestore.rules.proposed argues we must
  // not break: profile points + the settlement doc + its ledger row, one
  // atomic commit, all from the client.
  await assertSucceeds(
    runTransaction(alice, async (tx) => {
      tx.update(doc(alice, "users/alice"), { points: 130 });
      tx.set(doc(alice, "users/alice/settlements/s1"), { date: "2026-08-04", earned: 30 });
      tx.set(doc(alice, "users/alice/pointTransactions/t1"), { delta: 30, reason: "settlement" });
    })
  );

  const after = await readAsServer("users/alice");
  assert.equal(after.data().points, 130);
});
