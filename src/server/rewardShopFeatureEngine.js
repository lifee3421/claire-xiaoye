import { createRewardShopEngine } from "./rewardShopEngine.js";
import { createRewardChallengeEngine } from "./rewardChallengeEngine.js";

/**
 * Transitional composition root for reward-shop v2 features.
 *
 * Existing points/shop/reward methods remain byte-for-byte in
 * rewardShopEngine.js. Challenge/surprise behavior is layered beside them so
 * this feature does not fork or rewrite the proven redemption code path.
 */
export function createRewardShopFeatureEngine(port, options = {}) {
  return {
    ...createRewardShopEngine(port, options),
    ...createRewardChallengeEngine(port, options),
  };
}
