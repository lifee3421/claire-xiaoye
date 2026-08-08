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

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function fallbackHash(text) {
  // Only used on old environments without Web Crypto. Two independent FNV-1a
  // passes make accidental collisions far less likely than the old
  // date+revision key, while all current supported browsers use SHA-256 below.
  const fnv = (seed) => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  return `${fnv(0x811c9dc5)}${fnv(0x9e3779b9)}`;
}

async function hashStableJson(value) {
  const text = stableJson(value);
  if (globalThis.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return fallbackHash(text);
}

/**
 * A settlement's old key was `${date}:${settlementRevision || 0}`. The
 * workbench does not supply settlementRevision, so every revision reused
 * `${date}:0` and the server could replay the first save instead of accepting
 * a real edit. Hash the actual request payload instead:
 *   - an exact retry/double-click gets the same key and is idempotent;
 *   - a genuine review edit gets a different key and reaches the server,
 *     which then applies only the points delta against the stored settlement.
 * Caller-provided keys are deliberately excluded so a stale legacy key cannot
 * poison the fingerprint.
 */
export async function settlementIdempotencyKey(params = {}) {
  const action = params.action || "apply_settlement";
  const { idempotencyKey: _ignored, ...semanticPayload } = params;
  const date = semanticPayload.settlement?.reviewDate || semanticPayload.draft?.date || "unknown";
  const digest = await hashStableJson({ action, payload: semanticPayload });
  return `settlement:${date}:${digest}`;
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
 * Exact retries use a payload-derived idempotency key; real edits get a new
 * key and are settled as a delta against the existing day.
 */
export async function applySettlementPoints(params = {}) {
  const action = params.action || "apply_settlement";
  if (action !== "apply_settlement") return callPoints(action, params);
  const idempotencyKey = await settlementIdempotencyKey(params);
  return callPoints(action, { ...params, idempotencyKey });
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
