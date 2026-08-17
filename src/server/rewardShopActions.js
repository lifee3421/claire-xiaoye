// Action allow-list shared by the serverless endpoint and its tests.
//
// Deliberately a closed table rather than `engine[action](...)`: a caller can
// only ever reach these operations with these argument names, so no request
// body can invoke an unintended engine method or smuggle an extra field into
// a Firestore write.
//
// Not every action is exposed as a 雪尘 tool, and that difference is declared
// here rather than left as an unexplained count mismatch between the two
// repos. Each entry carries `tool: true|false`:
//
//   tool:true  — Cyberboss registers a model-callable tool for it (8 today).
//   tool:false — the action exists on the endpoint but is NOT something the
//                model may invoke: `resolve_shop_item` is an internal
//                disambiguation lookup, `delete_shop_item` is the web Mall's
//                irreversible "删除商品" button and has no business being
//                triggered by a sentence in a chat window.
//
// Cyberboss's contract test reads BOTH lists off this file, so the endpoint
// surface, the client service and the registered tool set are checked against
// each other instead of being counted by hand.

import { ERROR_CODES, domainError, normalizeText } from "./rewardShopCore.js";

// Presentation fields the Mall product editor owns. Listed once so create and
// update can never drift apart on what the web form is allowed to send.
const EDITOR_FIELDS = Object.freeze(["icon", "imageUrl", "rarity", "priority", "limitedUntil", "sortOrder", "note", "legacyStatus"]);

const bool = (value, fallback = false) => (typeof value === "boolean" ? value : fallback);
const num = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
const text = (value, max = 200) => normalizeText(typeof value === "string" ? value : "", max);

export const REWARD_SHOP_ACTIONS = Object.freeze({
  get_reward_balance: {
    write: false,
    tool: true,
    run: (engine) => engine.getBalance(),
  },
  get_reward_transactions: {
    write: false,
    tool: true,
    run: (engine, payload) => engine.listTransactions({ limit: num(payload.limit), type: text(payload.type, 20) }),
  },
  list_shop_items: {
    write: false,
    tool: true,
    run: (engine, payload) =>
      engine.listShopItems({
        includeInactive: bool(payload.includeInactive),
        maxPrice: num(payload.maxPrice),
        category: text(payload.category, 60),
        query: text(payload.query, 120),
        affordableOnly: bool(payload.affordableOnly),
      }),
  },
  list_owned_rewards: {
    write: false,
    tool: true,
    run: (engine, payload) => engine.listOwnedRewards({ status: text(payload.status, 20) || "available", limit: num(payload.limit) || 50 }),
  },
  create_shop_item: {
    write: true,
    tool: true,
    run: (engine, payload) =>
      engine.createShopItem({
        name: payload.name,
        price: payload.price,
        description: payload.description,
        category: payload.category,
        stock: payload.stock,
        status: payload.status,
        repeatable: payload.repeatable,
        ...pickDefined(payload, EDITOR_FIELDS),
        // Optional: when present, a retried create replays instead of adding
        // a second copy of the same item.
        idempotencyKey: text(payload.idempotencyKey, 200),
      }),
  },
  update_shop_item: {
    write: true,
    tool: true,
    run: (engine, payload) =>
      engine.updateShopItem({
        itemId: text(payload.itemId, 120),
        query: text(payload.query, 120),
        ...pickDefined(payload, ["name", "price", "description", "category", "stock", "status", "repeatable", ...EDITOR_FIELDS]),
      }),
  },
  delete_shop_item: {
    write: true,
    tool: false,
    run: (engine, payload) => engine.deleteShopItem({ itemId: text(payload.itemId, 120), query: text(payload.query, 120) }),
  },
  redeem_shop_item: {
    write: true,
    tool: true,
    run: (engine, payload) =>
      engine.redeemShopItem({
        itemId: text(payload.itemId, 120),
        query: text(payload.query, 120),
        idempotencyKey: text(payload.idempotencyKey, 200),
        note: text(payload.note, 300),
      }),
  },
  use_reward: {
    write: true,
    tool: true,
    run: (engine, payload) =>
      engine.useReward({
        rewardInstanceId: text(payload.rewardInstanceId, 120),
        itemId: text(payload.itemId, 120),
        query: text(payload.query, 120),
        idempotencyKey: text(payload.idempotencyKey, 200),
      }),
  },
  resolve_shop_item: {
    write: false,
    tool: false,
    run: (engine, payload) => engine.resolveShopItem({ itemId: text(payload.itemId, 120), query: text(payload.query, 120), includeInactive: bool(payload.includeInactive, true) }),
  },
});

/** Only forwards keys the caller actually sent, so an update never blanks a field by omission. */
function pickDefined(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** Every action the endpoint accepts. Cyberboss's client service mirrors this list exactly. */
export const REWARD_SHOP_ACTION_NAMES = Object.freeze(Object.keys(REWARD_SHOP_ACTIONS));

/** The subset Cyberboss registers as model-callable tools. */
export const REWARD_SHOP_TOOL_ACTIONS = Object.freeze(REWARD_SHOP_ACTION_NAMES.filter((name) => REWARD_SHOP_ACTIONS[name].tool));

/** Reachable over HTTP but never handed to the model — see the header note for why. */
export const REWARD_SHOP_INTERNAL_ACTIONS = Object.freeze(REWARD_SHOP_ACTION_NAMES.filter((name) => !REWARD_SHOP_ACTIONS[name].tool));

export function isRewardShopAction(action) {
  return Object.prototype.hasOwnProperty.call(REWARD_SHOP_ACTIONS, action);
}

export async function runRewardShopAction(engine, action, payload = {}) {
  if (!isRewardShopAction(action)) {
    return domainError(ERROR_CODES.INVALID_INPUT, `不支持的操作：${action}`, { supported: Object.keys(REWARD_SHOP_ACTIONS) });
  }
  return await REWARD_SHOP_ACTIONS[action].run(engine, payload || {});
}

/**
 * Maps a domain error code to an HTTP status. Business refusals ("积分不够",
 * "已下架") are 409 — the request was well-formed and authenticated, the
 * state just does not allow it — so Cyberboss can tell "you cannot do that"
 * apart from "the call broke".
 */
export function statusForResult(result) {
  if (result?.ok) return 200;
  switch (result?.code) {
    case ERROR_CODES.INVALID_INPUT:
    case ERROR_CODES.IDEMPOTENCY_REQUIRED:
      return 400;
    case ERROR_CODES.ITEM_NOT_FOUND:
    case ERROR_CODES.REWARD_NOT_FOUND:
    case ERROR_CODES.NO_MATCH:
      return 404;
    case ERROR_CODES.AMBIGUOUS_MATCH:
      return 409;
    case ERROR_CODES.ITEM_INACTIVE:
    case ERROR_CODES.OUT_OF_STOCK:
    case ERROR_CODES.INSUFFICIENT_POINTS:
    case ERROR_CODES.REWARD_NOT_AVAILABLE:
      return 409;
    default:
      return 400;
  }
}
