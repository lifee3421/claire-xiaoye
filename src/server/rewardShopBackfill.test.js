// Tests for the pure planning half of scripts/backfillRewardShop.mjs.
//
// The Firestore half is thin (read all, batch write, re-read, verify); all the
// reasoning that could silently corrupt data — what is claimed about history,
// what becomes a reward instance, whether the balance is touched — lives in
// planBackfill and is covered here.
//
// The central property under test is a negative one: the migration must not
// assert anything about pre-migration earnings, because the old app deducted
// points from places that never wrote to `redemptions`.

import test from "node:test";
import assert from "node:assert/strict";
import { planBackfill, MIGRATION_VERSION, OPENING_BALANCE_ID } from "../../scripts/backfillRewardShop.mjs";

const MIGRATED_AT = "2026-08-04T12:00:00.000Z";

function scenario(overrides = {}) {
  return {
    profile: { points: 70 },
    products: [{ id: "p1", name: "奶茶", categoryId: "food", price: 30 }],
    redemptions: [],
    existingTransactions: new Set(),
    existingRewards: new Set(),
    migratedAt: MIGRATED_AT,
    ...overrides,
  };
}

const openingRowOf = (plan) => plan.ledgerRows.find((row) => row.id === OPENING_BALANCE_ID);
const legacyRowsOf = (plan) => plan.ledgerRows.filter((row) => row.id !== OPENING_BALANCE_ID);

// An already-migrated profile, used to test the "second run" behaviour.
function migratedProfile(extra = {}) {
  return {
    points: 70,
    rewardShopMigrationVersion: MIGRATION_VERSION,
    rewardLedgerStartAt: MIGRATED_AT,
    legacyBalanceAtMigration: 70,
    rewardTotalEarned: 0,
    rewardTotalSpent: 0,
    ...extra,
  };
}

// --- what the migration refuses to claim ------------------------------------

// This is the whole point of the rewrite. The old plan defined
// earnedTotal := balance + spent, which is only true if every point ever lost
// went through the shop. It did not.
test("historical rewardTotalEarned is never fabricated from balance + spending", () => {
  const plan = planBackfill(
    scenario({
      profile: { points: 70 },
      redemptions: [
        { id: "r1", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 70, type: "product" },
        { id: "r2", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 100, type: "product" },
      ],
    })
  );
  assert.equal("earnedTotal" in plan, false);
  assert.equal("identityHolds" in plan, false);
  // 70 + 60 = 130 was the old fabricated answer. It must appear nowhere.
  assert.notEqual(plan.accountPatch.rewardTotalEarned, 130);
  assert.equal(plan.accountPatch.rewardTotalEarned, 0);
});

// The scenario the old identity got silently wrong: points left the balance
// through a settlement rollback that never touched `redemptions`.
test("an account with non-shop deductions migrates cleanly and claims nothing about the gap", () => {
  // Truth: earned 230, spent 60 in the shop, lost 100 to a rollback -> 70 left.
  // Nothing in the data can prove any of that, so nothing is asserted.
  const plan = planBackfill(
    scenario({
      profile: { points: 70 },
      redemptions: [
        { id: "r1", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 100, type: "product" },
        { id: "r2", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 70, type: "product" },
      ],
    })
  );
  assert.equal(plan.legacySpentTotal, 60);
  assert.equal(plan.accountPatch.legacyRedemptionSpentTotal, 60);
  assert.equal(plan.accountPatch.rewardTotalEarned, 0);
  assert.equal(plan.accountPatch.rewardCounterScope, "post_migration");
  // The opening balance is the observed balance — not a reconciled fiction.
  assert.equal(plan.openingBalance, 70);
  assert.equal(plan.invariant.holds, true);
});

// Same redemption history, three different invisible back-stories: the plan
// must depend only on what is actually recorded.
test("identical redemption history plus different hidden deductions still yields an honest plan", () => {
  const redemptions = [{ id: "r1", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 40, type: "product" }];
  for (const points of [40, 5, 0]) {
    const plan = planBackfill(scenario({ profile: { points }, redemptions }));
    assert.equal(plan.legacySpentTotal, 30, `spent stays provable at points=${points}`);
    assert.equal(plan.accountPatch.rewardTotalEarned, 0, `no earned claim at points=${points}`);
    assert.equal(plan.openingBalance, points, `opening balance mirrors the real balance at points=${points}`);
    assert.equal(plan.invariant.holds, true);
  }
});

test("an adjustment-heavy legacy account does not block the migration", () => {
  const plan = planBackfill(
    scenario({
      profile: { points: 12.5 },
      redemptions: [
        { id: "r1", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 90, type: "product" },
        { id: "r2", type: "project_reward", productName: "结项奖励", price: -50, remainingPoints: 140 },
        { id: "r3", type: "entertainment_extension", productName: "娱乐加时", price: 7.5, remainingPoints: 12.5 },
      ],
    })
  );
  assert.equal(plan.legacySpentTotal, 37.5);
  assert.equal(plan.legacyEarnedRecorded, 50);
  assert.equal(plan.openingBalance, 12.5);
  assert.equal(plan.invariant.holds, true);
});

test("the plan never contains a patch for `points` — the balance is out of scope by construction", () => {
  const plan = planBackfill(scenario({ redemptions: [{ id: "r1", price: 30, remainingPoints: 70, productId: "p1", type: "product" }] }));
  assert.equal("points" in plan.accountPatch, false);
  assert.deepEqual(Object.keys(plan.accountPatch).sort(), [
    "legacyBalanceAtMigration",
    "legacyRedemptionEarnedTotal",
    "legacyRedemptionSpentTotal",
    "rewardCounterScope",
    "rewardLedgerStartAt",
    "rewardShopMigrationVersion",
    "rewardShopSchemaVersion",
    "rewardTotalEarned",
    "rewardTotalSpent",
  ]);
});

// --- the opening balance row ------------------------------------------------

test("a single opening-balance row pins the start of the auditable ledger", () => {
  const plan = planBackfill(scenario({ profile: { points: 70 } }));
  const opening = openingRowOf(plan);
  assert.ok(opening, "opening row is always planned");
  assert.equal(opening.data.source, "migration_opening_balance");
  assert.equal(opening.data.ledgerPhase, "migration");
  assert.equal(opening.data.authoritative, true);
  assert.equal(opening.data.balanceBefore, 0);
  assert.equal(opening.data.balanceAfter, 70);
  assert.equal(opening.data.createdAt, MIGRATED_AT);
  assert.match(opening.data.description, /来源不可考/);
});

test("an empty history still gets an opening row, so the ledger has a defined start", () => {
  const plan = planBackfill(scenario({ profile: { points: 42 }, redemptions: [] }));
  assert.equal(plan.ledgerRows.length, 1);
  assert.equal(openingRowOf(plan).data.balanceAfter, 42);
  assert.equal(plan.invariant.holds, true);
});

// A negative balance would be flipped to positive if the row were typed
// earn/redeem, because those store `amount` as an absolute value.
test("a negative legacy balance survives as a negative opening entry", () => {
  const plan = planBackfill(scenario({ profile: { points: -15 } }));
  const opening = openingRowOf(plan);
  assert.equal(opening.data.type, "adjustment");
  assert.equal(opening.data.balanceAfter, -15);
  assert.equal(plan.invariant.expectedBalance, -15);
  assert.equal(plan.invariant.holds, true);
});

// --- legacy rows are display history, not audit material --------------------

test("legacy redemptions are migrated but flagged non-authoritative and pre-migration", () => {
  const plan = planBackfill(scenario({ redemptions: [{ id: "r1", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 70, type: "product" }] }));
  const [legacy] = legacyRowsOf(plan);
  assert.equal(legacy.data.ledgerPhase, "pre_migration");
  assert.equal(legacy.data.authoritative, false);
  assert.equal(legacy.data.backfilled, true);
  assert.equal(legacy.data.source, "legacy_product");
});

// Materializing old purchases as "available" would retroactively gift the user
// a stack of unused rewards she never actually holds.
test("historical purchases become ALREADY-USED reward instances, not free available ones", () => {
  const plan = planBackfill(scenario({ redemptions: [{ id: "r1", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 70, type: "product" }] }));
  assert.equal(plan.rewardRows.length, 1);
  assert.equal(plan.rewardRows[0].data.status, "used");
  assert.equal(plan.rewardRows[0].data.backfilled, true);
  assert.equal(plan.rewardRows[0].data.pricePaid, 30);
  assert.equal(plan.rewardRows[0].data.source, "migration_legacy_redemption");
});

test("bookkeeping rows (娱乐加时 / 结项奖励) produce ledger entries but no usable reward", () => {
  const plan = planBackfill(
    scenario({
      redemptions: [
        { id: "r1", type: "entertainment_extension", productName: "当日娱乐加时 +30min", price: 20, remainingPoints: 80 },
        { id: "r2", type: "project_reward", productName: "结项奖励：论文", price: -50, remainingPoints: 130 },
      ],
    })
  );
  assert.equal(plan.rewardRows.length, 0);
  assert.equal(legacyRowsOf(plan).length, 2);
});

test("a negative-price project reward counts as recorded earning, never as spending", () => {
  const plan = planBackfill(
    scenario({ profile: { points: 130 }, redemptions: [{ id: "r2", type: "project_reward", price: -50, remainingPoints: 130, productName: "结项奖励" }] })
  );
  assert.equal(plan.legacySpentTotal, 0);
  assert.equal(plan.legacyEarnedRecorded, 50);
  assert.equal(legacyRowsOf(plan)[0].data.type, "earn");
  assert.equal(legacyRowsOf(plan)[0].data.amount, 50);
});

test("balanceBefore is reconstructed from the recorded remainingPoints rather than invented", () => {
  const plan = planBackfill(scenario({ redemptions: [{ id: "r1", productId: "p1", price: 30, remainingPoints: 70, type: "product", productName: "奶茶" }] }));
  assert.equal(legacyRowsOf(plan)[0].data.balanceBefore, 100);
  assert.equal(legacyRowsOf(plan)[0].data.balanceAfter, 70);
});

test("a legacy row with no remainingPoints yields nulls instead of a fabricated balance", () => {
  const plan = planBackfill(scenario({ redemptions: [{ id: "r1", productId: "p1", price: 30, type: "product", productName: "奶茶" }] }));
  assert.equal(legacyRowsOf(plan)[0].data.balanceBefore, null);
  assert.equal(legacyRowsOf(plan)[0].data.balanceAfter, null);
});

test("a redemption whose product was since deleted still migrates, using the recorded name snapshot", () => {
  const plan = planBackfill(
    scenario({ products: [], redemptions: [{ id: "r1", productId: "gone", productName: "已删除的奖励", price: 15, remainingPoints: 5, type: "product" }] })
  );
  assert.equal(plan.rewardRows.length, 1);
  assert.equal(plan.rewardRows[0].data.itemSnapshot.name, "已删除的奖励");
});

// --- the post-migration invariant -------------------------------------------

test("the invariant is about the ledger going forward, not about unknowable history", () => {
  const plan = planBackfill(scenario());
  assert.match(plan.invariant.statement, /rewardLedgerStartAt/);
  assert.equal(plan.invariant.ledgerStartAt, MIGRATED_AT);
});

test("engine rows written after the migration node are added up and must reconcile", () => {
  const plan = planBackfill(
    scenario({
      profile: migratedProfile({ points: 85 }),
      existingTransactions: [
        { id: OPENING_BALANCE_ID, type: "adjustment", balanceBefore: 0, balanceAfter: 70, backfilled: true, createdAt: MIGRATED_AT },
        { id: "t1", type: "earn", amount: 25, createdAt: "2026-08-05T01:00:00.000Z" },
        { id: "t2", type: "redeem", amount: 10, createdAt: "2026-08-05T02:00:00.000Z" },
      ],
    })
  );
  assert.equal(plan.invariant.postMigrationRowCount, 2);
  assert.equal(plan.invariant.postMigrationDelta, 15);
  assert.equal(plan.invariant.expectedBalance, 85);
  assert.equal(plan.invariant.holds, true);
});

test("a ledger row missing from the trail makes the invariant fail loudly", () => {
  const plan = planBackfill(
    scenario({
      profile: migratedProfile({ points: 200 }), // balance moved without a row
      existingTransactions: [
        { id: OPENING_BALANCE_ID, type: "adjustment", balanceBefore: 0, balanceAfter: 70, backfilled: true, createdAt: MIGRATED_AT },
        { id: "t1", type: "earn", amount: 25, createdAt: "2026-08-05T01:00:00.000Z" },
      ],
    })
  );
  assert.equal(plan.invariant.expectedBalance, 95);
  assert.equal(plan.invariant.actualBalance, 200);
  assert.equal(plan.invariant.holds, false);
});

test("backfilled rows never enter the invariant, so pre-migration history cannot skew it", () => {
  const plan = planBackfill(
    scenario({
      profile: migratedProfile({ points: 70 }),
      existingTransactions: [
        { id: OPENING_BALANCE_ID, type: "adjustment", balanceBefore: 0, balanceAfter: 70, backfilled: true, createdAt: MIGRATED_AT },
        { id: "backfill_r1", type: "redeem", amount: 30, backfilled: true, ledgerPhase: "pre_migration", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    })
  );
  assert.equal(plan.invariant.postMigrationRowCount, 0);
  assert.equal(plan.invariant.holds, true);
});

test("engine rows predating the boundary are reported, not double counted", () => {
  const plan = planBackfill(
    scenario({
      profile: migratedProfile({ points: 70 }),
      existingTransactions: [{ id: "t0", type: "earn", amount: 40, createdAt: "2026-07-01T00:00:00.000Z" }],
    })
  );
  assert.equal(plan.invariant.preBoundaryRowCount, 1);
  assert.equal(plan.invariant.postMigrationDelta, 0);
  assert.equal(plan.invariant.holds, true);
});

test("a ledger row that cannot be placed in time is surfaced instead of quietly ignored", () => {
  const plan = planBackfill(
    scenario({
      profile: migratedProfile({ points: 70 }),
      existingTransactions: [{ id: "t1", type: "earn", amount: 25, createdAt: null }],
    })
  );
  assert.equal(plan.invariant.undatedRowCount, 1);
  assert.equal(plan.invariant.holds, false);
});

// --- repeatability ----------------------------------------------------------

test("document ids are derived from the legacy row, so re-running overwrites instead of duplicating", () => {
  const redemptions = [{ id: "r1", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 70, type: "product" }];
  const first = planBackfill(scenario({ redemptions }));
  assert.equal(legacyRowsOf(first)[0].id, "backfill_r1");
  assert.equal(first.newLedgerCount, 2); // legacy row + opening row
  assert.equal(first.newRewardCount, 1);

  const second = planBackfill(
    scenario({
      redemptions,
      existingTransactions: new Set(["backfill_r1", OPENING_BALANCE_ID]),
      existingRewards: new Set(["backfill_r1"]),
    })
  );
  assert.equal(second.newLedgerCount, 0);
  assert.equal(second.newRewardCount, 0);
  assert.deepEqual(legacyRowsOf(second)[0].data, legacyRowsOf(first)[0].data);
});

// If a re-run recomputed the opening balance from the current points, every
// point earned since the migration would be absorbed into the opening entry
// and counted twice.
test("re-running after post-migration activity does not drag the opening balance forward", () => {
  const plan = planBackfill(
    scenario({
      profile: migratedProfile({ points: 95 }),
      existingTransactions: [
        { id: OPENING_BALANCE_ID, type: "adjustment", balanceBefore: 0, balanceAfter: 70, backfilled: true, createdAt: MIGRATED_AT },
        { id: "t1", type: "earn", amount: 25, createdAt: "2026-08-06T00:00:00.000Z" },
      ],
      migratedAt: "2026-09-09T00:00:00.000Z", // a much later run
    })
  );
  assert.equal(plan.openingBalance, 70, "frozen at the migration node");
  assert.equal(plan.ledgerStartAt, MIGRATED_AT, "the boundary never moves");
  assert.equal(openingRowOf(plan).data.balanceAfter, 70);
  assert.equal(plan.invariant.holds, true);
});

test("a second run leaves already-scoped counters alone instead of resetting them to zero", () => {
  const plan = planBackfill(scenario({ profile: migratedProfile({ points: 70, rewardTotalEarned: 25, rewardTotalSpent: 10 }) }));
  assert.equal(plan.alreadyMigrated, true);
  assert.equal("rewardTotalEarned" in plan.accountPatch, false);
  assert.equal("rewardTotalSpent" in plan.accountPatch, false);
});

// Version 1 wrote a fabricated lifetime `earned`. Re-running must clear it.
test("a profile left behind by migration v1 gets its fabricated counters reset", () => {
  const plan = planBackfill(
    scenario({
      profile: { points: 70, rewardShopMigrationVersion: 1, rewardTotalEarned: 130, rewardTotalSpent: 60 },
      redemptions: [{ id: "r1", productId: "p1", productName: "奶茶", price: 30, remainingPoints: 70, type: "product" }],
    })
  );
  assert.equal(plan.alreadyMigrated, false);
  assert.equal(plan.accountPatch.rewardTotalEarned, 0);
  assert.equal(plan.accountPatch.rewardTotalSpent, 0);
  assert.equal(plan.accountPatch.rewardShopMigrationVersion, MIGRATION_VERSION);
});

test("the patch is absolute, so a fifth run lands on the same values as the first", () => {
  const redemptions = [
    { id: "r1", productId: "p1", price: 30, remainingPoints: 70, type: "product", productName: "奶茶" },
    { id: "r2", productId: "p1", price: 30, remainingPoints: 100, type: "product", productName: "奶茶" },
  ];
  const runs = Array.from({ length: 5 }, () => planBackfill(scenario({ redemptions })));
  for (const run of runs) assert.deepEqual(run.accountPatch, runs[0].accountPatch);
});

test("fractional point values stay reconciled after rounding", () => {
  const plan = planBackfill(
    scenario({ profile: { points: 10.5 }, redemptions: [{ id: "r1", productId: "p1", price: 0.25, remainingPoints: 10.5, type: "product", productName: "小奖励" }] })
  );
  assert.equal(plan.openingBalance, 10.5);
  assert.equal(plan.legacySpentTotal, 0.25);
  assert.equal(plan.invariant.holds, true);
});
