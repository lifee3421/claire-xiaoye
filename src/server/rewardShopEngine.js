// The single implementation of every reward/shop write.
//
// It never imports a Firestore SDK. Instead it is handed a small "port"
// object that knows how to talk to one (admin on the server, the web SDK in
// the browser), so the browser and the signed Cyberboss endpoint literally
// execute the same redeem/use/create/update code path — no duplicated
// point-deduction logic anywhere.
//
// Port contract (see rewardShopAdminPort.js / ../services/rewardShopClientPort.js):
//   runTransaction(fn)                  -> Promise<result>, fn(tx)
//   profileRef()                        -> ref
//   getProfile()                        -> Promise<{ exists, id, data }>
//   ref(collectionName, docId?)         -> ref (auto id when docId omitted; ref.id is readable)
//   txGet(tx, ref)                      -> Promise<{ exists, id, data }>
//   txSet(tx, ref, data, options?)      -> void
//   listDocs(collectionName, options?)  -> Promise<Array<{ id, ...data }>>
//   getDoc(collectionName, docId)       -> Promise<{ exists, id, data }>
//   serverTimestamp()                   -> sentinel
//   now()                               -> Date
//
// Firestore requires every read in a transaction to happen before the first
// write; every method below is written that way on purpose.

import {
  ERROR_CODES,
  POINT_TRANSACTIONS_COLLECTION,
  PRODUCTS_COLLECTION,
  REDEMPTIONS_COLLECTION,
  REWARD_IDEMPOTENCY_COLLECTION,
  REWARD_INSTANCES_COLLECTION,
  REWARD_SHOP_SCHEMA_VERSION,
  affordabilityOf,
  beijingDayKey,
  buildTransactionEntry,
  domainError,
  filterShopItems,
  matchShopItems,
  normalizeIdempotencyKey,
  normalizeShopItemInput,
  normalizeText,
  planRedemption,
  planUseReward,
  projectRewardInstance,
  projectShopItem,
  projectTransaction,
  resolveListingStatus,
  summarizeAccount,
} from "./rewardShopCore.js";

const DEFAULT_TRANSACTION_LIMIT = 20;
const MAX_TRANSACTION_LIMIT = 100;
const TODAY_SCAN_LIMIT = 80;

export function createRewardShopEngine(port, { actor = "web" } = {}) {
  if (!port) throw new Error("rewardShopEngine requires a Firestore port");

  function todayKey() {
    return beijingDayKey(port.now().toISOString());
  }

  async function readProducts() {
    return await port.listDocs(PRODUCTS_COLLECTION, {});
  }

  // --- reads ---------------------------------------------------------------

  async function getBalance() {
    const [profileSnap, recent] = await Promise.all([
      port.getProfile(),
      port.listDocs(POINT_TRANSACTIONS_COLLECTION, { orderByField: "createdAt", direction: "desc", limit: TODAY_SCAN_LIMIT }),
    ]);
    const profile = profileSnap.exists ? profileSnap.data : {};
    return { ok: true, account: summarizeAccount(profile, recent, { todayKey: todayKey() }) };
  }

  async function listTransactions({ limit = DEFAULT_TRANSACTION_LIMIT, type = "" } = {}) {
    const cappedLimit = Math.max(1, Math.min(MAX_TRANSACTION_LIMIT, Number(limit) || DEFAULT_TRANSACTION_LIMIT));
    const rows = await port.listDocs(POINT_TRANSACTIONS_COLLECTION, {
      orderByField: "createdAt",
      direction: "desc",
      limit: type ? MAX_TRANSACTION_LIMIT : cappedLimit,
    });
    const filtered = type ? rows.filter((row) => row.type === type) : rows;
    return { ok: true, transactions: filtered.slice(0, cappedLimit).map(projectTransaction) };
  }

  async function listShopItems({ includeInactive = false, maxPrice = null, category = "", query = "", affordableOnly = false } = {}) {
    const [items, balanceResult] = await Promise.all([readProducts(), getBalance()]);
    const balance = balanceResult.account.balance;
    const effectiveMaxPrice = affordableOnly && maxPrice === null ? balance : maxPrice;
    const filtered = filterShopItems(items, { includeInactive, maxPrice: effectiveMaxPrice, category, query });
    const projected = affordabilityOf(filtered.map(projectShopItem), balance).sort((a, b) => a.price - b.price);
    return { ok: true, items: projected, balance, totalCount: items.length };
  }

  async function listOwnedRewards({ status = "available", limit = 50 } = {}) {
    const rows = await port.listDocs(REWARD_INSTANCES_COLLECTION, {
      orderByField: "redeemedAt",
      direction: "desc",
      limit: Math.max(1, Math.min(200, Number(limit) || 50)),
    });
    const wanted = normalizeText(status, 20);
    const filtered = wanted && wanted !== "all" ? rows.filter((row) => (row.status || "available") === wanted) : rows;
    const projected = filtered.map(projectRewardInstance);
    const counts = rows.reduce((acc, row) => {
      const key = row.status || "available";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return { ok: true, rewards: projected, counts };
  }

  // --- item resolution (outside the transaction) ---------------------------

  /**
   * Turns "帮我换游戏" into a concrete item id, or an explicit ambiguity /
   * no-match error. Never guesses between two plausible items.
   */
  async function resolveShopItem({ itemId = "", query = "", includeInactive = true }) {
    if (itemId) {
      const snap = await port.getDoc(PRODUCTS_COLLECTION, itemId);
      if (!snap.exists) return domainError(ERROR_CODES.ITEM_NOT_FOUND, "找不到这个商品。", { itemId });
      return { ok: true, item: { id: snap.id, ...snap.data } };
    }
    const needle = normalizeText(query, 120);
    if (!needle) return domainError(ERROR_CODES.INVALID_INPUT, "需要提供 itemId 或商品名称。");
    const all = await readProducts();
    const pool = includeInactive ? all : all.filter((item) => resolveListingStatus(item) === "active");
    const { matches } = matchShopItems(pool, needle);
    if (matches.length === 0) return domainError(ERROR_CODES.NO_MATCH, `商城里没有找到和「${needle}」对得上的商品。`, { query: needle });
    if (matches.length > 1) {
      return domainError(ERROR_CODES.AMBIGUOUS_MATCH, `有 ${matches.length} 个商品都对得上「${needle}」，需要先确认是哪一个。`, {
        candidates: matches.map(projectShopItem),
      });
    }
    return { ok: true, item: matches[0] };
  }

  // --- writes --------------------------------------------------------------

  /**
   * `idempotencyKey` is optional here (unlike redeem/use) so the web admin UI
   * and older callers keep working, but when one is supplied a retry replays
   * the first creation instead of forking a second "奶茶" — which is exactly
   * what a re-delivered WeChat message used to do.
   */
  async function createShopItem({ idempotencyKey = "", ...input } = {}) {
    const normalized = normalizeShopItemInput(input, { existing: null });
    if (!normalized.valid) return domainError(ERROR_CODES.INVALID_INPUT, normalized.errors.join("；"), { errors: normalized.errors });

    // Re-using an existing product instead of creating a duplicate is the
    // caller's job via update_shop_item; here we only warn so the assistant
    // can surface it rather than silently forking a second "奶茶".
    const existingItems = await readProducts();
    const duplicate = existingItems.find((item) => normalizeText(item.name, 120) === normalized.patch.name);

    const idem = normalizeIdempotencyKey(idempotencyKey, { operation: "create" });
    const ref = port.ref(PRODUCTS_COLLECTION);
    const payload = {
      // An explicit sortOrder (the web editor sends one) wins; otherwise the
      // item lands at the end of the list, which is what 雪尘's callers want.
      sortOrder: (existingItems.length + 1) * 10,
      ...normalized.patch,
      schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
      createdAt: port.serverTimestamp(),
      updatedAt: port.serverTimestamp(),
    };

    const duplicateWarning = duplicate ? projectShopItem(duplicate) : null;
    if (!idem) {
      await port.runTransaction(async (tx) => {
        port.txSet(tx, ref, payload, { merge: true });
      });
      return { ok: true, item: projectShopItem({ id: ref.id, ...normalized.patch }), duplicateWarning };
    }

    const idemRef = port.ref(REWARD_IDEMPOTENCY_COLLECTION, idem.docId);
    return await port.runTransaction(async (tx) => {
      const idemSnap = await port.txGet(tx, idemRef);
      if (idemSnap.exists) {
        return { ...(idemSnap.data?.result || {}), ok: true, replayed: true };
      }
      port.txSet(tx, ref, payload, { merge: true });
      const result = { ok: true, item: projectShopItem({ id: ref.id, ...normalized.patch }), duplicateWarning };
      port.txSet(tx, idemRef, {
        schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
        operation: "create",
        key: idem.key,
        actor,
        result,
        createdAt: port.serverTimestamp(),
      });
      return result;
    });
  }

  async function updateShopItem({ itemId = "", query = "", ...input } = {}) {
    const resolved = await resolveShopItem({ itemId, query, includeInactive: true });
    if (!resolved.ok) return resolved;

    const normalized = normalizeShopItemInput(input, { existing: resolved.item });
    if (!normalized.valid) return domainError(ERROR_CODES.INVALID_INPUT, normalized.errors.join("；"), { errors: normalized.errors });

    const ref = port.ref(PRODUCTS_COLLECTION, resolved.item.id);
    await port.runTransaction(async (tx) => {
      port.txSet(tx, ref, { ...normalized.patch, updatedAt: port.serverTimestamp() }, { merge: true });
    });
    return {
      ok: true,
      item: projectShopItem({ ...resolved.item, ...normalized.patch }),
      before: projectShopItem(resolved.item),
      changed: Object.keys(normalized.patch),
    };
  }

  /**
   * Atomic redemption. One transaction performs, in order:
   *   idempotency check -> balance/stock/listing validation -> point debit ->
   *   stock decrement -> ledger row -> reward instance -> legacy 兑换记录.
   * Either all of it lands or none of it does, and the same idempotencyKey
   * can only ever produce one of each.
   */
  async function redeemShopItem({ itemId = "", query = "", idempotencyKey = "", note = "" } = {}) {
    const idem = normalizeIdempotencyKey(idempotencyKey, { operation: "redeem" });
    if (!idem) return domainError(ERROR_CODES.IDEMPOTENCY_REQUIRED, "兑换必须带一个至少 6 位的 idempotencyKey。");

    const resolved = await resolveShopItem({ itemId, query, includeInactive: true });
    if (!resolved.ok) return resolved;

    const itemRef = port.ref(PRODUCTS_COLLECTION, resolved.item.id);
    const idemRef = port.ref(REWARD_IDEMPOTENCY_COLLECTION, idem.docId);
    const profileRef = port.profileRef();

    return await port.runTransaction(async (tx) => {
      const [idemSnap, profileSnap, itemSnap] = await Promise.all([
        port.txGet(tx, idemRef),
        port.txGet(tx, profileRef),
        port.txGet(tx, itemRef),
      ]);

      if (idemSnap.exists) {
        // A WeChat re-delivery, a Cyberboss retry or a double click: return
        // the ORIGINAL outcome, write nothing.
        return { ...(idemSnap.data?.result || {}), ok: true, replayed: true };
      }
      if (!itemSnap.exists) return domainError(ERROR_CODES.ITEM_NOT_FOUND, "找不到这个商品。", { itemId: resolved.item.id });

      const item = { id: itemSnap.id, ...itemSnap.data };
      const profile = profileSnap.exists ? profileSnap.data : {};
      const plan = planRedemption({ item, profile, idempotencyKey: idem.key, source: actor, note });
      if (!plan.ok) return plan;

      const nowIso = port.now().toISOString();
      const instanceRef = port.ref(REWARD_INSTANCES_COLLECTION);
      const ledgerRef = port.ref(POINT_TRANSACTIONS_COLLECTION);
      const legacyRef = port.ref(REDEMPTIONS_COLLECTION);

      port.txSet(tx, profileRef, { ...plan.accountPatch, updatedAt: port.serverTimestamp() }, { merge: true });
      if (Object.keys(plan.itemPatch).length > 0) {
        port.txSet(tx, itemRef, { ...plan.itemPatch, updatedAt: port.serverTimestamp() }, { merge: true });
      }
      port.txSet(tx, instanceRef, {
        ...plan.rewardInstance,
        transactionId: ledgerRef.id,
        redeemedAt: port.serverTimestamp(),
        redeemedAtIso: nowIso,
        createdAt: port.serverTimestamp(),
        updatedAt: port.serverTimestamp(),
      });
      port.txSet(tx, ledgerRef, {
        ...buildTransactionEntry({ ...plan.transactionSeed, rewardInstanceId: instanceRef.id }),
        createdAt: port.serverTimestamp(),
        createdAtIso: nowIso,
      });
      port.txSet(tx, legacyRef, {
        ...plan.legacyRedemption,
        rewardInstanceId: instanceRef.id,
        transactionId: ledgerRef.id,
        createdAt: port.serverTimestamp(),
      });

      const result = {
        ok: true,
        itemId: item.id,
        itemName: plan.itemSnapshot.name,
        pricePaid: plan.price,
        balanceBefore: plan.balanceBefore,
        balanceAfter: plan.balanceAfter,
        stockAfter: plan.stockAfter,
        rewardInstanceId: instanceRef.id,
        transactionId: ledgerRef.id,
        rewardStatus: "available",
      };
      port.txSet(tx, idemRef, {
        schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
        operation: "redeem",
        key: idem.key,
        actor,
        result,
        createdAt: port.serverTimestamp(),
      });
      return result;
    });
  }

  /**
   * Consumes exactly one reward instance. Never touches points — using a
   * coupon you already paid for must not charge you twice.
   */
  async function useReward({ rewardInstanceId = "", itemId = "", query = "", idempotencyKey = "" } = {}) {
    const idem = normalizeIdempotencyKey(idempotencyKey, { operation: "use" });
    if (!idem) return domainError(ERROR_CODES.IDEMPOTENCY_REQUIRED, "使用奖励必须带一个至少 6 位的 idempotencyKey。");

    const instances = await port.listDocs(REWARD_INSTANCES_COLLECTION, { orderByField: "redeemedAt", direction: "desc", limit: 200 });
    const picked = planUseReward({ instances, rewardInstanceId, shopItemId: itemId, query });
    if (!picked.ok) return picked;

    const instanceRef = port.ref(REWARD_INSTANCES_COLLECTION, picked.instance.id);
    const idemRef = port.ref(REWARD_IDEMPOTENCY_COLLECTION, idem.docId);

    return await port.runTransaction(async (tx) => {
      const [idemSnap, instanceSnap] = await Promise.all([port.txGet(tx, idemRef), port.txGet(tx, instanceRef)]);
      if (idemSnap.exists) return { ...(idemSnap.data?.result || {}), ok: true, replayed: true };
      if (!instanceSnap.exists) return domainError(ERROR_CODES.REWARD_NOT_FOUND, "找不到这份奖励。");

      const current = { id: instanceSnap.id, ...instanceSnap.data };
      if ((current.status || "available") !== "available") {
        // Someone (another device, an earlier retry) consumed it between the
        // query above and this transaction — deliberately NOT an exception,
        // and deliberately never falls through to a second coupon.
        return domainError(ERROR_CODES.REWARD_NOT_AVAILABLE, `这份奖励已经是「${current.status}」了。`, { status: current.status });
      }

      const nowIso = port.now().toISOString();
      port.txSet(tx, instanceRef, {
        status: "used",
        usedAt: port.serverTimestamp(),
        usedAtIso: nowIso,
        updatedAt: port.serverTimestamp(),
      }, { merge: true });

      const result = {
        ok: true,
        rewardInstanceId: current.id,
        itemName: current.itemSnapshot?.name || "",
        status: "used",
        usedAt: nowIso,
        pointsCharged: 0,
        remainingSameKind: Math.max(0, Number(picked.remainingSameKind || 0)),
      };
      port.txSet(tx, idemRef, {
        schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
        operation: "use",
        key: idem.key,
        actor,
        result,
        createdAt: port.serverTimestamp(),
      });
      return result;
    });
  }

  /**
   * Removing a shop item is a catalogue edit, not a ledger event: it never
   * touches points, and already-redeemed rewardInstances keep their own
   * snapshot, so deleting the product does not erase what she already owns.
   */
  async function deleteShopItem({ itemId = "", query = "" } = {}) {
    const resolved = await resolveShopItem({ itemId, query, includeInactive: true });
    if (!resolved.ok) return resolved;

    const ref = port.ref(PRODUCTS_COLLECTION, resolved.item.id);
    await port.runTransaction(async (tx) => {
      port.txDelete(tx, ref);
    });
    return { ok: true, deleted: projectShopItem(resolved.item) };
  }

  return {
    getBalance,
    listTransactions,
    listShopItems,
    listOwnedRewards,
    resolveShopItem,
    createShopItem,
    updateShopItem,
    deleteShopItem,
    redeemShopItem,
    useReward,
  };
}
