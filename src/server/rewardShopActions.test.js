// The action table is the contract between the server endpoint, browser, and
// Cyberboss. Pin the full surface so adding an action cannot silently drift.

import assert from "node:assert/strict";
import test from "node:test";
import {
  REWARD_SHOP_ACTIONS,
  REWARD_SHOP_ACTION_NAMES,
  REWARD_SHOP_TOOL_ACTIONS,
  REWARD_SHOP_INTERNAL_ACTIONS,
  isRewardShopAction,
  runRewardShopAction,
  statusForResult,
} from "./rewardShopActions.js";
import { createRewardShopFeatureEngine } from "./rewardShopFeatureEngine.js";
import { ERROR_CODES } from "./rewardShopCore.js";

const engineShape = createRewardShopFeatureEngine(
  new Proxy({}, { get() { throw new Error("port must not be touched while inspecting engine shape"); } }),
  { actor: "test" },
);

function spyEngine() {
  const seen = [];
  const engine = new Proxy({}, {
    get: (_target, prop) => (args) => {
      seen.push({ method: prop, args });
      return { ok: true };
    },
  });
  return { engine, seen };
}

test("every action declares write/tool/run", () => {
  for (const [name, action] of Object.entries(REWARD_SHOP_ACTIONS)) {
    assert.equal(typeof action.write, "boolean", `${name}.write`);
    assert.equal(typeof action.tool, "boolean", `${name}.tool`);
    assert.equal(typeof action.run, "function", `${name}.run`);
  }
});

test("endpoint surface contains the complete v2 reward contract", () => {
  assert.deepEqual([...REWARD_SHOP_ACTION_NAMES].sort(), [
    "ack_reward_notification",
    "claim_reward_challenge",
    "create_reward_challenge",
    "create_shop_item",
    "create_surprise_reward_challenge",
    "delete_shop_item",
    "get_reward_balance",
    "get_reward_challenge_progress",
    "get_reward_transactions",
    "lease_reward_notification",
    "list_owned_rewards",
    "list_reward_challenges",
    "list_shop_items",
    "list_surprise_drops",
    "publish_surprise_drop",
    "redeem_shop_item",
    "resolve_shop_item",
    "update_shop_item",
    "use_reward",
  ]);
});

test("model tools and internal actions partition the whole surface", () => {
  assert.equal(REWARD_SHOP_TOOL_ACTIONS.length, 13);
  assert.deepEqual([...REWARD_SHOP_INTERNAL_ACTIONS].sort(), [
    "ack_reward_notification",
    "create_surprise_reward_challenge",
    "delete_shop_item",
    "lease_reward_notification",
    "publish_surprise_drop",
    "resolve_shop_item",
  ]);
  assert.equal(REWARD_SHOP_TOOL_ACTIONS.length + REWARD_SHOP_INTERNAL_ACTIONS.length, REWARD_SHOP_ACTION_NAMES.length);
  for (const name of REWARD_SHOP_TOOL_ACTIONS) assert.ok(!REWARD_SHOP_INTERNAL_ACTIONS.includes(name));
});

test("surprise publication and notification plumbing are never model-callable", () => {
  for (const name of ["publish_surprise_drop", "create_surprise_reward_challenge", "lease_reward_notification", "ack_reward_notification"]) {
    assert.equal(REWARD_SHOP_ACTIONS[name].tool, false, name);
  }
  assert.equal(REWARD_SHOP_ACTIONS.delete_shop_item.tool, false);
  assert.equal(REWARD_SHOP_ACTIONS.resolve_shop_item.tool, false);
});

test("write flags match the v2 contract", () => {
  const writes = REWARD_SHOP_ACTION_NAMES.filter((name) => REWARD_SHOP_ACTIONS[name].write).sort();
  assert.deepEqual(writes, [
    "ack_reward_notification",
    "claim_reward_challenge",
    "create_reward_challenge",
    "create_shop_item",
    "create_surprise_reward_challenge",
    "delete_shop_item",
    "lease_reward_notification",
    "publish_surprise_drop",
    "redeem_shop_item",
    "update_shop_item",
    "use_reward",
  ]);
});

test("every action targets a method exposed by the composed feature engine", async () => {
  for (const name of REWARD_SHOP_ACTION_NAMES) {
    const { engine, seen } = spyEngine();
    await REWARD_SHOP_ACTIONS[name].run(engine, {});
    assert.equal(seen.length, 1, `${name} should call one method`);
    assert.equal(typeof engineShape[seen[0].method], "function", `${name} -> engine.${String(seen[0].method)}`);
  }
});

test("unknown and inherited action names are refused", async () => {
  assert.equal(isRewardShopAction("drop_database"), false);
  assert.equal(isRewardShopAction("toString"), false);
  assert.equal(isRewardShopAction("constructor"), false);
  const result = await runRewardShopAction({}, "drop_database", {});
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.INVALID_INPUT);
  assert.deepEqual(result.details.supported, [...REWARD_SHOP_ACTION_NAMES]);
});

test("a redemption payload cannot smuggle identity or balance fields", async () => {
  const { engine, seen } = spyEngine();
  await REWARD_SHOP_ACTIONS.redeem_shop_item.run(engine, {
    itemId: "milk-tea",
    idempotencyKey: "k",
    uid: "attacker",
    balance: 99999,
  });
  assert.deepEqual(Object.keys(seen[0].args).sort(), ["idempotencyKey", "itemId", "note", "query"]);
});

test("update forwards only fields actually sent", async () => {
  const { engine, seen } = spyEngine();
  await REWARD_SHOP_ACTIONS.update_shop_item.run(engine, { itemId: "milk-tea", price: 8 });
  assert.deepEqual(Object.keys(seen[0].args).sort(), ["itemId", "price", "query"]);
  assert.equal("description" in seen[0].args, false);
});

test("HTTP status mapping keeps business refusals distinct", () => {
  assert.equal(statusForResult({ ok: true }), 200);
  assert.equal(statusForResult({ ok: false, code: ERROR_CODES.INSUFFICIENT_POINTS }), 409);
  assert.equal(statusForResult({ ok: false, code: ERROR_CODES.NO_MATCH }), 404);
  assert.equal(statusForResult({ ok: false, code: ERROR_CODES.IDEMPOTENCY_REQUIRED }), 400);
});
