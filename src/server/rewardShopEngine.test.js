// Engine tests against an in-memory Firestore double.
//
// The double enforces the two rules that actually matter for correctness
// here: a transaction's writes are buffered and only applied on success
// (so a mid-transaction refusal leaves NOTHING behind), and reads see the
// committed state. That is enough to prove the idempotency + atomicity
// guarantees without a live emulator.

import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "./rewardShopCore.js";
import { createRewardShopEngine } from "./rewardShopEngine.js";

const PROFILE = "__profile__";

function createMemoryPort({ profile = {}, collections = {} } = {}) {
  const store = { [PROFILE]: { ...profile } };
  for (const [name, rows] of Object.entries(collections)) {
    store[name] = {};
    for (const row of rows) store[name][row.id] = { ...row };
  }
  let autoId = 0;
  let clock = Date.parse("2026-08-04T12:00:00.000Z");

  const col = (name) => (store[name] = store[name] || {});
  const snapshotOf = (name, id) => {
    const bucket = name === PROFILE ? { [PROFILE]: store[PROFILE] } : col(name);
    const data = bucket[id];
    return { exists: Boolean(data), id, data: data ? { ...data } : null };
  };

  const port = {
    __store: store,
    profileRef: () => ({ __collection: PROFILE, id: PROFILE }),
    getProfile: async () => snapshotOf(PROFILE, PROFILE),
    ref(collectionName, docId) {
      autoId += 1;
      return { __collection: collectionName, id: docId || `auto-${autoId}` };
    },
    getDoc: async (collectionName, docId) => snapshotOf(collectionName, docId),
    async listDocs(collectionName, { orderByField = "", direction = "desc", limit = 0 } = {}) {
      let rows = Object.values(col(collectionName)).map((row) => ({ ...row }));
      if (orderByField) {
        // Mirrors Firestore: documents missing the ordering field drop out.
        rows = rows.filter((row) => row[orderByField] !== undefined && row[orderByField] !== null);
        rows.sort((a, b) => String(a[orderByField]).localeCompare(String(b[orderByField])) * (direction === "desc" ? -1 : 1));
      }
      return limit > 0 ? rows.slice(0, limit) : rows;
    },
    async runTransaction(fn) {
      const buffered = [];
      const tx = { __buffered: buffered };
      const result = await fn(tx);
      // A refusal (ok:false) still returns normally from the engine, so the
      // test double mirrors the real contract: the engine simply never
      // buffered any write on that path.
      for (const { op, ref, data, options } of buffered) {
        const bucket = ref.__collection === PROFILE ? store : col(ref.__collection);
        const key = ref.__collection === PROFILE ? PROFILE : ref.id;
        if (op === "delete") {
          delete bucket[key];
          continue;
        }
        bucket[key] = options?.merge ? { ...(bucket[key] || {}), ...data, id: key } : { ...data, id: key };
      }
      return result;
    },
    txGet: async (_tx, ref) => snapshotOf(ref.__collection, ref.id),
    txSet(tx, ref, data, options) {
      tx.__buffered.push({ op: "set", ref, data, options });
    },
    txDelete(tx, ref) {
      tx.__buffered.push({ op: "delete", ref });
    },
    serverTimestamp: () => new Date(clock).toISOString(),
    now: () => new Date(clock),
    __advance(ms) {
      clock += ms;
    },
  };
  return port;
}

const SHELF = [
  { id: "milk-tea", name: "奶茶", price: 5, categoryId: "life", note: "原味" },
  { id: "game-night", name: "游戏之夜", price: 30, categoryId: "games", stock: 1 },
  { id: "one-off", name: "一次性大奖", price: 10, categoryId: "life", repeatable: false },
  { id: "shelved", name: "已下架的东西", price: 1, categoryId: "life", status: "paused" },
];

function setup(points = 100) {
  const port = createMemoryPort({ profile: { points }, collections: { products: SHELF } });
  return { port, engine: createRewardShopEngine(port, { actor: "cyberboss" }) };
}

// --- reads ------------------------------------------------------------------

test("getBalance: reads the live profile, never a cached number", async () => {
  const { port, engine } = setup(42.5);
  const first = await engine.getBalance();
  assert.equal(first.account.balance, 42.5);

  port.__store[PROFILE].points = 7;
  const second = await engine.getBalance();
  assert.equal(second.account.balance, 7, "a second call must re-read, not reuse");
});

test("listShopItems: hides inactive items and marks what the current balance can afford", async () => {
  const { engine } = setup(10);
  const result = await engine.listShopItems({});
  const ids = result.items.map((item) => item.id);
  assert.ok(!ids.includes("shelved"), "a paused product must not be offered");
  assert.equal(result.balance, 10);
  assert.equal(result.items.find((item) => item.id === "milk-tea").affordable, true);
  assert.equal(result.items.find((item) => item.id === "game-night").affordable, false);
  assert.equal(result.items.find((item) => item.id === "game-night").shortBy, 20);
});

test("listShopItems: affordableOnly uses the real balance as the ceiling", async () => {
  const { engine } = setup(10);
  const result = await engine.listShopItems({ affordableOnly: true });
  assert.deepEqual(result.items.map((item) => item.id), ["milk-tea", "one-off"]);
});

test("listShopItems: with no filters the whole active shelf comes back", async () => {
  const { engine } = setup(1000);
  const result = await engine.listShopItems({});
  assert.equal(result.items.length, 3);
});

// --- disambiguation ---------------------------------------------------------

test("resolveShopItem: an unknown name is a clean no-match", async () => {
  const { engine } = setup();
  const result = await engine.resolveShopItem({ query: "不存在的东西" });
  assert.equal(result.code, ERROR_CODES.NO_MATCH);
});

test("resolveShopItem: two equally good matches ask instead of picking", async () => {
  const port = createMemoryPort({
    profile: { points: 100 },
    collections: {
      products: [
        { id: "a", name: "游戏时间 1 小时", price: 10 },
        { id: "b", name: "游戏时间 2 小时", price: 20 },
      ],
    },
  });
  const engine = createRewardShopEngine(port, { actor: "cyberboss" });
  const result = await engine.resolveShopItem({ query: "游戏时间" });
  assert.equal(result.code, ERROR_CODES.AMBIGUOUS_MATCH);
  assert.equal(result.details.candidates.length, 2);
});

// --- redemption -------------------------------------------------------------

test("redeemShopItem: one call debits points, writes one ledger row, one reward and one legacy record", async () => {
  const { port, engine } = setup(100);
  const result = await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "wx-msg-0001" });

  assert.equal(result.ok, true);
  assert.equal(result.pricePaid, 5);
  assert.equal(result.balanceAfter, 95);
  assert.equal(result.rewardStatus, "available");

  assert.equal(port.__store[PROFILE].points, 95);
  assert.equal(port.__store[PROFILE].rewardTotalSpent, 5);
  assert.equal(Object.keys(port.__store.pointTransactions).length, 1);
  assert.equal(Object.keys(port.__store.rewardInstances).length, 1);
  assert.equal(Object.keys(port.__store.redemptions).length, 1);

  const ledger = Object.values(port.__store.pointTransactions)[0];
  assert.equal(ledger.type, "redeem");
  assert.equal(ledger.amount, 5);
  assert.equal(ledger.balanceBefore, 100);
  assert.equal(ledger.balanceAfter, 95);
  assert.equal(ledger.rewardInstanceId, result.rewardInstanceId);

  const reward = Object.values(port.__store.rewardInstances)[0];
  assert.equal(reward.status, "available");
  assert.equal(reward.itemSnapshot.name, "奶茶");
  assert.equal(reward.source, "cyberboss");
});

test("redeemShopItem: the SAME idempotency key never charges twice (WeChat re-delivery / retry / double tap)", async () => {
  const { port, engine } = setup(100);
  const first = await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "wx-msg-0001" });
  const second = await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "wx-msg-0001" });

  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.rewardInstanceId, first.rewardInstanceId, "a replay returns the ORIGINAL reward");
  assert.equal(port.__store[PROFILE].points, 95, "the balance moved exactly once");
  assert.equal(Object.keys(port.__store.pointTransactions).length, 1);
  assert.equal(Object.keys(port.__store.rewardInstances).length, 1);
  assert.equal(Object.keys(port.__store.redemptions).length, 1);
});

test("redeemShopItem: five concurrent replays of one key still produce exactly one redemption", async () => {
  const { port, engine } = setup(100);
  const results = [];
  for (let index = 0; index < 5; index += 1) {
    results.push(await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "wx-msg-burst" }));
  }
  assert.ok(results.every((result) => result.ok));
  assert.equal(results.filter((result) => result.replayed).length, 4);
  assert.equal(port.__store[PROFILE].points, 95);
  assert.equal(Object.keys(port.__store.rewardInstances).length, 1);
});

test("redeemShopItem: a DIFFERENT key is a genuine second purchase", async () => {
  const { port, engine } = setup(100);
  await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "wx-msg-0001" });
  await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "wx-msg-0002" });
  assert.equal(port.__store[PROFILE].points, 90);
  assert.equal(Object.keys(port.__store.rewardInstances).length, 2);
});

test("redeemShopItem: refuses without an idempotency key rather than risking a double charge", async () => {
  const { port, engine } = setup(100);
  const result = await engine.redeemShopItem({ query: "奶茶" });
  assert.equal(result.code, ERROR_CODES.IDEMPOTENCY_REQUIRED);
  assert.equal(port.__store[PROFILE].points, 100);
});

test("redeemShopItem: not enough points writes absolutely nothing", async () => {
  const { port, engine } = setup(3);
  const result = await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "wx-msg-broke" });
  assert.equal(result.code, ERROR_CODES.INSUFFICIENT_POINTS);
  assert.equal(result.details.shortBy, 2);
  assert.equal(port.__store[PROFILE].points, 3);
  assert.equal(port.__store.pointTransactions, undefined);
  assert.equal(port.__store.rewardInstances, undefined);
});

test("redeemShopItem: a stale caller cannot overdraw — the balance is re-read inside the transaction", async () => {
  const { port, engine } = setup(100);
  // Someone else (the web page) spends first.
  port.__store[PROFILE].points = 2;
  const result = await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "wx-msg-stale" });
  assert.equal(result.code, ERROR_CODES.INSUFFICIENT_POINTS);
  assert.equal(port.__store[PROFILE].points, 2);
});

test("redeemShopItem: the last unit sells out and takes the item off the shelf", async () => {
  const { port, engine } = setup(100);
  const result = await engine.redeemShopItem({ query: "游戏之夜", idempotencyKey: "wx-msg-stock" });
  assert.equal(result.stockAfter, 0);
  assert.equal(port.__store.products["game-night"].stock, 0);
  assert.equal(port.__store.products["game-night"].listingStatus, "inactive");

  const again = await engine.redeemShopItem({ query: "游戏之夜", idempotencyKey: "wx-msg-stock-2" });
  assert.equal(again.code, ERROR_CODES.ITEM_INACTIVE);
});

test("redeemShopItem: a non-repeatable item is retired after being claimed", async () => {
  const { port, engine } = setup(100);
  await engine.redeemShopItem({ itemId: "one-off", idempotencyKey: "wx-msg-oneoff" });
  assert.equal(port.__store.products["one-off"].status, "redeemed");
  assert.equal(port.__store.products["one-off"].listingStatus, "inactive");
  const again = await engine.redeemShopItem({ itemId: "one-off", idempotencyKey: "wx-msg-oneoff-2" });
  assert.equal(again.code, ERROR_CODES.ITEM_INACTIVE);
});

test("redeemShopItem: an inactive item is refused", async () => {
  const { engine } = setup(100);
  const result = await engine.redeemShopItem({ itemId: "shelved", idempotencyKey: "wx-msg-shelved" });
  assert.equal(result.code, ERROR_CODES.ITEM_INACTIVE);
});

// --- using a reward ---------------------------------------------------------

test("useReward: consuming a reward costs nothing and flips exactly one instance", async () => {
  const { port, engine } = setup(100);
  await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "buy-order-1" });
  port.__advance(1000);
  await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "buy-order-2" });
  assert.equal(port.__store[PROFILE].points, 90);

  const used = await engine.useReward({ query: "奶茶", idempotencyKey: "use-token-1" });
  assert.equal(used.ok, true);
  assert.equal(used.pointsCharged, 0);
  assert.equal(port.__store[PROFILE].points, 90, "using must never touch the balance");

  const statuses = Object.values(port.__store.rewardInstances).map((row) => row.status).sort();
  assert.deepEqual(statuses, ["available", "used"], "exactly one of the two coupons is consumed");
});

test("useReward: replaying the same key does not burn a second coupon", async () => {
  const { port, engine } = setup(100);
  await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "buy-order-1" });
  port.__advance(1000);
  await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "buy-order-2" });

  const first = await engine.useReward({ query: "奶茶", idempotencyKey: "use-same" });
  const second = await engine.useReward({ query: "奶茶", idempotencyKey: "use-same" });
  assert.equal(second.replayed, true);
  assert.equal(second.rewardInstanceId, first.rewardInstanceId);
  assert.equal(Object.values(port.__store.rewardInstances).filter((row) => row.status === "used").length, 1);
});

test("useReward: owning nothing is a no-match, not an accidental purchase", async () => {
  const { port, engine } = setup(100);
  const result = await engine.useReward({ query: "奶茶", idempotencyKey: "use-nothing" });
  assert.equal(result.code, ERROR_CODES.NO_MATCH);
  assert.equal(port.__store[PROFILE].points, 100, "wanting to use something you do not own must NOT buy it");
});

test("listOwnedRewards: separates 待使用 from 已使用", async () => {
  const { engine } = setup(100);
  await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "buy-order-1" });
  await engine.useReward({ query: "奶茶", idempotencyKey: "use-token-1" });

  const available = await engine.listOwnedRewards({ status: "available" });
  assert.equal(available.rewards.length, 0);
  const all = await engine.listOwnedRewards({ status: "all" });
  assert.equal(all.rewards.length, 1);
  assert.equal(all.counts.used, 1);
});

// --- shop maintenance -------------------------------------------------------

test("createShopItem: writes an active, unlimited-stock product and warns about a same-name duplicate", async () => {
  const { port, engine } = setup();
  const created = await engine.createShopItem({ name: "泡澡半小时", price: 12, description: "热水澡", category: "life" });
  assert.equal(created.ok, true);
  assert.equal(created.item.price, 12);
  assert.equal(created.item.stock, null);
  assert.equal(created.item.status, "active");
  assert.equal(created.duplicateWarning, null);
  assert.equal(port.__store.products[created.item.id].name, "泡澡半小时");

  const dupe = await engine.createShopItem({ name: "泡澡半小时", price: 20 });
  assert.equal(dupe.ok, true);
  assert.ok(dupe.duplicateWarning, "a same-name product must be surfaced so 雪尘 can offer to update instead");
});

test("createShopItem: an invalid price is rejected before anything is written", async () => {
  const { port, engine } = setup();
  const before = Object.keys(port.__store.products).length;
  const result = await engine.createShopItem({ name: "坏商品", price: -5 });
  assert.equal(result.code, ERROR_CODES.INVALID_INPUT);
  assert.equal(Object.keys(port.__store.products).length, before);
});

test("updateShopItem: patches only what was asked and leaves the rest intact", async () => {
  const { port, engine } = setup();
  const result = await engine.updateShopItem({ query: "奶茶", price: 8 });
  assert.equal(result.ok, true);
  assert.equal(result.before.price, 5);
  assert.equal(result.item.price, 8);
  assert.deepEqual(result.changed, ["price"]);
  assert.equal(port.__store.products["milk-tea"].name, "奶茶");
  assert.equal(port.__store.products["milk-tea"].note, "原味", "an unmentioned field must survive");
});

test("updateShopItem: 下架 hides the item from both the new and the legacy filter", async () => {
  const { port, engine } = setup();
  await engine.updateShopItem({ query: "奶茶", status: "下架" });
  assert.equal(port.__store.products["milk-tea"].listingStatus, "inactive");
  assert.equal(port.__store.products["milk-tea"].status, "paused");
  const listed = await engine.listShopItems({});
  assert.ok(!listed.items.some((item) => item.id === "milk-tea"));
});

test("updateShopItem: an ambiguous name is refused rather than editing the wrong product", async () => {
  const port = createMemoryPort({
    profile: { points: 10 },
    collections: {
      products: [
        { id: "a", name: "游戏时间 1 小时", price: 10 },
        { id: "b", name: "游戏时间 2 小时", price: 20 },
      ],
    },
  });
  const engine = createRewardShopEngine(port, { actor: "cyberboss" });
  const result = await engine.updateShopItem({ query: "游戏时间", price: 99 });
  assert.equal(result.code, ERROR_CODES.AMBIGUOUS_MATCH);
  assert.equal(port.__store.products.a.price, 10);
  assert.equal(port.__store.products.b.price, 20);
});

test("createShopItem: carries the Mall editor's own fields instead of dropping them", async () => {
  const { port, engine } = setup();
  const created = await engine.createShopItem({
    name: "海边散步",
    price: 15,
    category: "life",
    icon: "🌊",
    rarity: "rare",
    priority: "high",
    imageUrl: "https://example.test/sea.png",
    limitedUntil: "2026-12-31",
    legacyStatus: "wishlist",
    sortOrder: 5,
  });
  assert.equal(created.ok, true);
  const stored = port.__store.products[created.item.id];
  assert.equal(stored.icon, "🌊", "the editor's icon must survive the round trip through the server");
  assert.equal(stored.rarity, "rare");
  assert.equal(stored.priority, "high");
  assert.equal(stored.imageUrl, "https://example.test/sea.png");
  assert.equal(stored.limitedUntil, "2026-12-31");
  assert.equal(stored.status, "wishlist", "the Mall shelf state is the editor's, not the listing state");
  assert.equal(stored.listingStatus, "active");
  assert.equal(stored.sortOrder, 5, "an explicit sortOrder beats the append-to-end default");
});

test("createShopItem: a bogus legacyStatus is refused rather than written through", async () => {
  const { port, engine } = setup();
  const before = Object.keys(port.__store.products).length;
  const result = await engine.createShopItem({ name: "怪东西", price: 1, legacyStatus: "whatever" });
  assert.equal(result.code, ERROR_CODES.INVALID_INPUT);
  assert.ok(result.details.errors.some((message) => message.includes("legacyStatus")));
  assert.equal(Object.keys(port.__store.products).length, before);
});

test("updateShopItem: moving a card to 已兑换 in the Mall does not touch the listing state", async () => {
  const { port, engine } = setup();
  const result = await engine.updateShopItem({ itemId: "milk-tea", legacyStatus: "redeemed" });
  assert.equal(result.ok, true);
  assert.equal(port.__store.products["milk-tea"].status, "redeemed");
  assert.equal(port.__store.products["milk-tea"].listingStatus, undefined, "the shelf card state is not the same thing as 下架");
  assert.equal(port.__store.products["milk-tea"].price, 5, "an unmentioned field must survive");
});

test("deleteShopItem: removes the product and reports what was removed", async () => {
  const { port, engine } = setup();
  const result = await engine.deleteShopItem({ query: "奶茶" });
  assert.equal(result.ok, true);
  assert.equal(result.deleted.name, "奶茶");
  assert.equal(result.deleted.price, 5);
  assert.equal(port.__store.products["milk-tea"], undefined, "the row is gone, not merely hidden");
  const listed = await engine.listShopItems({});
  assert.ok(!listed.items.some((item) => item.id === "milk-tea"));
});

test("deleteShopItem: an already-下架 item can still be deleted", async () => {
  const { port, engine } = setup();
  const result = await engine.deleteShopItem({ query: "已下架的东西" });
  assert.equal(result.ok, true);
  assert.equal(port.__store.products.shelved, undefined);
});

test("deleteShopItem: an unknown name deletes nothing", async () => {
  const { port, engine } = setup();
  const before = Object.keys(port.__store.products).length;
  const result = await engine.deleteShopItem({ query: "根本不存在的东西" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.NO_MATCH);
  assert.equal(Object.keys(port.__store.products).length, before);
});

test("deleteShopItem: an ambiguous name is refused rather than deleting the wrong product", async () => {
  const port = createMemoryPort({
    profile: { points: 10 },
    collections: {
      products: [
        { id: "a", name: "游戏时间 1 小时", price: 10 },
        { id: "b", name: "游戏时间 2 小时", price: 20 },
      ],
    },
  });
  const engine = createRewardShopEngine(port, { actor: "web" });
  const result = await engine.deleteShopItem({ query: "游戏时间" });
  assert.equal(result.code, ERROR_CODES.AMBIGUOUS_MATCH);
  assert.equal(Object.keys(port.__store.products).length, 2, "deleting is irreversible — a guess is not acceptable");
});

// --- ledger view ------------------------------------------------------------

test("listTransactions: newest first, and the type filter works", async () => {
  const { port, engine } = setup(100);
  await engine.redeemShopItem({ query: "奶茶", idempotencyKey: "buy-order-1" });
  port.__advance(60_000);
  await engine.redeemShopItem({ itemId: "one-off", idempotencyKey: "buy-order-2" });

  const all = await engine.listTransactions({ limit: 10 });
  assert.equal(all.transactions.length, 2);
  assert.equal(all.transactions[0].description, "兑换 一次性大奖", "newest first");
  assert.equal(all.transactions[0].signedAmount, -10, "a redeem shows as negative");

  const filtered = await engine.listTransactions({ type: "earn" });
  assert.equal(filtered.transactions.length, 0);
});
