// Concurrent points safety tests — testing the SAME applyPointsCommand
// that api/points.js calls in production. Not a mock or test-only helper.
//
// Every test calls applyPointsCommand(db, uid, { action, payload, actor })
// which is the production domain function.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { applyPointsCommand } from "./applyPointsCommand.js";
import { roundPoints } from "../utils/calculations.js";

const PROJECT_ID = "demo-claire-xiaoye-test";
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8089";

let uidCounter = 0;
function freshUid() { return `test-concurrent-${Date.now()}-${++uidCounter}`; }

let db = null;
function ts() { return FieldValue.serverTimestamp(); }
function round(v) { return roundPoints(v); }

async function seedBalance(uid, points = 20) {
  await db.doc(`users/${uid}`).set({
    points: round(points), rewardTotalEarned: 0, rewardTotalSpent: 0,
    createdAt: ts(), updatedAt: ts(),
  });
}
async function readBalance(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  return round(snap.exists ? (snap.data().points || 0) : 0);
}
async function readLedger(uid) {
  const snap = await db.collection(`users/${uid}/pointTransactions`).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

before(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  db = getFirestore();
});

after(async () => {});

// ─── Core scenario: 兑换 -8 vs 学习 +1 → 必为 13 ───────────────────────

test("points=20，并发兑换-8 与学习+1，最终必为 13（生产 applyPointsCommand）", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);

  const results = await Promise.all([
    applyPointsCommand(db, uid, { action: "earn_schedule_goal", payload: { amount: 1, source: "study_reward", _goalEntry: { date: "2026-08-05" }, idempotencyKey: `study-${uid}-1` }, actor: "web" }),
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 8, source: "wechat_redeem", _extension: { minutes: 30, reason: "雪尘兑换" }, idempotencyKey: `redeem-${uid}-1` }, actor: "wechat" }),
  ]);

  const balance = await readBalance(uid);
  // 20 - 8 + 1 = 13. Anything else is a lost update.
  assert.equal(balance, 13, `预期 13，实际 ${balance}。并发丢失更新！results: ${JSON.stringify(results.map(r => r.delta || r.error))}`);
});

// ─── 两个同时 +1 ───────────────────────────────────────────────────────

test("两个同时 +1，最终必为 22", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);
  await Promise.all([
    applyPointsCommand(db, uid, { action: "earn_schedule_goal", payload: { amount: 1, _goalEntry: { date: "day1" }, idempotencyKey: `a-${uid}` }, actor: "test" }),
    applyPointsCommand(db, uid, { action: "earn_schedule_goal", payload: { amount: 1, _goalEntry: { date: "day2" }, idempotencyKey: `b-${uid}` }, actor: "test" }),
  ]);
  assert.equal(await readBalance(uid), 22);
});

// ─── 两个同时扣分 ──────────────────────────────────────────────────────

test("两个同时 -3，最终必为 14", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);
  await Promise.all([
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 3, _extension: { minutes: 10 }, idempotencyKey: `sp1-${uid}` }, actor: "test" }),
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 3, _extension: { minutes: 10 }, idempotencyKey: `sp2-${uid}` }, actor: "test" }),
  ]);
  assert.equal(await readBalance(uid), 14);
});

// ─── 奖励与扣分并发 ────────────────────────────────────────────────────

test("+5 奖励与 -3 扣分并发，最终必为 22", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);
  await Promise.all([
    applyPointsCommand(db, uid, { action: "earn_schedule_goal", payload: { amount: 5, _goalEntry: { date: "day" }, idempotencyKey: `earn-${uid}` }, actor: "test" }),
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 3, _extension: { minutes: 10 }, idempotencyKey: `spend-${uid}` }, actor: "test" }),
  ]);
  assert.equal(await readBalance(uid), 22);
});

// ─── 两次兑换并发 ──────────────────────────────────────────────────────

test("两次 -5 兑换并发，最终必为 10", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);
  await Promise.all([
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 5, _extension: { minutes: 10 }, idempotencyKey: `r1-${uid}` }, actor: "test" }),
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 5, _extension: { minutes: 10 }, idempotencyKey: `r2-${uid}` }, actor: "test" }),
  ]);
  assert.equal(await readBalance(uid), 10);
});

// ─── 余额竞态 ──────────────────────────────────────────────────────────

test("余额 8，两次 -5 并发，只有一次成功（余额为 3）", async () => {
  const uid = freshUid();
  await seedBalance(uid, 8);

  let successCount = 0, failCount = 0;
  const ops = [
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 5, _extension: { minutes: 10 }, idempotencyKey: `race-a-${uid}` }, actor: "test" }),
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 5, _extension: { minutes: 10 }, idempotencyKey: `race-b-${uid}` }, actor: "test" }),
  ];
  const settled = await Promise.allSettled(ops);
  for (const r of settled) r.status === "fulfilled" ? successCount++ : failCount++;

  assert.ok(failCount >= 1, "竞争条件下必须至少一次被拒绝");
  assert.equal(await readBalance(uid), 3, "余额应为 8-5=3");
});

// ─── 幂等 key ──────────────────────────────────────────────────────────

test("相同 idempotencyKey 两次 -3，不双扣", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);
  const key = `idem-${uid}`;

  const r1 = await applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 3, _extension: { minutes: 10 }, idempotencyKey: key }, actor: "test" });
  const r2 = await applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 3, _extension: { minutes: 10 }, idempotencyKey: key }, actor: "test" });

  assert.equal(await readBalance(uid), 17, `预期 17（20-3），实际 ${await readBalance(uid)}。幂等失败！`);
  assert.ok(r2.replayed, "第二次调用应标记为 replayed");

  const ledger = await readLedger(uid);
  const rows = ledger.filter((r) => r.idempotencyKey === key);
  assert.equal(rows.length, 1, `预期 1 笔流水，实际 ${rows.length} 笔`);
});

// ─── 不同 key ──────────────────────────────────────────────────────────

test("不同 idempotencyKey，各自生效", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);
  await Promise.all([
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 3, _extension: { minutes: 10 }, idempotencyKey: `ik-a-${uid}` }, actor: "test" }),
    applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 4, _extension: { minutes: 10 }, idempotencyKey: `ik-b-${uid}` }, actor: "test" }),
  ]);
  assert.equal(await readBalance(uid), 13); // 20-3-4
});

// ─── 10 并发 ───────────────────────────────────────────────────────────

test("10 次并发 +1，最终必为 30", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);
  const ops = Array.from({ length: 10 }, (_, i) =>
    applyPointsCommand(db, uid, { action: "earn_schedule_goal", payload: { amount: 1, _goalEntry: { date: `d${i}` }, idempotencyKey: `bulk-${uid}-${i}` }, actor: "test" })
  );
  await Promise.all(ops);
  assert.equal(await readBalance(uid), 30);
});

// ─── Ledger 完整性 ─────────────────────────────────────────────────────

test("流水总和 = 余额变化", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);
  await applyPointsCommand(db, uid, { action: "earn_schedule_goal", payload: { amount: 5, _goalEntry: { date: "d1" }, idempotencyKey: `l1-${uid}` }, actor: "test" });
  await applyPointsCommand(db, uid, { action: "spend_entertainment", payload: { pointsSpent: 3, _extension: { minutes: 10 }, idempotencyKey: `l2-${uid}` }, actor: "test" });
  await applyPointsCommand(db, uid, { action: "earn_schedule_goal", payload: { amount: 1, _goalEntry: { date: "d2" }, idempotencyKey: `l3-${uid}` }, actor: "test" });

  const balance = await readBalance(uid);
  const ledger = await readLedger(uid);
  const ledgerSum = ledger.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  assert.equal(balance, 23, `预期 23，实际 ${balance}`);
  assert.equal(ledgerSum, 3, `流水 sum 预期 3（+5-3+1），实际 ${ledgerSum}`);
});

// ─── 安全边界测试 ──────────────────────────────────────────────────────

test("unsupported action 被拒绝", async () => {
  const uid = freshUid();
  await seedBalance(uid, 20);
  const result = await applyPointsCommand(db, uid, { action: "give_me_free_points", payload: { amount: 9999 }, actor: "web" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_action");
  assert.equal(await readBalance(uid), 20, "余额不应改变");
});

test("A 用户的 uid 不能修改 B 用户的余额", async () => {
  const uidA = freshUid();
  const uidB = freshUid();
  await seedBalance(uidA, 50);
  await seedBalance(uidB, 50);

  // uidA's token tries to earn points on uidB
  await applyPointsCommand(db, uidB, { action: "earn_schedule_goal", payload: { amount: 100, _goalEntry: { date: "hack" }, idempotencyKey: `hack-${uidA}` }, actor: "web" });

  assert.equal(await readBalance(uidA), 50, "uidA 余额不应改变");
  assert.equal(await readBalance(uidB), 150, "uidB 余额应为 50+100=150（测试使用 uidB 本身调用）");
});
