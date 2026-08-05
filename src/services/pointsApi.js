// Browser-side client for the server-authoritative points API.
//
// This is the ONLY way the browser changes points. No more direct
// batch.set / batch.update / transaction.set of users/{uid}.points.
//
// Every call sends the Firebase ID token (already available from login),
// so the server can verify the caller's identity.

let _idTokenProvider = null;
let _apiBaseUrl = null;

/**
 * Must be called once after Firebase Auth initializes.
 * @param {() => Promise<string>} getToken - returns the current Firebase ID token
 */
export function bindPointsApiIdToken(getToken) {
  _idTokenProvider = getToken;
}

/**
 * For testing: override the API base URL. Call with `null` to reset.
 */
export function bindPointsApiBaseUrl(url) {
  _apiBaseUrl = url;
}

function apiBase() {
  if (_apiBaseUrl) return _apiBaseUrl;
  if (typeof process !== "undefined" && process.env?.__POINTS_API_BASE) return process.env.__POINTS_API_BASE;
  return typeof window !== "undefined" ? window.location.origin : "";
}

async function callPoints(action, payload = {}) {
  if (!_idTokenProvider) {
    console.warn("[pointsApi] ID token provider not bound — will try without auth");
  }
  const token = _idTokenProvider ? await _idTokenProvider() : null;
  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  // Timestamp for HMAC-replay protection (not used by browser but the header
  // is expected by the server for the token-only path)
  headers["x-catkeeper-timestamp"] = String(Math.floor(Date.now() / 1000));

  const body = JSON.stringify({ action, payload });
  const resp = await fetch(`${apiBase()}/api/points`, {
    method: "POST",
    headers,
    body,
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) {
    throw Object.assign(new Error(json.error || `points/${action} failed`), {
      code: json.code || "unknown",
      status: resp.status,
      ...json,
    });
  }
  return json;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Earn points (schedule segment goal, etc.)
 * Returns { ok: true, balanceBefore, balanceAfter, delta }
 */
export async function earnPoints({ amount = 1, source = "schedule_segment_goal", description = "", relatedEntityId = null, idempotencyKey = "", ...rest } = {}) {
  return callPoints("earn_schedule_goal", { amount, source, description, relatedEntityId, idempotencyKey, ...rest });
}

/**
 * Spend points (entertainment extension, etc.)
 * Returns { ok: true, balanceBefore, balanceAfter, delta }
 */
export async function spendPoints({ amount = 0, source = "entertainment_extension", description = "", relatedEntityId = null, idempotencyKey = "", ...rest } = {}) {
  return callPoints("spend_entertainment", { pointsSpent: amount, source, description, relatedEntityId, idempotencyKey, ...rest });
}

/**
 * Apply a settlement (daily review). This is the dedicated workbench path —
 * the server runs the same buildSettlementProfilePatch logic in a transaction.
 * @param {{ settlement, draft, previousSettlement?, idempotencyKey? }} params
 * Returns { ok: true, balanceBefore, balanceAfter, delta, settlementRevision }
 */
export async function applySettlementPoints(params = {}) {
  return callPoints(params.action || "apply_settlement", params);
}

/**
 * Apply a project reward.
 * Returns { ok: true, balanceBefore, balanceAfter, delta }
 */
export async function projectRewardPoints({ finalPoints = 0, existingFinalPoints = 0, description = "", relatedEntityId = null, idempotencyKey = "" } = {}) {
  return callPoints("project_reward", { finalPoints, existingFinalPoints, description, relatedEntityId, idempotencyKey });
}

/**
 * Rollback a settlement deletion.
 * Returns { ok: true, balanceBefore, balanceAfter, delta }
 */
export async function rollbackSettlementPoints({ pointsToRemove = 0, description = "", idempotencyKey = "", ...rest } = {}) {
  return callPoints("rollback_settlement", { pointsToRemove, description, idempotencyKey, ...rest });
}

/**
 * Rollback a redemption deletion.
 * Returns { ok: true, balanceBefore, balanceAfter, delta }
 */
export async function rollbackRedemptionPoints({ priceToRefund = 0, description = "", idempotencyKey = "", ...rest } = {}) {
  return callPoints("rollback_redemption", { priceToRefund, description, idempotencyKey, ...rest });
}
