// The action table is the contract between three things that live apart: the
// serverless endpoint, the browser's write client, and Cyberboss's tool set.
// These tests pin the table itself, so a drift shows up here first rather
// than as a 400 in WeChat.

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
import { createRewardShopEngine } from "./rewardShopEngine.js";
import { ERROR_CODES } from "./rewardShopCore.js";

// A real engine instance, built over a port that would throw if touched — we
// only need its shape (which methods exist), not its behaviour.
const engineShape = createRewardShopEngine(
  new Proxy(
    {},
    {
      get() {
        throw new Error("the port must not be touched while inspecting the engine's shape");
      },
    }
  ),
  { actor: "test" }
);

/** Records which engine method an action's `run` reaches for. */
function spyEngine() {
  const seen = [];
  const engine = new Proxy(
    {},
    {
      get: (_target, prop) => (args) => {
        seen.push({ method: prop, args });
        return { ok: true };
      },
    }
  );
  return { engine, seen };
}

test("every entry declares write, tool and run — no half-registered action", () => {
  for (const [name, action] of Object.entries(REWARD_SHOP_ACTIONS)) {
    assert.equal(typeof action.write, "boolean", `${name}.write must be declared`);
    assert.equal(typeof action.tool, "boolean", `${name}.tool must be declared`);
    assert.equal(typeof action.run, "function", `${name}.run must be a function`);
  }
});

test("the endpoint surface is exactly these ten actions", () => {
  assert.deepEqual([...REWARD_SHOP_ACTION_NAMES].sort(), [
    "create_shop_item",
    "delete_shop_item",
    "get_reward_balance",
    "get_reward_transactions",
    "list_owned_rewards",
    "list_shop_items",
    "redeem_shop_item",
    "resolve_shop_item",
    "update_shop_item",
    "use_reward",
  ]);
});

test("eight of them are model-callable tools; the other two are deliberately not", () => {
  assert.equal(REWARD_SHOP_TOOL_ACTIONS.length, 8);
  assert.deepEqual([...REWARD_SHOP_INTERNAL_ACTIONS].sort(), ["delete_shop_item", "resolve_shop_item"]);
  // The reason each one is held back, restated as an assertion so removing
  // the reason means failing the test rather than silently widening 雪尘's
  // reach.
  assert.equal(REWARD_SHOP_ACTIONS.resolve_shop_item.write, false, "internal lookup: read-only");
  assert.equal(REWARD_SHOP_ACTIONS.delete_shop_item.write, true, "web-only: irreversible, so not exposed to the model");
});

test("tool + internal partition the whole surface, with no overlap", () => {
  assert.equal(REWARD_SHOP_TOOL_ACTIONS.length + REWARD_SHOP_INTERNAL_ACTIONS.length, REWARD_SHOP_ACTION_NAMES.length);
  for (const name of REWARD_SHOP_TOOL_ACTIONS) assert.ok(!REWARD_SHOP_INTERNAL_ACTIONS.includes(name));
});

test("the write flags match reality — reads are marked read-only", () => {
  const writes = REWARD_SHOP_ACTION_NAMES.filter((name) => REWARD_SHOP_ACTIONS[name].write).sort();
  assert.deepEqual(writes, ["create_shop_item", "delete_shop_item", "redeem_shop_item", "update_shop_item", "use_reward"]);
});

test("every action calls an engine method that actually exists", async () => {
  for (const name of REWARD_SHOP_ACTION_NAMES) {
    const { engine, seen } = spyEngine();
    await REWARD_SHOP_ACTIONS[name].run(engine, {});
    assert.equal(seen.length, 1, `${name} must call exactly one engine method`);
    assert.equal(typeof engineShape[seen[0].method], "function", `${name} calls engine.${seen[0].method}(), which the engine does not expose`);
  }
});

test("an unknown action is refused by name, with the supported list attached", async () => {
  assert.equal(isRewardShopAction("drop_database"), false);
  const result = await runRewardShopAction({}, "drop_database", {});
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.INVALID_INPUT);
  assert.deepEqual(result.details.supported, [...REWARD_SHOP_ACTION_NAMES]);
});

test("inherited properties are not actions", () => {
  assert.equal(isRewardShopAction("toString"), false);
  assert.equal(isRewardShopAction("constructor"), false);
});

test("a payload cannot smuggle extra fields into a write", async () => {
  const { engine, seen } = spyEngine();
  await REWARD_SHOP_ACTIONS.redeem_shop_item.run(engine, {
    itemId: "milk-tea",
    idempotencyKey: "k",
    uid: "attacker",
    balance: 99999,
    __proto__: { polluted: true },
  });
  assert.deepEqual(Object.keys(seen[0].args).sort(), ["idempotencyKey", "itemId", "note", "query"]);
});

test("update_shop_item forwards only the fields that were actually sent", async () => {
  const { engine, seen } = spyEngine();
  await REWARD_SHOP_ACTIONS.update_shop_item.run(engine, { itemId: "milk-tea", price: 8 });
  assert.deepEqual(Object.keys(seen[0].args).sort(), ["itemId", "price", "query"]);
  assert.equal("description" in seen[0].args, false, "an omitted field must not be blanked");
});

test("create_shop_item accepts the Mall editor's fields", async () => {
  const { engine, seen } = spyEngine();
  await REWARD_SHOP_ACTIONS.create_shop_item.run(engine, { name: "海边散步", price: 15, icon: "🌊", legacyStatus: "wishlist", sortOrder: 3 });
  assert.equal(seen[0].args.icon, "🌊");
  assert.equal(seen[0].args.legacyStatus, "wishlist");
  assert.equal(seen[0].args.sortOrder, 3);
});

test("HTTP status mapping distinguishes 'you cannot do that' from 'the call broke'", () => {
  assert.equal(statusForResult({ ok: true }), 200);
  assert.equal(statusForResult({ ok: false, code: ERROR_CODES.INSUFFICIENT_POINTS }), 409);
  assert.equal(statusForResult({ ok: false, code: ERROR_CODES.AMBIGUOUS_MATCH }), 409);
  assert.equal(statusForResult({ ok: false, code: ERROR_CODES.NO_MATCH }), 404);
  assert.equal(statusForResult({ ok: false, code: ERROR_CODES.IDEMPOTENCY_REQUIRED }), 400);
  assert.equal(statusForResult({ ok: false, code: "something_new" }), 400);
});
