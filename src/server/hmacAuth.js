// Shared HMAC request-authentication primitives for every inbound
// Cyberboss/Snow-dust -> claire-xiaoye endpoint (api/focus-review-sync.js,
// api/planner-proposal.js, api/planner-apply.js). Pure, framework-free —
// only `node:crypto` — so it's unit-testable without a real Firestore
// project and safely importable from a Vercel Node function.
//
// Originally lived inline in src/server/focusReviewSyncCore.js; extracted
// here once a second inbound endpoint needed the exact same check, so the
// auth logic has exactly one implementation instead of being copied.
import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

/**
 * Timing-safe HMAC-SHA256 verification of `${timestamp}.${rawBody}`.
 * `rawBody` MUST be the exact raw request body text (not a re-serialized
 * JSON.stringify of the parsed object) — signature verification must happen
 * against the bytes that were actually signed.
 */
export function verifyHmacSignature({ secret, timestamp, rawBody, signature }) {
  if (!secret || !timestamp || !rawBody || !signature) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(String(signature), "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export function isTimestampFresh(timestamp, nowMs = Date.now(), maxSkewMs = MAX_TIMESTAMP_SKEW_MS) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts) <= maxSkewMs;
}
