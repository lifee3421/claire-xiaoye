// Shared identity/typing primitives for the unified tracker fact layer:
// deterministic CompletionEvent ids (never raw, unencoded field paths as a
// Firestore document id) and a single normalizeRevision() so
// settlementRevision / job.settlementRevision / CompletionEvent.sourceRevision
// are ALWAYS compared as numbers — never a silent number-vs-string mismatch
// (e.g. `"10" > "2"` is false as strings, true as numbers).

// SHA-256 (full 256 bits — Firestore's 1500-byte doc-id limit gives no
// reason to truncate). This id is a PERMANENT document identity, unlike the
// 32-bit FNV-1a change-detection hash still used for inputRevision markers
// elsewhere (e.g. buildSnowDustCommentaryPayload.js) — a birthday-bound
// collision there just re-triggers a regeneration; here it would silently
// merge two unrelated CompletionEvents forever. SHA-256 makes that
// practically impossible, and the write path additionally asserts identity
// field equality before trusting an id match (see
// trackerReconcilePlanner.js's applyRevisionGuard), so even a theoretical
// collision fails loudly instead of silently overwriting.
//
// Uses Web Crypto (`crypto.subtle`), available as a global in both the
// browser (where this module ships and runs) and modern Node (this repo's
// test runner) — unlike Node's `crypto.createHash`, which has no browser
// equivalent.
async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds the CompletionEvent document id. The four identity fields are
 * still stored verbatim in the document body (trackerId/sourceDocumentId/
 * sourceFieldKey/sourceType) for audit — only the Firestore doc id itself is
 * a hash, so an unencoded field path (which could contain characters
 * Firestore doc ids reject, like "/") never ends up as a path segment.
 *
 * Async because SHA-256 here goes through Web Crypto's subtle.digest, which
 * has no synchronous form in the browser.
 */
export async function buildCompletionEventId(trackerId, sourceDocumentId, sourceFieldKey, sourceType) {
  // Length-prefixing each field before joining removes the ambiguity a plain
  // separator would leave — without it, ("a", "b|c") and ("a|b", "c") could
  // hash identically even though they're different identity tuples.
  const parts = [trackerId, sourceDocumentId, sourceFieldKey, sourceType].map((value) => String(value));
  const encoded = parts.map((value) => `${value.length}:${value}`).join("|");
  return sha256Hex(encoded);
}

/**
 * Normalizes a revision value to a non-negative integer number.
 * - Missing/null/undefined -> `fallback` (a genuinely absent field on an old
 *   document is a legitimate baseline case, not corrupt data).
 * - A numeric string ("2") is coerced to a number (2) for legacy documents
 *   written before this file existed.
 * - Anything else that isn't a finite non-negative integer (NaN, "abc", -1,
 *   1.5) THROWS — it must never silently enter a numeric comparison as 0 or
 *   NaN, which is exactly the class of bug that lets a stale write win.
 */
export function normalizeRevision(value, fallback = 0) {
  if (value == null) return fallback;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`invalid settlementRevision: ${JSON.stringify(value)}`);
  }
  return numeric;
}

/**
 * Throws if `fresh` (an existing CompletionEvent document already on file at
 * `event.id`) has different identity fields than `event` — i.e. the SHA-256
 * id collided across two genuinely different (trackerId, sourceDocumentId,
 * sourceFieldKey, sourceType) tuples. This should be practically
 * unreachable, but an id match must never be trusted as identity proof
 * without checking — silently overwriting `fresh` in that case would merge
 * two unrelated CompletionEvents under one document forever.
 */
const IDENTITY_FIELDS = ["trackerId", "sourceDocumentId", "sourceFieldKey", "sourceType"];

// Sanitizes a Tracker config array right before it's handed to Firestore:
// the JSON round-trip strips any `undefined` value a caller left on a
// nested object (e.g. an unset stickerSettings.emoji) — Firestore rejects
// `undefined` field values outright on write, so this must happen before
// the write is attempted, not be discovered as a runtime error at save
// time. Non-array input normalizes to an empty array rather than throwing,
// matching every other array-shaped profile field's save-time behavior.
export function normalizeTrackersForStorage(trackers) {
  return Array.isArray(trackers) ? JSON.parse(JSON.stringify(trackers)) : [];
}

export function assertNoCompletionEventIdCollision(event, fresh) {
  if (!fresh) return;
  const mismatched = IDENTITY_FIELDS.filter((field) => String(fresh[field]) !== String(event[field]));
  if (!mismatched.length) return;
  const pick = (source) => Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, source[field]]));
  throw new Error(
    `CompletionEvent id collision at ${event.id}: identity fields differ (${mismatched.join(", ")}) — refusing to overwrite. `
    + `existing=${JSON.stringify(pick(fresh))} incoming=${JSON.stringify(pick(event))}`,
  );
}
