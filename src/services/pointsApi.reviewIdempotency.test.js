import test from "node:test";
import assert from "node:assert/strict";
import {
  applySettlementPoints,
  bindPointsApiBaseUrl,
  bindPointsApiIdToken,
  settlementIdempotencyKey,
} from "./pointsApi.js";

function reviewPayload(value = 30) {
  return {
    settlement: {
      reviewDate: "2026-08-08",
      pointsAdded: 8,
      structuredReview: { fields: { "family.contact.grandmother.duration": { value } } },
    },
    draft: {
      date: "2026-08-08",
      fields: { "family.contact.grandmother.duration": { value, manuallyEdited: true } },
    },
    idempotencyKey: "legacy-stale-key-that-must-not-win",
  };
}

test("same semantic settlement payload gets the same key regardless of legacy caller key", async () => {
  const a = reviewPayload(30);
  const b = { ...reviewPayload(30), idempotencyKey: "another-stale-key" };
  assert.equal(await settlementIdempotencyKey(a), await settlementIdempotencyKey(b));
});

test("a real review edit gets a different settlement idempotency key", async () => {
  assert.notEqual(
    await settlementIdempotencyKey(reviewPayload(30)),
    await settlementIdempotencyKey(reviewPayload(45)),
  );
});

test("applySettlementPoints sends the payload-derived key instead of the stale date:revision key", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  bindPointsApiBaseUrl("https://example.test");
  bindPointsApiIdToken(async () => "test-token");
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ ok: true, delta: 0 }) };
  };

  try {
    const params = reviewPayload(30);
    const expected = await settlementIdempotencyKey(params);
    await applySettlementPoints(params);
    assert.equal(sentBody.action, "apply_settlement");
    assert.equal(sentBody.payload.idempotencyKey, expected);
    assert.notEqual(sentBody.payload.idempotencyKey, params.idempotencyKey);
  } finally {
    globalThis.fetch = originalFetch;
    bindPointsApiBaseUrl(null);
    bindPointsApiIdToken(null);
  }
});
