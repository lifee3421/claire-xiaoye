// Action allow-list shared by the serverless endpoint and its tests.
//
// Deliberately a closed table rather than `engine[action](...)`: a caller can
// only ever reach these operations with these argument names, so no request
// body can invoke an unintended engine method or smuggle an extra field into
// a Firestore write.
//
// Not every action is exposed as a 雪尘 tool. `tool:false` operations are
// endpoint capabilities for trusted internal/web flows only; most importantly
// `publish_surprise_drop` is NOT callable from an ordinary user chat, so the
// user cannot turn “surprise” into a self-service free reroll button.

import { ERROR_CODES, domainError, normalizeText } from "./rewardShopCore.js";
import { CHALLENGE_ERROR } from "./rewardChallengeEngine.js";

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

  // --- challenge offers ---------------------------------------------------
  list_reward_challenges: {
    write: false,
    tool: true,
    run: (engine, payload) => engine.listRewardChallenges({ includeInactive: bool(payload.includeInactive) }),
  },
  get_reward_challenge_progress: {
    write: false,
    tool: true,
    run: (engine, payload) => engine.getRewardChallengeProgress({ challengeId: text(payload.challengeId, 120) }),
  },
  create_reward_challenge: {
    write: true,
    tool: true,
    run: (engine, payload) => engine.createRewardChallenge({
      title: payload.title,
      description: payload.description,
      rule: payload.rule,
      reward: payload.reward,
      pointPrice: payload.pointPrice,
      startsAt: payload.startsAt,
      expiresAt: payload.expiresAt,
      status: payload.status,
      createdBy: payload.createdBy || "snowdust",
      idempotencyKey: text(payload.idempotencyKey, 200),
    }),
  },
  claim_reward_challenge: {
    write: true,
    tool: true,
    run: (engine, payload) => engine.claimRewardChallenge({
      challengeId: text(payload.challengeId, 120),
      idempotencyKey: text(payload.idempotencyKey, 200),
    }),
  },

  // Surprise list is model-readable, but publishing is intentionally NOT a
  // chat tool. Cyberboss's internal/system path is the only intended caller.
  list_surprise_drops: {
    write: false,
    tool: true,
    run: (engine, payload) => engine.listSurpriseDrops({ includeExpired: bool(payload.includeExpired) }),
  },
  publish_surprise_drop: {
    write: true,
    tool: false,
    run: (engine, payload) => engine.publishSurpriseDrop({
      ...pickDefined(payload, [
        "name", "price", "description", "publicDescription", "revealDescription", "category",
        "stock", "status", "repeatable", ...EDITOR_FIELDS,
      ]),
      surprise: payload.surprise || {},
      idempotencyKey: text(payload.idempotencyKey, 200),
    }),
  },

  // Server-authoritative outbox. These are internal bridge operations, never
  // model-callable user tools.
  lease_reward_notification: {
    write: true,
    tool: false,
    run: (engine, payload) => engine.leaseRewardNotification({
      workerId: text(payload.workerId, 120),
      leaseMs: num(payload.leaseMs) || 120000,
    }),
  },
  ack_reward_notification: {
    write: true,
    tool: false,
    run: (engine, payload) => engine.ackRewardNotification({
      notificationId: text(payload.notificationId, 160),
      workerId: text(payload.workerId, 120),
    }),
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
 * Maps a domain error code to an HTTP status. Business refusals are 409 so
 * Cyberboss can tell “you cannot do that” apart from “the call broke”.
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
    case CHALLENGE_ERROR.NOT_FOUND:
    case CHALLENGE_ERROR.NOTIFICATION_NOT_FOUND:
      return 404;
    case ERROR_CODES.AMBIGUOUS_MATCH:
    case ERROR_CODES.ITEM_INACTIVE:
    case ERROR_CODES.OUT_OF_STOCK:
    case ERROR_CODES.INSUFFICIENT_POINTS:
    case ERROR_CODES.REWARD_NOT_AVAILABLE:
    case CHALLENGE_ERROR.NOT_ACTIVE:
    case CHALLENGE_ERROR.NOT_COMPLETE:
    case CHALLENGE_ERROR.ALREADY_CLAIMED:
    case CHALLENGE_ERROR.NOTIFICATION_LEASE_CONFLICT:
      return 409;
    default:
      return 400;
  }
}
