// Proves the browser no longer has a second implementation of "deduct points".
//
// Two guarantees are checked here, both against the REAL modules (loaded
// through scripts/testEsmLoader.mjs, which swaps only Firebase itself for the
// doubles in __test_mocks__/):
//
//   1. The Mall's four write paths (redeem / use / save / delete) go out over
//      HTTP to /api/reward-shop with a Firebase ID token, and touch Firestore
//      zero times on the way.
//   2. The client port's engine is exposed read-only, so nobody can quietly
//      re-introduce a client-side write later by reaching for it.

import test from "node:test";
import assert from "node:assert/strict";

import { redeemProduct, useRewardInstance, saveProduct, deleteProduct } from "./dataService.js";
import { callRewardShop, RewardShopApiError } from "./rewardShopApi.js";
import { createWebRewardShopReader, WEB_READ_ONLY_METHODS } from "./rewardShopClientPort.js";
import { auth } from "./__test_mocks__/firebase.mock.js";
import { __resetFirestoreMock, __setDocCalls, __batchCalls } from "./__test_mocks__/firestore.mock.js";

const UID = "claire-uid";
let calls = [];
let nextResponse = null;
const realFetch = globalThis.fetch;

function signIn(token = "id-token-abc") {
  auth.currentUser = { uid: UID, getIdToken: async () => token };
}

function respond(body, { status = 200, ok = true } = {}) {
  nextResponse = { status, ok, json: async () => body };
}

test.beforeEach(() => {
  __resetFirestoreMock();
  calls = [];
  signIn();
  respond({ ok: true });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (nextResponse instanceof Error) throw nextResponse;
    return nextResponse;
  };
});

test.after(() => {
  globalThis.fetch = realFetch;
  auth.currentUser = null;
});

const lastCall = () => calls[calls.length - 1];
const firestoreWrites = () => __setDocCalls.length + __batchCalls.length;

// --- the four Mall writes ---------------------------------------------------

test("redeemProduct: posts to the server with a bearer token and writes nothing client-side", async () => {
  respond({ ok: true, balance: 95 });
  const result = await redeemProduct(UID, { id: "milk-tea", price: 5 }, 100, { idempotencyKey: "web:abc" });

  assert.equal(result.balance, 95);
  assert.equal(calls.length, 1);
  assert.equal(lastCall().url, "/api/reward-shop");
  assert.equal(lastCall().init.method, "POST");
  assert.equal(lastCall().init.headers.Authorization, "Bearer id-token-abc");
  assert.equal(lastCall().body.action, "redeem_shop_item");
  assert.equal(lastCall().body.payload.itemId, "milk-tea");
  assert.equal(lastCall().body.payload.idempotencyKey, "web:abc");
  assert.equal(firestoreWrites(), 0, "the browser must not deduct points itself");
});

test("redeemProduct: refuses locally when the balance is short, without calling the server", async () => {
  await assert.rejects(() => redeemProduct(UID, { id: "expensive", price: 500 }, 10), /还差/);
  assert.equal(calls.length, 0, "an obviously unaffordable click does not need a round trip");
  assert.equal(firestoreWrites(), 0);
});

test("redeemProduct: mints an idempotency key when the caller does not supply one", async () => {
  await redeemProduct(UID, { id: "milk-tea", price: 5 }, 100);
  assert.ok(lastCall().body.payload.idempotencyKey, "a double tap must not be able to charge twice");
});

test("useRewardInstance: goes through the server and never flips the document itself", async () => {
  await useRewardInstance(UID, { rewardInstanceId: "reward-1", idempotencyKey: "web-use:1" });
  assert.equal(lastCall().body.action, "use_reward");
  assert.equal(lastCall().body.payload.rewardInstanceId, "reward-1");
  assert.equal(firestoreWrites(), 0);
});

test("saveProduct: a new card creates server-side, carrying the editor's own fields", async () => {
  await saveProduct(UID, {
    name: "海边散步",
    price: 15,
    categoryId: "life",
    icon: "🌊",
    rarity: "rare",
    status: "wishlist",
    imageUrl: "https://example.test/sea.png",
    sortOrder: 3,
  });

  assert.equal(lastCall().body.action, "create_shop_item");
  const payload = lastCall().body.payload;
  assert.equal(payload.name, "海边散步");
  assert.equal(payload.category, "life");
  assert.equal(payload.icon, "🌊");
  assert.equal(payload.rarity, "rare");
  assert.equal(payload.legacyStatus, "wishlist", "the Mall shelf state travels as legacyStatus, never as the listing status");
  assert.equal(payload.imageUrl, "https://example.test/sea.png");
  assert.equal(payload.sortOrder, 3);
  assert.equal(firestoreWrites(), 0);
});

test("saveProduct: an existing card updates server-side and addresses the row by id", async () => {
  await saveProduct(UID, { id: "milk-tea", name: "奶茶", price: 8, categoryId: "life" });
  assert.equal(lastCall().body.action, "update_shop_item");
  assert.equal(lastCall().body.payload.itemId, "milk-tea");
  assert.equal(lastCall().body.payload.price, 8);
  assert.equal(firestoreWrites(), 0);
});

test("deleteProduct: deletes server-side rather than calling deleteDoc in the page", async () => {
  await deleteProduct(UID, "milk-tea");
  assert.equal(lastCall().body.action, "delete_shop_item");
  assert.equal(lastCall().body.payload.itemId, "milk-tea");
  assert.equal(firestoreWrites(), 0);
});

// --- failure shapes ---------------------------------------------------------

test("a business refusal keeps its code so the UI can tell it apart from a crash", async () => {
  respond({ ok: false, code: "insufficient_points", message: "积分不够。" }, { status: 409, ok: false });
  const error = await callRewardShop("redeem_shop_item", { itemId: "x", idempotencyKey: "k" }).catch((e) => e);

  assert.ok(error instanceof RewardShopApiError);
  assert.equal(error.code, "insufficient_points");
  assert.equal(error.status, 409);
  assert.equal(error.message, "积分不够。");
});

test("a dropped connection reports the outcome as UNKNOWN, not as a failure", async () => {
  nextResponse = new TypeError("Failed to fetch");
  const error = await callRewardShop("redeem_shop_item", { itemId: "x", idempotencyKey: "k" }).catch((e) => e);

  assert.equal(error.code, "outcome_unknown", "the charge may or may not have landed — retrying the same key is the safe move");
  assert.match(error.message, /重试/);
});

test("a signed-out page fails before it can send anything", async () => {
  auth.currentUser = null;
  const error = await callRewardShop("get_balance").catch((e) => e);
  assert.equal(error.code, "unauthenticated");
  assert.equal(calls.length, 0);
});

test("a 500 with an unreadable body still throws instead of resolving", async () => {
  nextResponse = {
    status: 500,
    ok: false,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  };
  const error = await callRewardShop("get_balance").catch((e) => e);
  assert.ok(error instanceof RewardShopApiError);
  assert.equal(error.status, 500);
});

// --- the client port is read-only ------------------------------------------

test("createWebRewardShopReader exposes reads and NOTHING that writes", () => {
  const reader = createWebRewardShopReader(UID);
  assert.deepEqual(Object.keys(reader).sort(), [...WEB_READ_ONLY_METHODS].sort());

  for (const forbidden of ["redeemShopItem", "useReward", "createShopItem", "updateShopItem", "deleteShopItem"]) {
    assert.equal(reader[forbidden], undefined, `${forbidden} must not be reachable from the browser`);
    assert.throws(() => reader[forbidden](), TypeError, `calling ${forbidden} should be a hard TypeError, not a silent client-side write`);
  }
});

test("the reader is frozen, so a write cannot be bolted back on at runtime", () => {
  const reader = createWebRewardShopReader(UID);
  assert.equal(Object.isFrozen(reader), true);
  assert.throws(() => {
    "use strict";
    reader.redeemShopItem = async () => ({ ok: true });
  }, TypeError);
});

test("WEB_READ_ONLY_METHODS contains no verb that changes state", () => {
  for (const method of WEB_READ_ONLY_METHODS) {
    assert.match(method, /^(get|list|resolve)/, `${method} does not look like a read`);
  }
});
