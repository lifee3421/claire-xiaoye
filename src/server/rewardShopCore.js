// Pure, framework-free core of the reward/shop domain.
//
// Deliberately isomorphic: NO firebase import (client or admin), NO node:
// builtins. Both executors run the exact same decision logic through it —
// the browser (src/services/rewardShopClientPort.js, used by dataService)
// and the signed serverless endpoint (api/reward-shop.js via
// src/server/rewardShopAdminPort.js). That is what makes "redeem" have a
// single implementation instead of one per caller.
//
// Nothing here reads or writes anything. Every function is
// (current state) -> (decision + the exact documents to write), so the whole
// of the interesting logic — price/stock/balance validation, idempotency,
// the earn/redeem/refund ledger shape — is unit-testable under plain
// `node --test` with no Firestore at all.
//
// Single source of truth note: the balance stays `users/{uid}.points`, the
// field the app has always used. This module never introduces a second
// balance; totals (rewardTotalEarned/rewardTotalSpent) are derived counters
// maintained alongside it, and the ledger is the audit trail.

import { roundPoints } from "../utils/calculations.js";

export const REWARD_SHOP_SCHEMA_VERSION = 1;

// Collections under users/{uid}. `products` and `redemptions` already exist
// and keep their meaning; the other three are new.
export const PRODUCTS_COLLECTION = "products";
export const REDEMPTIONS_COLLECTION = "redemptions";
export const POINT_TRANSACTIONS_COLLECTION = "pointTransactions";
export const REWARD_INSTANCES_COLLECTION = "rewardInstances";
export const REWARD_IDEMPOTENCY_COLLECTION = "rewardIdempotency";

export const TRANSACTION_TYPES = Object.freeze(["earn", "redeem", "refund", "adjustment"]);
export const REWARD_INSTANCE_STATUSES = Object.freeze(["available", "used", "expired", "cancelled"]);
export const LISTING_STATUSES = Object.freeze(["active", "inactive"]);
// The shelf state the Mall UI has always used, kept separate from the
// active/inactive listing state 雪尘 talks about. Both live on the same
// document, so the domain model has to accept both or the web product editor
// could not go through the server without losing a field.
export const LEGACY_SHELF_STATUSES = Object.freeze(["available", "wishlist", "paused", "redeemed"]);

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  ITEM_NOT_FOUND: "item_not_found",
  ITEM_INACTIVE: "item_inactive",
  OUT_OF_STOCK: "out_of_stock",
  INSUFFICIENT_POINTS: "insufficient_points",
  AMBIGUOUS_MATCH: "ambiguous_match",
  NO_MATCH: "no_match",
  REWARD_NOT_FOUND: "reward_not_found",
  REWARD_NOT_AVAILABLE: "reward_not_available",
  IDEMPOTENCY_REQUIRED: "idempotency_required",
});

export function domainError(code, message, details = {}) {
  return { ok: false, code, message, details };
}

/** Positive-integer point price. Balances may be fractional (work credit), prices may not. */
export function normalizePrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (!Number.isInteger(numeric)) return null;
  if (numeric < 0) return null;
  return numeric;
}

/** `null` means unlimited stock. A number must be a non-negative integer. */
export function normalizeStock(value) {
  if (value === null || value === undefined || value === "" || value === "unlimited") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) return undefined;
  return numeric;
}

export function normalizeText(value, maxLength = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/**
 * Listing status with a backward-compatible derivation for every product
 * that predates the `listingStatus` field, so no migration is REQUIRED for
 * reads to be correct (scripts/backfill-reward-shop.mjs only materializes
 * the same answer).
 *
 * Legacy semantics being preserved:
 *   status "paused"                      -> the app's existing "off shelf"
 *   status "redeemed" && repeatable false -> a one-off already claimed
 */
export function resolveListingStatus(item) {
  const explicit = item?.listingStatus;
  if (explicit === "active" || explicit === "inactive") return explicit;
  if (item?.status === "paused") return "inactive";
  if (item?.status === "redeemed" && item?.repeatable === false) return "inactive";
  return "active";
}

export function resolveStock(item) {
  return normalizeStock(item?.stock) ?? null;
}

/** Public, chat-safe projection of a shop item. */
export function projectShopItem(item) {
  return {
    id: item.id,
    name: normalizeText(item.name, 120),
    description: normalizeText(item.description || item.note || "", 500),
    price: Number(item.price) || 0,
    category: normalizeText(item.categoryId || "", 60),
    stock: resolveStock(item),
    status: resolveListingStatus(item),
    repeatable: item.repeatable !== false,
    createdAt: toIsoLike(item.createdAt),
    updatedAt: toIsoLike(item.updatedAt),
  };
}

export function projectRewardInstance(instance) {
  return {
    id: instance.id,
    shopItemId: instance.shopItemId || "",
    name: instance.itemSnapshot?.name || "",
    pricePaid: Number(instance.pricePaid) || 0,
    status: instance.status || "available",
    redeemedAt: toIsoLike(instance.redeemedAt),
    usedAt: toIsoLike(instance.usedAt),
    source: instance.source || "",
    itemSnapshot: instance.itemSnapshot || null,
  };
}

export function projectTransaction(entry) {
  return {
    id: entry.id,
    type: entry.type || "adjustment",
    amount: Number(entry.amount) || 0,
    signedAmount: signedAmountOf(entry),
    balanceBefore: Number(entry.balanceBefore) || 0,
    balanceAfter: Number(entry.balanceAfter) || 0,
    source: entry.source || "",
    itemId: entry.itemId || "",
    rewardInstanceId: entry.rewardInstanceId || "",
    description: entry.description || "",
    createdAt: toIsoLike(entry.createdAt),
  };
}

export function signedAmountOf(entry) {
  const amount = Math.abs(Number(entry?.amount) || 0);
  if (entry?.type === "redeem") return -amount;
  if (entry?.type === "adjustment") return roundPoints(Number(entry?.balanceAfter || 0) - Number(entry?.balanceBefore || 0));
  return amount;
}

/**
 * Firestore Timestamp | Date | ISO string | serverTimestamp sentinel -> ISO
 * string (or "" when it cannot be known yet, e.g. an unresolved sentinel).
 */
export function toIsoLike(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") {
    try { return value.toDate().toISOString(); } catch { return ""; }
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  if (typeof value?._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  return "";
}

// --- Idempotency ------------------------------------------------------------

const IDEMPOTENCY_MIN_LENGTH = 6;
const IDEMPOTENCY_MAX_LENGTH = 200;

/** Small, dependency-free FNV-1a so the same helper works in the browser. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * An idempotency key is caller-supplied free text (Cyberboss derives it from
 * the WeChat message id, the web from a click nonce). It becomes a Firestore
 * document id, so it is sanitized AND suffixed with a hash of the original —
 * two different keys can never collapse onto the same document just because
 * their unsafe characters normalize the same way.
 */
export function normalizeIdempotencyKey(rawKey, { operation = "" } = {}) {
  const key = normalizeText(rawKey, IDEMPOTENCY_MAX_LENGTH);
  if (key.length < IDEMPOTENCY_MIN_LENGTH) return null;
  const safe = key.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120);
  const scope = operation ? `${operation}:` : "";
  return { key, docId: `${scope}${safe}.${fnv1a(`${scope}${key}`)}`.replace(/\//g, "_") };
}

// --- Shop item input --------------------------------------------------------

const DEFAULT_CATEGORY_ID = "custom";

/**
 * Validates and normalizes a create/update payload for a shop item.
 * `existing` is null for create. Returns only the keys that should actually
 * be written, so an update never silently clears a field the caller did not
 * mention.
 */
export function normalizeShopItemInput(input = {}, { existing = null } = {}) {
  const errors = [];
  const patch = {};
  const isCreate = !existing;

  if (input.name !== undefined) {
    const name = normalizeText(input.name, 120);
    if (!name) errors.push("name 不能为空");
    else patch.name = name;
  } else if (isCreate) {
    errors.push("name 是必填项");
  }

  if (input.price !== undefined) {
    const price = normalizePrice(input.price);
    if (price === null) errors.push("price 必须是非负整数积分");
    else patch.price = price;
  } else if (isCreate) {
    errors.push("price 是必填项");
  }

  if (input.description !== undefined) patch.description = normalizeText(input.description, 500);
  if (input.note !== undefined) patch.note = normalizeText(input.note, 500);

  if (input.category !== undefined || input.categoryId !== undefined) {
    const category = normalizeText(input.category ?? input.categoryId, 60);
    patch.categoryId = category || DEFAULT_CATEGORY_ID;
  } else if (isCreate) {
    patch.categoryId = DEFAULT_CATEGORY_ID;
  }

  if (input.stock !== undefined) {
    const stock = normalizeStock(input.stock);
    if (stock === undefined) errors.push("stock 必须是非负整数，或留空表示不限库存");
    else patch.stock = stock;
  } else if (isCreate) {
    patch.stock = null;
  }

  if (input.status !== undefined || input.listingStatus !== undefined) {
    const raw = normalizeText(input.status ?? input.listingStatus, 20);
    const status = raw === "上架" ? "active" : raw === "下架" ? "inactive" : raw;
    if (!LISTING_STATUSES.includes(status)) errors.push(`status 只能是 ${LISTING_STATUSES.join(" / ")}`);
    else {
      patch.listingStatus = status;
      // Keep the legacy shelf field coherent so the existing Mall filter and
      // any older view agree with the new field instead of fighting it.
      if (status === "inactive") patch.status = "paused";
      else if (existing?.status === "paused" || (isCreate && !input.legacyStatus)) patch.status = "wishlist";
    }
  } else if (isCreate) {
    patch.listingStatus = "active";
    patch.status = "wishlist";
  }

  // The Mall editor's own shelf state. Passed as `legacyStatus` so it can
  // never be confused with the listing status above, and validated rather
  // than written through, so the endpoint stays a narrow door.
  if (input.legacyStatus !== undefined) {
    const legacy = normalizeText(input.legacyStatus, 20);
    if (!LEGACY_SHELF_STATUSES.includes(legacy)) errors.push(`legacyStatus 只能是 ${LEGACY_SHELF_STATUSES.join(" / ")}`);
    else patch.status = legacy;
  }

  if (isCreate) {
    patch.repeatable = input.repeatable === undefined ? true : input.repeatable !== false;
  } else if (input.repeatable !== undefined) {
    patch.repeatable = input.repeatable !== false;
  }

  // Presentation-only fields. They carry no business rule, but the web editor
  // owns them, so update has to accept them too — otherwise routing the editor
  // through the server would silently drop the icon every time she saved.
  const presentation = [
    ["rarity", 30, isCreate ? "common" : undefined],
    ["icon", 30, isCreate ? "" : undefined],
    ["priority", 30, isCreate ? "normal" : undefined],
    ["limitedUntil", 30, isCreate ? "" : undefined],
    ["imageUrl", 500, isCreate ? "" : undefined],
  ];
  for (const [field, max, fallback] of presentation) {
    if (input[field] !== undefined) patch[field] = normalizeText(input[field], max);
    else if (fallback !== undefined) patch[field] = fallback;
  }

  if (input.sortOrder !== undefined) {
    const sortOrder = Number(input.sortOrder);
    if (!Number.isFinite(sortOrder)) errors.push("sortOrder 必须是数字");
    else patch.sortOrder = sortOrder;
  }

  if (Object.keys(patch).length === 0) errors.push("没有需要更新的字段");

  return { valid: errors.length === 0, errors, patch };
}

// --- Matching / disambiguation ---------------------------------------------

/**
 * Scores items against a free-text name the user said in chat. Never picks
 * for the caller when it is genuinely ambiguous — returns every top-scoring
 * candidate so the assistant can ask which one, per the ambiguity rules.
 */
export function matchShopItems(items, query) {
  const needle = normalizeText(query, 120).toLowerCase();
  if (!needle) return { matches: [], ambiguous: false };
  const scored = [];
  for (const item of items) {
    const name = normalizeText(item.name, 120).toLowerCase();
    if (!name) continue;
    let score = 0;
    if (name === needle) score = 100;
    else if (name.includes(needle)) score = 70 - Math.min(20, name.length - needle.length);
    else if (needle.includes(name)) score = 60 - Math.min(20, needle.length - name.length);
    else {
      // Character-overlap fallback, deliberately strict. A bare "share >= 2
      // characters" rule is far too loose for Chinese — "不存在的东西" and
      // "已下架的东西" share 的/东/西 and would "match", which for a
      // redemption means spending points on the wrong thing. Requiring the
      // overlap to cover most of the shorter string keeps useful near-misses
      // (巫师三 / 巫师3) while rejecting coincidental filler characters.
      const overlap = countCharOverlap(name, needle);
      const shorter = Math.min(new Set(name).size, new Set(needle).size);
      if (overlap >= 2 && shorter >= 2 && overlap / shorter >= 0.6) score = 20 + overlap;
    }
    if (score > 0) scored.push({ item, score });
  }
  if (scored.length === 0) return { matches: [], ambiguous: false };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const matches = scored.filter((entry) => entry.score === best).map((entry) => entry.item);
  return { matches, ambiguous: matches.length > 1 };
}

function countCharOverlap(a, b) {
  const set = new Set(a);
  let overlap = 0;
  const seen = new Set();
  for (const char of b) {
    if (set.has(char) && !seen.has(char)) { overlap += 1; seen.add(char); }
  }
  return overlap;
}

export function filterShopItems(items, { includeInactive = false, maxPrice = null, category = "", query = "" } = {}) {
  let result = items.map((item) => ({ ...item, __listingStatus: resolveListingStatus(item) }));
  if (!includeInactive) result = result.filter((item) => item.__listingStatus === "active");
  // Guarding on null/"" explicitly: Number(null) is 0 and IS finite, so a
  // bare `Number.isFinite(Number(maxPrice))` would treat "no ceiling" as
  // "nothing above 0 points" and silently return an empty shelf.
  const hasCeiling = maxPrice !== null && maxPrice !== undefined && maxPrice !== "" && Number.isFinite(Number(maxPrice));
  if (hasCeiling) result = result.filter((item) => (Number(item.price) || 0) <= Number(maxPrice));
  const categoryNeedle = normalizeText(category, 60);
  if (categoryNeedle) result = result.filter((item) => normalizeText(item.categoryId, 60) === categoryNeedle);
  const queryNeedle = normalizeText(query, 120);
  if (queryNeedle) {
    const { matches } = matchShopItems(result, queryNeedle);
    const ids = new Set(matches.map((item) => item.id));
    result = result.filter((item) => ids.has(item.id));
  }
  return result.map(({ __listingStatus, ...item }) => item);
}

// --- Ledger entry construction ---------------------------------------------

/**
 * The one place a ledger row is shaped. `createdAt` is left to the caller's
 * SDK (serverTimestamp sentinel) so the row is server-time ordered.
 */
export function buildTransactionEntry({
  type,
  amount,
  balanceBefore,
  balanceAfter,
  source,
  itemId = "",
  rewardInstanceId = "",
  description = "",
  idempotencyKey = "",
  actor = "web",
}) {
  if (!TRANSACTION_TYPES.includes(type)) throw new Error(`unsupported transaction type: ${type}`);
  return {
    schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
    type,
    amount: roundPoints(Math.abs(Number(amount) || 0)),
    balanceBefore: roundPoints(balanceBefore),
    balanceAfter: roundPoints(balanceAfter),
    source: normalizeText(source, 60) || "unknown",
    itemId: normalizeText(itemId, 120),
    rewardInstanceId: normalizeText(rewardInstanceId, 120),
    description: normalizeText(description, 300),
    idempotencyKey: normalizeText(idempotencyKey, IDEMPOTENCY_MAX_LENGTH),
    actor: normalizeText(actor, 30) || "web",
  };
}

/**
 * Profile-level counters that travel with every balance change. Kept next to
 * `points` on users/{uid} rather than in a second document so there is
 * exactly one place a balance can be read from.
 */
export function buildAccountPatch(profile, { balanceAfter, earnedDelta = 0, spentDelta = 0 }) {
  return {
    points: roundPoints(balanceAfter),
    rewardTotalEarned: roundPoints(Number(profile?.rewardTotalEarned || 0) + Number(earnedDelta || 0)),
    rewardTotalSpent: roundPoints(Number(profile?.rewardTotalSpent || 0) + Number(spentDelta || 0)),
  };
}

// --- Redemption planning ----------------------------------------------------

/**
 * The heart of the feature: given the CURRENT item + profile as read inside
 * a transaction, decide whether the redemption may happen and produce every
 * document to write. Validation order is deliberate and matches the spec:
 * exists -> active -> stock -> balance.
 */
export function planRedemption({ item, profile, idempotencyKey = "", source = "web", nowIso = "", note = "" }) {
  if (!item) return domainError(ERROR_CODES.ITEM_NOT_FOUND, "找不到这个商品。");

  const listingStatus = resolveListingStatus(item);
  if (listingStatus !== "active") {
    return domainError(ERROR_CODES.ITEM_INACTIVE, `「${item.name}」已经下架了。`, { itemId: item.id, name: item.name });
  }

  const stock = resolveStock(item);
  if (stock !== null && stock <= 0) {
    return domainError(ERROR_CODES.OUT_OF_STOCK, `「${item.name}」库存不足。`, { itemId: item.id, name: item.name, stock });
  }

  const price = Number(item.price) || 0;
  const balanceBefore = roundPoints(Number(profile?.points || 0));
  if (balanceBefore < price) {
    return domainError(ERROR_CODES.INSUFFICIENT_POINTS, `积分不够，还差 ${roundPoints(price - balanceBefore)} 分。`, {
      itemId: item.id,
      name: item.name,
      price,
      balance: balanceBefore,
      shortBy: roundPoints(price - balanceBefore),
    });
  }

  const balanceAfter = roundPoints(balanceBefore - price);
  const nextStock = stock === null ? null : stock - 1;

  // itemSnapshot is why a later price/name edit can never rewrite history —
  // the reward instance keeps what was actually paid, for what, at the time.
  const itemSnapshot = {
    name: normalizeText(item.name, 120),
    price,
    categoryId: normalizeText(item.categoryId, 60),
    description: normalizeText(item.description || "", 500),
    note: normalizeText(item.note || "", 500),
    icon: normalizeText(item.icon || "", 30),
  };

  const itemPatch = {};
  if (nextStock !== null) itemPatch.stock = nextStock;
  if (item.repeatable === false) {
    itemPatch.status = "redeemed";
    itemPatch.listingStatus = "inactive";
  } else if (nextStock === 0) {
    itemPatch.listingStatus = "inactive";
    itemPatch.status = "paused";
  }

  return {
    ok: true,
    price,
    balanceBefore,
    balanceAfter,
    stockBefore: stock,
    stockAfter: nextStock,
    itemSnapshot,
    itemPatch,
    accountPatch: buildAccountPatch(profile, { balanceAfter, spentDelta: price }),
    rewardInstance: {
      schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
      shopItemId: item.id,
      itemSnapshot,
      pricePaid: price,
      status: "available",
      usedAt: null,
      expiresAt: null,
      idempotencyKey: normalizeText(idempotencyKey, IDEMPOTENCY_MAX_LENGTH),
      source: normalizeText(source, 30) || "web",
      note: normalizeText(note, 300),
    },
    // Legacy mirror so the existing 兑换记录 view keeps working unchanged.
    legacyRedemption: {
      productId: item.id,
      productName: itemSnapshot.name,
      categoryId: itemSnapshot.categoryId,
      price,
      remainingPoints: balanceAfter,
      note: itemSnapshot.note,
      source: normalizeText(source, 30) || "web",
    },
    transactionSeed: {
      type: "redeem",
      amount: price,
      balanceBefore,
      balanceAfter,
      source: source === "cyberboss" ? "cyberboss_shop_redeem" : "shop_redeem",
      itemId: item.id,
      description: `兑换 ${itemSnapshot.name}`,
      idempotencyKey,
      actor: source,
    },
    nowIso,
  };
}

/**
 * Picks EXACTLY ONE reward instance to consume. Two identical coupons must
 * never both flip to used, so this always returns a single id — the oldest
 * available one — and the caller re-reads that one document inside the
 * transaction before writing.
 */
export function planUseReward({ instances = [], rewardInstanceId = "", shopItemId = "", query = "" }) {
  const available = instances.filter((instance) => (instance.status || "available") === "available");

  if (rewardInstanceId) {
    const target = instances.find((instance) => instance.id === rewardInstanceId);
    if (!target) return domainError(ERROR_CODES.REWARD_NOT_FOUND, "找不到这份奖励。");
    if ((target.status || "available") !== "available") {
      return domainError(ERROR_CODES.REWARD_NOT_AVAILABLE, `这份奖励已经是「${target.status}」状态了。`, { status: target.status });
    }
    return { ok: true, instance: target };
  }

  let candidates = available;
  if (shopItemId) candidates = candidates.filter((instance) => instance.shopItemId === shopItemId);
  if (query) {
    const named = candidates.map((instance) => ({ ...instance, name: instance.itemSnapshot?.name || "" }));
    const { matches } = matchShopItems(named, query);
    const distinctItems = new Set(matches.map((instance) => instance.shopItemId || instance.itemSnapshot?.name || instance.id));
    if (matches.length > 0 && distinctItems.size > 1) {
      return domainError(ERROR_CODES.AMBIGUOUS_MATCH, "有多种奖励都对得上，需要先确认是哪一个。", {
        candidates: matches.map((instance) => projectRewardInstance(instance)),
      });
    }
    candidates = matches;
  }

  if (candidates.length === 0) return domainError(ERROR_CODES.NO_MATCH, "没有找到可用的奖励。");

  // Oldest first — a coupon you got earlier gets consumed earlier.
  const sorted = [...candidates].sort((a, b) => String(toIsoLike(a.redeemedAt)).localeCompare(String(toIsoLike(b.redeemedAt))));
  return { ok: true, instance: sorted[0], remainingSameKind: sorted.length - 1 };
}

// --- Balance / ledger summaries --------------------------------------------

export const BEIJING_OFFSET_MINUTES = 8 * 60;

export function beijingDayKey(value) {
  const iso = toIsoLike(value);
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + BEIJING_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Chat-facing balance summary. `todayEarned`/`todaySpent` come from the
 * ledger itself, never from a running total kept somewhere else.
 */
export function summarizeAccount(profile, transactions = [], { todayKey = "" } = {}) {
  const balance = roundPoints(Number(profile?.points || 0));
  let todayEarned = 0;
  let todaySpent = 0;
  for (const entry of transactions) {
    if (todayKey && beijingDayKey(entry.createdAt) !== todayKey) continue;
    const signed = signedAmountOf(entry);
    if (signed >= 0) todayEarned = roundPoints(todayEarned + signed);
    else todaySpent = roundPoints(todaySpent - signed);
  }
  return {
    balance,
    totalEarned: roundPoints(Number(profile?.rewardTotalEarned || 0)),
    totalSpent: roundPoints(Number(profile?.rewardTotalSpent || 0)),
    todayEarned,
    todaySpent,
    todayKey,
    updatedAt: toIsoLike(profile?.updatedAt),
  };
}

export function affordabilityOf(items, balance) {
  const numericBalance = roundPoints(Number(balance) || 0);
  return items.map((item) => ({
    ...item,
    affordable: (Number(item.price) || 0) <= numericBalance,
    shortBy: Math.max(0, roundPoints((Number(item.price) || 0) - numericBalance)),
  }));
}
