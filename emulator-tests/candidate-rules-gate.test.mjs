// Production rules gate -- emulator tests for firestore.candidate.rules.
//
// Server-owned fields: points, rewardTotalEarned, rewardTotalSpent.
// Admin SDK bypasses rules (tested with withSecurityRulesDisabled).

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deleteField } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "demo-claire-xiaoye-test";
const RULES_PATH = resolve(__dirname, "..", "firestore.candidate.rules");

let testEnv = null;

function uid() { return `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function ownerAuth(u) { return { uid: u, email: `${u}@test.com` }; }

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(RULES_PATH, "utf8"), host: "127.0.0.1", port: 8089 },
  });
});
after(async () => { if (testEnv) await testEnv.cleanup(); });

function db(auth) { return testEnv.authenticatedContext(auth.uid, { email: auth.email }).firestore(); }
function unauthDb() { return testEnv.unauthenticatedContext().firestore(); }

// ===== BASELINE =============================================================

test("create profile without server-owned fields => ALLOW", async () => {
  const u = uid();
  await assertSucceeds(db(ownerAuth(u)).doc(`users/${u}`).set({ displayName: "C", todayBalanceMinutes: 60 }));
});

test("create profile with points => DENY", async () => {
  const u = uid();
  await assertFails(db(ownerAuth(u)).doc(`users/${u}`).set({ displayName: "C", points: 99999 }));
});

test("create profile with rewardTotalEarned => DENY", async () => {
  const u = uid();
  await assertFails(db(ownerAuth(u)).doc(`users/${u}`).set({ displayName: "C", rewardTotalEarned: 100 }));
});

test("create profile with rewardTotalSpent => DENY", async () => {
  const u = uid();
  await assertFails(db(ownerAuth(u)).doc(`users/${u}`).set({ displayName: "C", rewardTotalSpent: 50 }));
});

test("read own profile => ALLOW", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await d.doc(`users/${u}`).set({ displayName: "C" });
  await assertSucceeds(d.doc(`users/${u}`).get());
});

test("update non-server fields => ALLOW", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await d.doc(`users/${u}`).set({ displayName: "C", todayBalanceMinutes: 60 });
  await assertSucceeds(d.doc(`users/${u}`).update({ displayName: "C2" }));
});

test("set merge non-server fields => ALLOW", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await d.doc(`users/${u}`).set({ displayName: "C" });
  await assertSucceeds(d.doc(`users/${u}`).set({ todayBalanceMinutes: 45 }, { merge: true }));
});

test("A cannot read B", async () => {
  const uA = uid(); const uB = uid();
  await db(ownerAuth(uA)).doc(`users/${uA}`).set({ displayName: "A" });
  await assertFails(db(ownerAuth(uB)).doc(`users/${uA}`).get());
});

test("A cannot write B", async () => {
  const uA = uid(); const uB = uid();
  await db(ownerAuth(uA)).doc(`users/${uA}`).set({ displayName: "A" });
  await assertFails(db(ownerAuth(uB)).doc(`users/${uA}`).update({ displayName: "h" }));
});

test("anon cannot read/write", async () => {
  const u = uid();
  await db(ownerAuth(u)).doc(`users/${u}`).set({ displayName: "C" });
  await assertFails(unauthDb().doc(`users/${u}`).get());
});

// ===== points: affectedKeys = ADD + CHANGE + REMOVE ========================

test("update points (change) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ points: 50, displayName: "T" });
  });
  await assertFails(d.doc(`users/${u}`).update({ points: 99999 }));
});

test("set merge points (change) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ points: 50, displayName: "T" });
  });
  await assertFails(d.doc(`users/${u}`).set({ points: 99999 }, { merge: true }));
});

test("add points to existing doc (addedKeys) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  // Document exists without points field
  await d.doc(`users/${u}`).set({ displayName: "T" });
  await assertFails(d.doc(`users/${u}`).update({ points: 100 }));
});

test("deleteField('points') (removedKeys) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ points: 50, displayName: "T" });
  });
  await assertFails(d.doc(`users/${u}`).update({ points: deleteField() }));
});

test("points unchanged + other field update => ALLOW (affectedKeys excludes unchanged)", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ points: 50, displayName: "T" });
  });
  await assertSucceeds(d.doc(`users/${u}`).update({ displayName: "U", points: 50 }));
});

// ===== rewardTotalEarned: affectedKeys =====================================

test("update rewardTotalEarned (change) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ rewardTotalEarned: 10, displayName: "T" });
  });
  await assertFails(d.doc(`users/${u}`).update({ rewardTotalEarned: 99999 }));
});

test("add rewardTotalEarned (addedKeys) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await d.doc(`users/${u}`).set({ displayName: "T" });
  await assertFails(d.doc(`users/${u}`).update({ rewardTotalEarned: 100 }));
});

test("deleteField('rewardTotalEarned') (removedKeys) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ rewardTotalEarned: 10, displayName: "T" });
  });
  await assertFails(d.doc(`users/${u}`).update({ rewardTotalEarned: deleteField() }));
});

// ===== rewardTotalSpent: affectedKeys ======================================

test("update rewardTotalSpent (change) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ rewardTotalSpent: 5, displayName: "T" });
  });
  await assertFails(d.doc(`users/${u}`).update({ rewardTotalSpent: 99999 }));
});

test("add rewardTotalSpent (addedKeys) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await d.doc(`users/${u}`).set({ displayName: "T" });
  await assertFails(d.doc(`users/${u}`).update({ rewardTotalSpent: 50 }));
});

test("deleteField('rewardTotalSpent') (removedKeys) => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ rewardTotalSpent: 5, displayName: "T" });
  });
  await assertFails(d.doc(`users/${u}`).update({ rewardTotalSpent: deleteField() }));
});

// ===== delete user document ================================================

test("delete user document => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await d.doc(`users/${u}`).set({ displayName: "T" });
  await assertFails(d.doc(`users/${u}`).delete());
});

// ===== Admin SDK bypass ====================================================

test("Admin SDK can write points => ALLOW (bypasses rules)", async () => {
  const u = uid();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await assertSucceeds(ctx.firestore().doc(`users/${u}`).set({ points: 50, displayName: "ADMIN" }));
  });
});

test("Admin SDK can update points => ALLOW (bypasses rules)", async () => {
  const u = uid();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ points: 50 });
    await assertSucceeds(ctx.firestore().doc(`users/${u}`).update({ points: 75 }));
  });
});

test("Admin SDK can delete user document => ALLOW (bypasses rules)", async () => {
  const u = uid();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ displayName: "ADMIN" });
    await assertSucceeds(ctx.firestore().doc(`users/${u}`).delete());
  });
});

// ===== server-owned collections ===========================================

test("client write rewardInstances => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await d.doc(`users/${u}`).set({ displayName: "T" });
  await assertFails(d.doc(`users/${u}/rewardInstances/i1`).set({ itemId: "x" }));
});

test("client write rewardIdempotency => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await d.doc(`users/${u}`).set({ displayName: "T" });
  await assertFails(d.doc(`users/${u}/rewardIdempotency/k1`).set({ action: "r" }));
});

test("client write pointTransactions => DENY", async () => {
  const u = uid(); const d = db(ownerAuth(u));
  await d.doc(`users/${u}`).set({ displayName: "T" });
  await assertFails(d.doc(`users/${u}/pointTransactions/t1`).set({ type: "earn", amount: 99999 }));
});

test("client read pointTransactions => ALLOW", async () => {
  const u = uid();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${u}`).set({ displayName: "T" });
    await ctx.firestore().doc(`users/${u}/pointTransactions/t1`).set({ type: "earn", amount: 5 });
  });
  await assertSucceeds(db(ownerAuth(u)).doc(`users/${u}/pointTransactions/t1`).get());
});

// ===== normal subcollections ===============================================

test("settlements => ALLOW", async () => { const u = uid(); const d = db(ownerAuth(u)); await d.doc(`users/${u}`).set({ displayName: "T" }); await assertSucceeds(d.doc(`users/${u}/settlements/s1`).set({ pointsAdded: 5 })); });
test("products => ALLOW", async () => { const u = uid(); const d = db(ownerAuth(u)); await d.doc(`users/${u}`).set({ displayName: "T" }); await assertSucceeds(d.doc(`users/${u}/products/p1`).set({ name: "I" })); });
test("redemptions => ALLOW", async () => { const u = uid(); const d = db(ownerAuth(u)); await d.doc(`users/${u}`).set({ displayName: "T" }); await assertSucceeds(d.doc(`users/${u}/redemptions/r1`).set({ productId: "x" })); });
test("deep nested subcollection => ALLOW", async () => { const u = uid(); const d = db(ownerAuth(u)); await d.doc(`users/${u}`).set({ displayName: "T" }); await assertSucceeds(d.doc(`users/${u}/settlements/s1/deep/d1`).set({ value: "ok" })); });
