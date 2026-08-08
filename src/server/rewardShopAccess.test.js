import test from "node:test";
import assert from "node:assert/strict";
import { AUTH_MODES } from "./rewardShopAuth.js";
import { REWARD_SHOP_WEB_ACTIONS, canCallRewardShopAction } from "./rewardShopAccess.js";

test("signed-in web may inspect surprises and claim completed challenges", () => {
  const caller = { mode: AUTH_MODES.ID_TOKEN, actor: "web" };
  for (const action of ["list_surprise_drops", "list_reward_challenges", "get_reward_challenge_progress", "claim_reward_challenge"]) {
    assert.equal(canCallRewardShopAction(caller, action), true, action);
  }
});

test("signed-in web cannot manufacture surprises/challenges or operate the notification outbox", () => {
  const caller = { mode: AUTH_MODES.ID_TOKEN, actor: "web" };
  for (const action of [
    "create_reward_challenge",
    "publish_surprise_drop",
    "create_surprise_reward_challenge",
    "lease_reward_notification",
    "ack_reward_notification",
  ]) {
    assert.equal(canCallRewardShopAction(caller, action), false, action);
    assert.equal(REWARD_SHOP_WEB_ACTIONS.includes(action), false, action);
  }
});

test("trusted HMAC caller may use the internal automation actions", () => {
  const caller = { mode: AUTH_MODES.HMAC, actor: "cyberboss" };
  for (const action of [
    "create_reward_challenge",
    "publish_surprise_drop",
    "create_surprise_reward_challenge",
    "lease_reward_notification",
    "ack_reward_notification",
  ]) {
    assert.equal(canCallRewardShopAction(caller, action), true, action);
  }
});

test("unknown or unauthenticated caller gets no capabilities", () => {
  assert.equal(canCallRewardShopAction(null, "list_shop_items"), false);
  assert.equal(canCallRewardShopAction({ mode: "unknown" }, "list_shop_items"), false);
  assert.equal(canCallRewardShopAction({ mode: AUTH_MODES.ID_TOKEN }, "drop_database"), false);
});
