import { ERROR_CODES, domainError } from "./rewardShopCore.js";
import { createRewardShopEngine } from "./rewardShopEngine.js";
import { createRewardChallengeEngine } from "./rewardChallengeEngine.js";
import { surpriseAvailability } from "./rewardSurpriseCore.js";

/**
 * Composition root for reward-shop v2 features.
 *
 * Existing points/shop/reward methods remain in rewardShopEngine.js. This
 * wrapper only adds the one cross-cutting rule a surprise item needs: its
 * availability window must affect the ordinary catalogue and redemption path,
 * not just the dedicated "惊喜上新" view.
 */
export function createRewardShopFeatureEngine(port, options = {}) {
  const base = createRewardShopEngine(port, options);
  const challenge = createRewardChallengeEngine(port, options);

  async function listShopItems(args = {}) {
    const result = await base.listShopItems(args);
    if (!result?.ok || args.includeInactive) return result;

    const surpriseResult = await challenge.listSurpriseDrops({ includeExpired: true });
    if (!surpriseResult?.ok) return result;
    const availabilityById = new Map(
      (surpriseResult.items || []).map((item) => [item.id, item.surprise?.availability]),
    );
    const items = (result.items || []).filter((item) => {
      const availability = availabilityById.get(item.id);
      return !availability || availability.available === true;
    });
    return { ...result, items, visibleCount: items.length };
  }

  async function resolveShopItem(args = {}) {
    const result = await base.resolveShopItem(args);
    if (!result?.ok || args.includeInactive) return result;
    const availability = surpriseAvailability(result.item, { now: port.now() });
    if (availability.surprise && !availability.available) {
      return unavailableSurprise(result.item, availability.reason);
    }
    return result;
  }

  async function redeemShopItem(args = {}) {
    // Preflight the live surprise window before entering the existing atomic
    // redemption implementation. The normal path remains untouched; this only
    // blocks a drop that has not started / expired / sold out / been paused.
    const resolved = await base.resolveShopItem({
      itemId: args.itemId || "",
      query: args.query || "",
      includeInactive: true,
    });
    if (!resolved?.ok) return resolved;
    const availability = surpriseAvailability(resolved.item, { now: port.now() });
    if (availability.surprise && !availability.available) {
      return unavailableSurprise(resolved.item, availability.reason);
    }
    return await base.redeemShopItem(args);
  }

  return {
    ...base,
    ...challenge,
    listShopItems,
    resolveShopItem,
    redeemShopItem,
  };
}

function unavailableSurprise(item, reason) {
  const name = item?.name || "这个惊喜商品";
  const message = reason === "expired"
    ? `「${name}」已经过期了。`
    : reason === "not_started"
      ? `「${name}」还没到开放时间。`
      : reason === "out_of_stock"
        ? `「${name}」已经被领完了。`
        : `「${name}」当前不可兑换。`;
  return domainError(ERROR_CODES.ITEM_INACTIVE, message, {
    itemId: item?.id || "",
    reason,
  });
}
