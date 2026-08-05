import assert from "node:assert/strict";
import test from "node:test";

import {
  ERROR_CODES,
  buildAccountPatch,
  buildTransactionEntry,
  filterShopItems,
  matchShopItems,
  normalizeIdempotencyKey,
  normalizePrice,
  normalizeShopItemInput,
  normalizeStock,
  planRedemption,
  planUseReward,
  projectShopItem,
  resolveListingStatus,
  summarizeAccount,
} from "./rewardShopCore.js";

// --- value normalization ----------------------------------------------------

test("normalizePrice: only non-negative integers are valid point prices", () => {
  assert.equal(normalizePrice(0), 0);
  assert.equal(normalizePrice("30"), 30);
  assert.equal(normalizePrice(-1), null);
  assert.equal(normalizePrice(2.5), null);
  assert.equal(normalizePrice("abc"), null);
});

test("normalizeStock: empty means unlimited (null), bad values are rejected (undefined)", () => {
  assert.equal(normalizeStock(undefined), null);
  assert.equal(normalizeStock(""), null);
  assert.equal(normalizeStock("unlimited"), null);
  assert.equal(normalizeStock(0), 0);
  assert.equal(normalizeStock("3"), 3);
  assert.equal(normalizeStock(-1), undefined);
  assert.equal(normalizeStock(1.5), undefined);
});

// --- backward compatibility -------------------------------------------------

test("resolveListingStatus: products predating listingStatus keep their legacy shelf meaning", () => {
  assert.equal(resolveListingStatus({ status: "wishlist" }), "active");
  assert.equal(resolveListingStatus({ status: "paused" }), "inactive");
  assert.equal(resolveListingStatus({ status: "redeemed", repeatable: false }), "inactive");
  // A repeatable product that has been redeemed before is still on the shelf.
  assert.equal(resolveListingStatus({ status: "redeemed", repeatable: true }), "active");
  // An explicit new-field value always wins.
  assert.equal(resolveListingStatus({ status: "paused", listingStatus: "active" }), "active");
});

// --- idempotency ------------------------------------------------------------

test("normalizeIdempotencyKey: rejects short keys, and two keys never collapse onto one doc id", () => {
  assert.equal(normalizeIdempotencyKey("abc"), null);
  const a = normalizeIdempotencyKey("wx/msg/1001", { operation: "redeem" });
  const b = normalizeIdempotencyKey("wx#msg#1001", { operation: "redeem" });
  assert.ok(a && b);
  // Both sanitize to the same characters — the hash suffix is what keeps
  // them distinct, so a different WeChat message can never be swallowed as
  // a replay of another one.
  assert.notEqual(a.docId, b.docId);
  assert.ok(!a.docId.includes("/"));
});

test("normalizeIdempotencyKey: the same key in different operations is a different document", () => {
  assert.notEqual(normalizeIdempotencyKey("same-key-123", { operation: "redeem" }).docId, normalizeIdempotencyKey("same-key-123", { operation: "use" }).docId);
});

// --- shop item input --------------------------------------------------------

test("normalizeShopItemInput: create requires name and price, defaults stock to unlimited and status to active", () => {
  const missing = normalizeShopItemInput({}, { existing: null });
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.errors, ["name 是必填项", "price 是必填项"]);

  const created = normalizeShopItemInput({ name: " 奶茶 ", price: 5 }, { existing: null });
  assert.equal(created.valid, true);
  assert.equal(created.patch.name, "奶茶");
  assert.equal(created.patch.price, 5);
  assert.equal(created.patch.stock, null);
  assert.equal(created.patch.listingStatus, "active");
  assert.equal(created.patch.categoryId, "custom");
  assert.equal(created.patch.repeatable, true);
});

test("normalizeShopItemInput: update only returns keys the caller actually sent", () => {
  const existing = { id: "p1", name: "奶茶", price: 5, description: "原味", categoryId: "life" };
  const updated = normalizeShopItemInput({ price: 8 }, { existing });
  assert.equal(updated.valid, true);
  assert.deepEqual(Object.keys(updated.patch), ["price"]);
  assert.equal(updated.patch.description, undefined, "an unmentioned description must not be blanked");
});

test("normalizeShopItemInput: 下架 keeps the legacy status field coherent", () => {
  const off = normalizeShopItemInput({ status: "下架" }, { existing: { id: "p1", status: "wishlist" } });
  assert.equal(off.patch.listingStatus, "inactive");
  assert.equal(off.patch.status, "paused", "the old Mall filter reads status, so it has to agree");

  const on = normalizeShopItemInput({ status: "上架" }, { existing: { id: "p1", status: "paused" } });
  assert.equal(on.patch.listingStatus, "active");
  assert.equal(on.patch.status, "wishlist");
});

test("normalizeShopItemInput: an invalid price is refused rather than silently coerced", () => {
  const result = normalizeShopItemInput({ name: "x", price: -3 }, { existing: null });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("price")));
});

// --- matching ---------------------------------------------------------------

const SHELF = [
  { id: "milk-tea", name: "奶茶", price: 5, categoryId: "life" },
  { id: "milk-tea-big", name: "奶茶大杯", price: 8, categoryId: "life" },
  { id: "game", name: "巫师三", price: 60, categoryId: "games" },
];

test("matchShopItems: an exact name beats a partial one instead of being ambiguous", () => {
  const { matches, ambiguous } = matchShopItems(SHELF, "奶茶");
  assert.equal(ambiguous, false);
  assert.deepEqual(matches.map((item) => item.id), ["milk-tea"]);
});

test("matchShopItems: a genuinely ambiguous phrase returns every candidate, never a guess", () => {
  const shelf = [
    { id: "a", name: "游戏时间 1 小时", price: 10 },
    { id: "b", name: "游戏时间 2 小时", price: 20 },
  ];
  const { matches, ambiguous } = matchShopItems(shelf, "游戏时间");
  assert.equal(ambiguous, true);
  assert.equal(matches.length, 2);
});

test("filterShopItems: hides inactive items and respects a price ceiling", () => {
  const shelf = [...SHELF, { id: "off", name: "已下架", price: 1, status: "paused" }];
  assert.deepEqual(filterShopItems(shelf, {}).map((item) => item.id), ["milk-tea", "milk-tea-big", "game"]);
  assert.deepEqual(filterShopItems(shelf, { maxPrice: 8 }).map((item) => item.id), ["milk-tea", "milk-tea-big"]);
  assert.deepEqual(filterShopItems(shelf, { includeInactive: true, maxPrice: 1 }).map((item) => item.id), ["off"]);
  assert.deepEqual(filterShopItems(shelf, { category: "games" }).map((item) => item.id), ["game"]);
});

// --- redemption planning ----------------------------------------------------

test("planRedemption: validates in the required order — inactive beats out-of-stock beats broke", () => {
  const inactive = planRedemption({ item: { id: "a", name: "A", price: 999, stock: 0, status: "paused" }, profile: { points: 0 } });
  assert.equal(inactive.code, ERROR_CODES.ITEM_INACTIVE);

  const noStock = planRedemption({ item: { id: "a", name: "A", price: 999, stock: 0 }, profile: { points: 0 } });
  assert.equal(noStock.code, ERROR_CODES.OUT_OF_STOCK);

  const broke = planRedemption({ item: { id: "a", name: "A", price: 999, stock: 1 }, profile: { points: 0 } });
  assert.equal(broke.code, ERROR_CODES.INSUFFICIENT_POINTS);
  assert.equal(broke.details.shortBy, 999);
});

test("planRedemption: exactly-enough points is allowed and lands the balance on zero", () => {
  const plan = planRedemption({ item: { id: "a", name: "A", price: 30 }, profile: { points: 30 } });
  assert.equal(plan.ok, true);
  assert.equal(plan.balanceBefore, 30);
  assert.equal(plan.balanceAfter, 0);
  assert.equal(plan.accountPatch.points, 0);
  assert.equal(plan.accountPatch.rewardTotalSpent, 30);
});

test("planRedemption: unlimited stock stays unlimited and never writes a stock field", () => {
  const plan = planRedemption({ item: { id: "a", name: "A", price: 5 }, profile: { points: 100 } });
  assert.equal(plan.stockAfter, null);
  assert.equal("stock" in plan.itemPatch, false);
});

test("planRedemption: the last unit of limited stock takes the item off the shelf", () => {
  const plan = planRedemption({ item: { id: "a", name: "A", price: 5, stock: 1 }, profile: { points: 100 } });
  assert.equal(plan.stockAfter, 0);
  assert.equal(plan.itemPatch.stock, 0);
  assert.equal(plan.itemPatch.listingStatus, "inactive");
});

test("planRedemption: the snapshot freezes name and price so a later edit cannot rewrite history", () => {
  const plan = planRedemption({ item: { id: "a", name: "奶茶", price: 5, note: "原味" }, profile: { points: 10 } });
  assert.deepEqual(plan.itemSnapshot, { name: "奶茶", price: 5, categoryId: "", description: "", note: "原味", icon: "" });
  assert.equal(plan.rewardInstance.status, "available");
  assert.equal(plan.rewardInstance.pricePaid, 5);
  assert.equal(plan.transactionSeed.type, "redeem");
  assert.equal(plan.legacyRedemption.remainingPoints, 5);
});

test("planRedemption: a fractional balance is preserved to two decimals", () => {
  const plan = planRedemption({ item: { id: "a", name: "A", price: 3 }, profile: { points: 10.25 } });
  assert.equal(plan.balanceAfter, 7.25);
});

// --- using a reward ---------------------------------------------------------

const COUPONS = [
  { id: "r1", shopItemId: "milk-tea", status: "available", redeemedAt: "2026-08-01T10:00:00.000Z", itemSnapshot: { name: "奶茶" } },
  { id: "r2", shopItemId: "milk-tea", status: "available", redeemedAt: "2026-08-02T10:00:00.000Z", itemSnapshot: { name: "奶茶" } },
  { id: "r3", shopItemId: "game", status: "used", redeemedAt: "2026-07-01T10:00:00.000Z", itemSnapshot: { name: "巫师三" } },
];

test("planUseReward: picks the OLDEST available copy, and only one", () => {
  const picked = planUseReward({ instances: COUPONS, query: "奶茶" });
  assert.equal(picked.ok, true);
  assert.equal(picked.instance.id, "r1");
  assert.equal(picked.remainingSameKind, 1);
});

test("planUseReward: an already-used instance is refused rather than silently using another", () => {
  const picked = planUseReward({ instances: COUPONS, rewardInstanceId: "r3" });
  assert.equal(picked.ok, false);
  assert.equal(picked.code, ERROR_CODES.REWARD_NOT_AVAILABLE);
});

test("planUseReward: two different kinds matching the words asks instead of guessing", () => {
  const mixed = [
    { id: "x", shopItemId: "game-1h", status: "available", redeemedAt: "2026-08-01T10:00:00.000Z", itemSnapshot: { name: "游戏时间 1 小时" } },
    { id: "y", shopItemId: "game-2h", status: "available", redeemedAt: "2026-08-02T10:00:00.000Z", itemSnapshot: { name: "游戏时间 2 小时" } },
  ];
  const picked = planUseReward({ instances: mixed, query: "游戏时间" });
  assert.equal(picked.code, ERROR_CODES.AMBIGUOUS_MATCH);
  assert.equal(picked.details.candidates.length, 2);
});

test("planUseReward: nothing owned is a clean no-match, not a crash", () => {
  assert.equal(planUseReward({ instances: [], query: "奶茶" }).code, ERROR_CODES.NO_MATCH);
});

// --- ledger -----------------------------------------------------------------

test("buildTransactionEntry: amount is always stored positive; direction lives in the type", () => {
  const entry = buildTransactionEntry({ type: "redeem", amount: -30, balanceBefore: 100, balanceAfter: 70, source: "shop_redeem" });
  assert.equal(entry.amount, 30);
  assert.equal(entry.balanceAfter, 70);
  assert.throws(() => buildTransactionEntry({ type: "bogus", amount: 1, balanceBefore: 0, balanceAfter: 0, source: "x" }), /unsupported transaction type/);
});

test("buildAccountPatch: counters accumulate, they are not overwritten", () => {
  const patch = buildAccountPatch({ points: 100, rewardTotalSpent: 40 }, { balanceAfter: 70, spentDelta: 30 });
  assert.equal(patch.points, 70);
  assert.equal(patch.rewardTotalSpent, 70);
  assert.equal(patch.rewardTotalEarned, 0);
});

test("summarizeAccount: today's earn/spend is derived from the ledger, not a stored counter", () => {
  const summary = summarizeAccount(
    { points: 12, rewardTotalEarned: 100, rewardTotalSpent: 88 },
    [
      { type: "earn", amount: 5, createdAt: "2026-08-03T20:00:00.000Z" }, // 08-04 Beijing
      { type: "redeem", amount: 3, createdAt: "2026-08-03T20:30:00.000Z" },
      { type: "earn", amount: 50, createdAt: "2026-07-01T00:00:00.000Z" }, // other day, ignored
    ],
    { todayKey: "2026-08-04" }
  );
  assert.equal(summary.balance, 12);
  assert.equal(summary.todayEarned, 5);
  assert.equal(summary.todaySpent, 3);
  assert.equal(summary.totalEarned, 100);
});

test("projectShopItem: a chat-safe projection falls back to the legacy note as the description", () => {
  const projected = projectShopItem({ id: "p", name: "奶茶", price: 5, note: "原味", categoryId: "life", status: "paused" });
  assert.equal(projected.description, "原味");
  assert.equal(projected.status, "inactive");
  assert.equal(projected.stock, null);
});
