// The browser's only way to CHANGE anything in the reward shop.
//
// Reads stay where they were — the Mall page still uses its live onSnapshot
// subscriptions, which is what makes the UI feel instant. Writes go here, to
// /api/reward-shop, which verifies the Firebase ID token and then runs the
// exact same src/server/rewardShopEngine.js under the Admin SDK that WeChat
// goes through. There is still only one implementation of "deduct points".
//
// Why a token and not a shared secret: the browser cannot keep a secret. The
// ID token is already in memory from the Google popup login, it is short
// lived, it is bound to this user, and the server can verify it without ever
// trusting anything the page says about who it is.

import { auth } from "./firebase";

const ENDPOINT = "/api/reward-shop";

export class RewardShopApiError extends Error {
  constructor(message, { code = "", status = 0, result = null } = {}) {
    super(message);
    this.name = "RewardShopApiError";
    this.code = code;
    this.status = status;
    this.result = result;
  }
}

async function currentIdToken() {
  const user = auth?.currentUser;
  if (!user) throw new RewardShopApiError("登录状态已失效，请重新登录后再试。", { code: "unauthenticated" });
  // Not forced: the SDK refreshes on its own when the token is close to
  // expiry, and forcing a round trip on every click would make redeeming
  // noticeably slower.
  return await user.getIdToken();
}

/**
 * Calls one allow-listed server action.
 *
 * Business refusals ("积分不够") come back as a structured result with
 * ok:false and a code — they are thrown as RewardShopApiError so existing
 * callers that expect a throw keep working, but the code is preserved so a
 * caller can tell "you cannot do that" apart from "the call broke".
 */
export async function callRewardShop(action, payload = {}) {
  const token = await currentIdToken();

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, payload }),
    });
  } catch (error) {
    // The request may or may not have reached the server. Callers that pass a
    // stable idempotencyKey can safely retry; that is exactly what the key is
    // for, so the outcome is reported as unknown rather than as a failure.
    throw new RewardShopApiError("网络没连上，这一步的结果还不确定，稍后用同一个操作重试即可。", {
      code: "outcome_unknown",
      result: { ok: false, code: "outcome_unknown", cause: error?.message || "" },
    });
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok || !result?.ok) {
    throw new RewardShopApiError(result?.message || result?.error || "操作没有成功，请稍后再试。", {
      code: result?.code || "",
      status: response.status,
      result,
    });
  }
  return result;
}
