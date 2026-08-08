import { AUTH_MODES } from "./rewardShopAuth.js";

// Browser capabilities are intentionally explicit. A signed-in browser is the
// real user, so it may manage ordinary shop items and claim earned rewards,
// but it must NOT be able to manufacture Snow's challenges/surprises or touch
// the proactive notification lease/ack channel from DevTools.
export const REWARD_SHOP_WEB_ACTIONS = Object.freeze([
  "get_reward_balance",
  "get_reward_transactions",
  "list_shop_items",
  "list_owned_rewards",
  "create_shop_item",
  "update_shop_item",
  "delete_shop_item",
  "redeem_shop_item",
  "use_reward",
  "resolve_shop_item",
  "list_reward_challenges",
  "get_reward_challenge_progress",
  "claim_reward_challenge",
  "list_surprise_drops",
]);

const WEB_ACTION_SET = new Set(REWARD_SHOP_WEB_ACTIONS);

export function canCallRewardShopAction(caller, action) {
  if (caller?.mode === AUTH_MODES.HMAC) return true;
  if (caller?.mode === AUTH_MODES.ID_TOKEN) return WEB_ACTION_SET.has(String(action || ""));
  return false;
}
