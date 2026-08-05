// Who is allowed to call /api/reward-shop, and as whom.
//
// Two callers, two credentials, one authority:
//
//   * Cyberboss (machine-to-machine, no user present) signs the raw body with
//     HMAC-SHA256 — the scheme api/focus-review-sync.js already uses.
//   * The browser (a real signed-in human) sends the Firebase ID token it
//     already holds from the Google popup login. No shared secret is shipped
//     to the client, because a browser cannot keep one.
//
// Both land on the same engine with the same rules. The only thing that
// differs is `actor`, which is recorded on the ledger row so the audit trail
// says where a change came from.
//
// The uid NEVER comes from the request body. For HMAC it is the server's
// configured account; for a token it is the verified `sub` claim, and it must
// match that same configured account — this is a single-user app, so another
// valid Google account is still not allowed in.

export const AUTH_MODES = Object.freeze({ HMAC: "hmac", ID_TOKEN: "id_token" });

// HTTP header names are case-insensitive. Node lowercases them for us, but
// this function is also called from tests and could sit behind a runtime that
// does not, and a header we fail to find looks exactly like a header that was
// never sent — i.e. a valid request silently rejected. So: scan properly.
const header = (headers, name) => {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  let value = headers[wanted] ?? headers[name];
  if (value === undefined) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === wanted) {
        value = headers[key];
        break;
      }
    }
  }
  return Array.isArray(value) ? value[0] : value;
};

export function extractBearerToken(headers) {
  const raw = header(headers, "authorization");
  if (typeof raw !== "string") return "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

/**
 * Decides which credential was presented and whether it is good.
 *
 * Pure apart from the injected `verifyIdToken` / `verifyHmac`, so the whole
 * decision table is unit-testable without HTTP, Firebase or a clock.
 *
 * Returns { ok: true, actor, uid, mode } or
 *         { ok: false, status, error }.
 */
export async function resolveRewardShopCaller({
  headers = {},
  rawBody = "",
  secret = "",
  expectedUid = "",
  verifyIdToken = null,
  verifyHmac = null,
  isTimestampFresh = null,
} = {}) {
  if (!expectedUid) return { ok: false, status: 500, error: "server is not configured (missing CATKEEPER_USER_UID)" };

  const bearer = extractBearerToken(headers);
  const signature = header(headers, "x-catkeeper-signature");

  // A request carrying both is ambiguous about which identity it claims;
  // refuse rather than silently pick the weaker one.
  if (bearer && signature) return { ok: false, status: 400, error: "send either a bearer token or an HMAC signature, not both" };

  if (bearer) {
    if (typeof verifyIdToken !== "function") return { ok: false, status: 500, error: "server is not configured for token auth" };
    let decoded;
    try {
      decoded = await verifyIdToken(bearer);
    } catch (error) {
      return { ok: false, status: 401, error: `invalid or expired id token: ${error?.message || "verification failed"}` };
    }
    const uid = decoded?.uid || decoded?.sub || "";
    if (!uid) return { ok: false, status: 401, error: "id token carries no uid" };
    if (uid !== expectedUid) return { ok: false, status: 403, error: "this account is not allowed to use the reward shop" };
    return { ok: true, mode: AUTH_MODES.ID_TOKEN, actor: "web", uid };
  }

  if (signature) {
    if (!secret) return { ok: false, status: 500, error: "server is not configured (missing reward shop secret)" };
    const timestamp = header(headers, "x-catkeeper-timestamp");
    if (typeof isTimestampFresh === "function" && !isTimestampFresh(timestamp)) {
      return { ok: false, status: 401, error: "timestamp missing or outside the allowed window" };
    }
    if (typeof verifyHmac !== "function" || !verifyHmac({ secret, timestamp, rawBody, signature })) {
      return { ok: false, status: 401, error: "invalid signature" };
    }
    return { ok: true, mode: AUTH_MODES.HMAC, actor: "cyberboss", uid: expectedUid };
  }

  return { ok: false, status: 401, error: "missing credentials: send an Authorization bearer token or an HMAC signature" };
}
