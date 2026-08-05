// Migration for the 积分商城 data model (pointTransactions / rewardInstances /
// reward counters).
//
// WHAT THIS SCRIPT REFUSES TO DO
//
// The old app kept the balance in users/{uid}.points and logged shop spending
// in users/{uid}/redemptions. It did NOT log where points came from, and it
// deducted points from several places that never touched `redemptions` at all
// (settlement rollbacks, manual edits, entertainment bookkeeping). So the
// tempting identity
//
//     earnedTotal := currentBalance + historicalRedemptionSpent
//
// is NOT a reconstruction of history — it is a fabricated number that silently
// asserts "every point ever lost was spent in the shop". This script does not
// compute it. Historical `rewardTotalEarned` is unrecoverable, so it is not
// invented.
//
// WHAT IT DOES INSTEAD
//
// It treats the migration as an accounting opening-balance event:
//
//   * `points` is never written. The balance is the balance.
//   * One `migration_opening_balance` ledger row pins the balance at the
//     migration node, with an explicit "historical sources unknown" label.
//   * Legacy redemptions are still migrated — as pre-migration ledger rows
//     (marked non-authoritative, for display) and as ALREADY-USED reward
//     instances, so nothing is retroactively gifted.
//   * The reward counters start at 0 and count POST-migration activity only.
//     `rewardLedgerStartAt` + `rewardCounterScope` on the profile say so, so
//     any UI can label them "自 <date> 起统计" instead of implying lifetime
//     totals.
//
// Three properties this script is built around:
//
//   1. Repeatable — every document has a deterministic id derived from the row
//      it came from ("backfill_<redemptionId>"), so a second run overwrites the
//      same docs instead of duplicating them. Snapshot fields captured at the
//      migration node are frozen on the first apply and never recomputed.
//   2. Idempotent — it never uses increment(); it writes computed absolute
//      values. Running it five times gives the same result as running it once.
//   3. Verifiable — the invariant is no longer a claim about unknowable
//      history. It is: openingBalance + (every authoritative ledger row written
//      since the migration node) == current balance. That is checkable, and it
//      is what "the ledger is trustworthy from here on" actually means.
//
// Usage (PowerShell):
//   $env:CATKEEPER_FIREBASE_SERVICE_ACCOUNT = Get-Content key.json -Raw
//   node scripts/backfillRewardShop.mjs --uid=<uid>            # dry run
//   node scripts/backfillRewardShop.mjs --uid=<uid> --apply    # write
//   node scripts/backfillRewardShop.mjs --uid=<uid> --verify   # check only
//
// Credentials: CATKEEPER_FIREBASE_SERVICE_ACCOUNT (raw JSON, same env the
// serverless endpoint uses) or GOOGLE_APPLICATION_CREDENTIALS (path).

import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { REWARD_SHOP_SCHEMA_VERSION, signedAmountOf } from "../src/server/rewardShopCore.js";

// Parsed lazily inside main() rather than at import time, so importing
// planBackfill from a unit test cannot trip the "missing uid" exit.
function parseArgs(argv) {
  const args = Object.fromEntries(
    argv.map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value ?? true];
    })
  );
  return {
    uid: String(args.uid || process.env.CATKEEPER_USER_UID || "").trim(),
    apply: args.apply === true || args.apply === "true",
    verifyOnly: args.verify === true || args.verify === "true",
  };
}

// Bumped from 1: version 1 fabricated `rewardTotalEarned` from the balance.
// A profile still marked 1 gets its counters reset by this run.
export const MIGRATION_VERSION = 2;
export const OPENING_BALANCE_ID = "migration_opening_balance";
const BACKFILL_PREFIX = "backfill_";

function initFirestore() {
  if (!getApps().length) {
    const raw = process.env.CATKEEPER_FIREBASE_SERVICE_ACCOUNT;
    if (raw) initializeApp({ credential: cert(JSON.parse(raw)) });
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      initializeApp({ credential: cert(JSON.parse(readFileSync(file, "utf8"))) });
    } else initializeApp({ credential: applicationDefault() });
  }
  return getFirestore();
}

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const toIsoish = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return null;
};
const isAtOrAfter = (value, boundaryIso) => {
  const iso = toIsoish(value);
  if (!iso || !boundaryIso) return false;
  const at = Date.parse(iso);
  const boundary = Date.parse(boundaryIso);
  return Number.isFinite(at) && Number.isFinite(boundary) && at >= boundary;
};

// Callers may hand us ids only (a Set, when all we need is an existence check)
// or full documents (an array/Map, which additionally makes the post-migration
// invariant checkable). Both are accepted so unit tests can stay terse.
function normalizeDocs(input) {
  if (!input) return { ids: new Set(), docs: [] };
  if (input instanceof Set) return { ids: new Set(input), docs: [] };
  if (input instanceof Map) return { ids: new Set(input.keys()), docs: [...input].map(([id, data]) => ({ id, ...data })) };
  if (Array.isArray(input)) return { ids: new Set(input.map((doc) => doc.id)), docs: input };
  return { ids: new Set(), docs: [] };
}

/**
 * Pure planning step: given the current documents, decide what the derived
 * structures should look like. No Firestore access, so the reasoning below is
 * inspectable in a dry run before anything is written.
 */
export function planBackfill({ profile, redemptions, products, existingTransactions, existingRewards, migratedAt }) {
  const productsById = new Map(products.map((item) => [item.id, item]));
  const balance = round(profile?.points);
  const transactions = normalizeDocs(existingTransactions);
  const rewards = normalizeDocs(existingRewards);

  const priorVersion = Number(profile?.rewardShopMigrationVersion) || 0;
  const alreadyMigrated = priorVersion >= MIGRATION_VERSION;

  // The migration node: pinned on the first apply, reused forever after. If it
  // moved on every run, the boundary the audit trail is measured from would
  // move with it and the invariant would be meaningless.
  const ledgerStartAt = toIsoish(profile?.rewardLedgerStartAt) || toIsoish(migratedAt) || new Date().toISOString();

  // Snapshot fields describe the state AT the migration node. Once written they
  // are historical facts, so a later run must not recompute them from a balance
  // that has moved on since.
  const freeze = (field, computed) =>
    alreadyMigrated && profile?.[field] !== undefined && profile?.[field] !== null ? profile[field] : computed;

  const ledgerRows = [];
  const rewardRows = [];
  let legacySpentTotal = 0;
  let legacyEarnedRecorded = 0;

  for (const row of redemptions) {
    const price = Number(row.price) || 0;
    // project_reward rows carry a NEGATIVE price (they added points). They are
    // earnings, not spending.
    if (price > 0) legacySpentTotal = round(legacySpentTotal + price);
    else if (price < 0) legacyEarnedRecorded = round(legacyEarnedRecorded + Math.abs(price));

    const docId = `${BACKFILL_PREFIX}${row.id}`;
    const createdAt = row.createdAt || null;

    ledgerRows.push({
      id: docId,
      exists: transactions.ids.has(docId),
      data: {
        schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
        type: price >= 0 ? "redeem" : "earn",
        amount: Math.abs(price),
        // The historical rows only recorded the balance AFTER the change, so
        // balanceBefore is reconstructed rather than invented from nothing.
        balanceBefore: row.remainingPoints === undefined ? null : round(Number(row.remainingPoints) + price),
        balanceAfter: row.remainingPoints === undefined ? null : round(row.remainingPoints),
        source: `legacy_${row.type || "redemption"}`,
        itemId: row.productId || "",
        description: row.productName || "历史兑换",
        actor: "migration",
        // Display history, not audit material: these rows predate the ledger
        // and are deliberately excluded from every balance check.
        ledgerPhase: "pre_migration",
        authoritative: false,
        backfilled: true,
        legacyRedemptionId: row.id,
        createdAt,
      },
    });

    // Only real shop purchases become reward instances. entertainment_extension
    // and project_reward are bookkeeping rows, not things you can "use later".
    const product = row.productId ? productsById.get(row.productId) : null;
    if (price > 0 && row.type !== "entertainment_extension" && row.type !== "project_reward") {
      rewardRows.push({
        id: docId,
        exists: rewards.ids.has(docId),
        data: {
          schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
          shopItemId: row.productId || "",
          itemSnapshot: {
            name: row.productName || product?.name || "历史奖励",
            categoryId: row.categoryId || product?.categoryId || "",
            price,
            note: row.note || "",
          },
          pricePaid: price,
          // Deliberately "used": these were consumed long ago in real life.
          status: "used",
          redeemedAt: createdAt,
          usedAt: createdAt,
          idempotencyKey: `backfill:${row.id}`,
          source: "migration_legacy_redemption",
          backfilled: true,
          legacyRedemptionId: row.id,
        },
      });
    }
  }

  // The opening balance is frozen at the migration node. Re-running after the
  // user has earned or spent more must NOT drag this row up to the new balance,
  // or the ledger would silently absorb the difference.
  const openingBalance = round(freeze("legacyBalanceAtMigration", balance));

  // Typed as an "adjustment" on purpose: signedAmountOf() derives its effect
  // from balanceBefore→balanceAfter, so a negative legacy balance stays correct
  // instead of being flipped by the abs() applied to earn/redeem amounts.
  ledgerRows.push({
    id: OPENING_BALANCE_ID,
    exists: transactions.ids.has(OPENING_BALANCE_ID),
    data: {
      schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
      type: "adjustment",
      amount: Math.abs(openingBalance),
      balanceBefore: 0,
      balanceAfter: openingBalance,
      source: "migration_opening_balance",
      itemId: "",
      description: "账本起点：迁移前累计余额（历史逐笔来源不可考）",
      actor: "migration",
      ledgerPhase: "migration",
      authoritative: true,
      backfilled: true,
      migrationVersion: MIGRATION_VERSION,
      createdAt: ledgerStartAt,
    },
  });

  // Everything the engine has written since the migration node. Backfilled rows
  // are excluded by construction; so is anything predating the boundary, which
  // is already baked into the opening balance.
  const engineRows = transactions.docs.filter((doc) => doc.id !== OPENING_BALANCE_ID && !doc.backfilled);
  const postMigrationRows = engineRows.filter((doc) => isAtOrAfter(doc.createdAt, ledgerStartAt));
  const undatedRows = engineRows.filter((doc) => !toIsoish(doc.createdAt));
  const preBoundaryRows = engineRows.length - postMigrationRows.length - undatedRows.length;
  const postMigrationDelta = postMigrationRows.reduce((sum, doc) => round(sum + signedAmountOf(doc)), 0);
  const expectedBalance = round(openingBalance + postMigrationDelta);

  const invariant = {
    // "The ledger is reliable from the migration node onward" — not a claim
    // about history nobody recorded.
    statement: "openingBalance + Σ(authoritative rows since rewardLedgerStartAt) == points",
    ledgerStartAt,
    openingBalance,
    postMigrationDelta,
    postMigrationRowCount: postMigrationRows.length,
    preBoundaryRowCount: preBoundaryRows,
    undatedRowCount: undatedRows.length,
    expectedBalance,
    actualBalance: balance,
    holds: expectedBalance === balance && undatedRows.length === 0,
  };

  // Counters are reset only when this migration has not run yet, which also
  // covers version 1 profiles carrying the fabricated lifetime `earned`.
  const counterPatch = alreadyMigrated ? {} : { rewardTotalEarned: 0, rewardTotalSpent: 0 };

  return {
    balance,
    openingBalance,
    ledgerStartAt,
    alreadyMigrated,
    priorVersion,
    // Provable legacy statistics, named so nobody mistakes them for lifetime
    // shop totals: they only cover what the `redemptions` collection recorded.
    legacySpentTotal,
    legacyEarnedRecorded,
    accountPatch: {
      rewardShopMigrationVersion: MIGRATION_VERSION,
      rewardShopSchemaVersion: REWARD_SHOP_SCHEMA_VERSION,
      rewardLedgerStartAt: ledgerStartAt,
      // Read this before rendering the counters anywhere.
      rewardCounterScope: "post_migration",
      legacyBalanceAtMigration: openingBalance,
      legacyRedemptionSpentTotal: round(freeze("legacyRedemptionSpentTotal", legacySpentTotal)),
      legacyRedemptionEarnedTotal: round(freeze("legacyRedemptionEarnedTotal", legacyEarnedRecorded)),
      ...counterPatch,
    },
    ledgerRows,
    rewardRows,
    newLedgerCount: ledgerRows.filter((row) => !row.exists).length,
    newRewardCount: rewardRows.filter((row) => !row.exists).length,
    invariant,
  };
}

async function readAll(db, uid) {
  const userRef = db.collection("users").doc(uid);
  const [profileSnap, redemptionsSnap, productsSnap, transactionsSnap, rewardsSnap] = await Promise.all([
    userRef.get(),
    userRef.collection("redemptions").get(),
    userRef.collection("products").get(),
    userRef.collection("pointTransactions").get(),
    userRef.collection("rewardInstances").get(),
  ]);
  if (!profileSnap.exists) throw new Error(`users/${uid} does not exist — wrong uid or wrong project.`);
  return {
    userRef,
    profile: profileSnap.data() || {},
    redemptions: redemptionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    products: productsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    // Full documents, not just ids: the post-migration invariant needs to add
    // the actual rows up.
    existingTransactions: transactionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    existingRewards: new Set(rewardsSnap.docs.map((doc) => doc.id)),
    transactionCount: transactionsSnap.size,
    rewardCount: rewardsSnap.size,
  };
}

async function main() {
  const { uid, apply, verifyOnly } = parseArgs(process.argv.slice(2));
  if (!uid) {
    console.error("Missing uid. Pass --uid=<uid> or set CATKEEPER_USER_UID.");
    process.exit(1);
  }
  const db = initFirestore();
  const migratedAt = new Date().toISOString();
  const state = await readAll(db, uid);
  const plan = planBackfill({ ...state, migratedAt });

  console.log(`\nuid: ${uid}`);
  console.log(`mode: ${verifyOnly ? "VERIFY (no writes)" : apply ? "APPLY" : "DRY RUN (no writes)"}`);
  console.log(`migration version: ${plan.priorVersion} -> ${MIGRATION_VERSION}${plan.alreadyMigrated ? " (already migrated, snapshots preserved)" : ""}`);
  console.log(`\ncurrent balance (never modified): ${plan.balance}`);
  console.log(`legacy redemptions: ${state.redemptions.length}`);
  console.log(`existing pointTransactions: ${state.transactionCount}  |  existing rewardInstances: ${state.rewardCount}`);

  console.log(`\n-- legacy statistics (from the redemptions collection ONLY) --`);
  console.log(`  recorded shop spending: ${plan.legacySpentTotal}`);
  console.log(`  recorded shop earnings: ${plan.legacyEarnedRecorded}`);
  console.log(`  NOT a lifetime total: the old app also deducted points outside this collection.`);
  console.log(`  historical rewardTotalEarned is unrecoverable and is NOT written.`);

  console.log(`\n-- ledger from the migration node --`);
  console.log(`  ledger starts at: ${plan.ledgerStartAt}`);
  console.log(`  opening balance:  ${plan.openingBalance}`);
  console.log(`  counters (rewardTotalEarned/Spent): ${plan.alreadyMigrated ? "left untouched (already scoped)" : "reset to 0, post-migration scope"}`);
  console.log(`  invariant: ${plan.invariant.statement}`);
  console.log(
    `    ${plan.invariant.openingBalance} + ${plan.invariant.postMigrationDelta} (${plan.invariant.postMigrationRowCount} rows) = ${plan.invariant.expectedBalance} vs points ${plan.invariant.actualBalance} -> ${plan.invariant.holds ? "OK" : "FAILED"}`
  );
  if (plan.invariant.undatedRowCount > 0) console.log(`    ${plan.invariant.undatedRowCount} ledger row(s) have no createdAt and cannot be placed in time.`);
  if (plan.invariant.preBoundaryRowCount > 0) console.log(`    ${plan.invariant.preBoundaryRowCount} engine row(s) predate the boundary (already inside the opening balance).`);

  console.log(`\nledger rows to write: ${plan.ledgerRows.length} (${plan.newLedgerCount} new, ${plan.ledgerRows.length - plan.newLedgerCount} rewritten in place)`);
  console.log(`reward instances to write: ${plan.rewardRows.length} (${plan.newRewardCount} new, ${plan.rewardRows.length - plan.newRewardCount} rewritten in place)`);

  if (!plan.invariant.holds) {
    console.error("\nRefusing to continue: the ledger does not reconcile with the balance from the migration node onward.");
    process.exit(2);
  }

  if (verifyOnly) {
    const clean = plan.newLedgerCount === 0 && plan.newRewardCount === 0 && plan.alreadyMigrated;
    console.log(`\nverify result: ${clean ? "up to date, nothing to migrate" : "migration needed — re-run with --apply"}`);
    process.exit(clean ? 0 : 1);
  }

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write these documents.");
    return;
  }

  let written = 0;
  const chunks = chunk([...plan.ledgerRows.map((row) => ["pointTransactions", row]), ...plan.rewardRows.map((row) => ["rewardInstances", row])], 400);
  for (const group of chunks) {
    const batch = db.batch();
    for (const [collection, row] of group) {
      batch.set(state.userRef.collection(collection).doc(row.id), row.data, { merge: true });
      written += 1;
    }
    await batch.commit();
  }
  // merge:true so no other profile field (including `points`) is touched.
  await state.userRef.set(plan.accountPatch, { merge: true });

  const after = await readAll(db, uid);
  const afterPlan = planBackfill({ ...after, migratedAt });
  console.log(`\nwrote ${written} documents + profile metadata.`);
  console.log(`post-run verify: invariant ${afterPlan.invariant.holds ? "OK" : "FAILED"}, ${afterPlan.newLedgerCount} ledger and ${afterPlan.newRewardCount} reward rows still missing (both should be 0).`);
  console.log(`ledger start pinned at: ${afterPlan.ledgerStartAt}`);
  console.log(`balance after run: ${afterPlan.balance} (was ${plan.balance}) — ${afterPlan.balance === plan.balance ? "unchanged, as intended" : "CHANGED, investigate immediately"}`);
}

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

// Importable for unit tests; only runs the Firestore path when executed directly.
if (process.argv[1] && process.argv[1].endsWith("backfillRewardShop.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
