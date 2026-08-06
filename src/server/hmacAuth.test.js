import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { isTimestampFresh, verifyHmacSignature } from "./hmacAuth.js";

function sign(secret, timestamp, rawBody) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

test("verifyHmacSignature accepts a correctly signed request", () => {
  const secret = "s3cret";
  const timestamp = "1000";
  const rawBody = '{"a":1}';
  const signature = sign(secret, timestamp, rawBody);
  assert.equal(verifyHmacSignature({ secret, timestamp, rawBody, signature }), true);
});

test("verifyHmacSignature rejects a wrong signature and missing fields", () => {
  const secret = "s3cret";
  const timestamp = "1000";
  const rawBody = '{"a":1}';
  assert.equal(verifyHmacSignature({ secret, timestamp, rawBody, signature: "deadbeef" }), false);
  assert.equal(verifyHmacSignature({ secret: "", timestamp, rawBody, signature: sign(secret, timestamp, rawBody) }), false);
  assert.equal(verifyHmacSignature({ secret, timestamp: "", rawBody, signature: sign(secret, timestamp, rawBody) }), false);
});

test("isTimestampFresh accepts within the skew window and rejects outside it", () => {
  const now = 1_000_000;
  assert.equal(isTimestampFresh(String(now - 60_000), now), true);
  assert.equal(isTimestampFresh(String(now - 6 * 60_000), now), false);
  assert.equal(isTimestampFresh("not-a-number", now), false);
});
