// The full decision table for "who may call /api/reward-shop, and as whom".
//
// resolveRewardShopCaller takes its crypto and its clock as arguments, so the
// entire door can be tested without HTTP, Firebase or a real signature. The
// real verifier (verifyHmacSignature from focusReviewSyncCore.js) is used
// where the point of the test is that a genuine signature passes.

import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

import { AUTH_MODES, extractBearerToken, resolveRewardShopCaller } from "./rewardShopAuth.js";
import { verifyHmacSignature, isTimestampFresh } from "./focusReviewSyncCore.js";

const UID = "claire-uid";
const SECRET = "test-secret";
const BODY = JSON.stringify({ action: "get_balance", payload: {} });

const sign = (rawBody, timestamp, secret = SECRET) =>
  createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

// A stand-in for firebase-admin's verifyIdToken: "good-token" belongs to
// Claire, "other-token" to some other perfectly valid Google account.
async function fakeVerifyIdToken(token) {
  if (token === "good-token") return { uid: UID, email: "claire@example.test" };
  if (token === "other-token") return { uid: "someone-else", email: "stranger@example.test" };
  if (token === "sub-only-token") return { sub: UID };
  if (token === "anonymous-token") return { email: "nobody@example.test" };
  throw new Error("Firebase ID token has expired");
}

const call = (overrides = {}) =>
  resolveRewardShopCaller({
    rawBody: BODY,
    secret: SECRET,
    expectedUid: UID,
    verifyIdToken: fakeVerifyIdToken,
    verifyHmac: verifyHmacSignature,
    isTimestampFresh,
    ...overrides,
  });

// --- header parsing ---------------------------------------------------------

test("extractBearerToken: accepts the standard header and ignores everything else", () => {
  assert.equal(extractBearerToken({ authorization: "Bearer abc.def.ghi" }), "abc.def.ghi");
  assert.equal(extractBearerToken({ Authorization: "bearer abc" }), "abc", "the scheme is case-insensitive");
  assert.equal(extractBearerToken({ authorization: "Basic abc" }), "", "another scheme is not a bearer token");
  assert.equal(extractBearerToken({}), "");
  assert.equal(extractBearerToken({ authorization: ["Bearer first", "Bearer second"] }), "first", "a repeated header takes the first value");
});

// --- browser: Firebase ID token --------------------------------------------

test("a valid id token for the configured account is admitted as the web actor", async () => {
  const result = await call({ headers: { authorization: "Bearer good-token" } });
  assert.deepEqual(result, { ok: true, mode: AUTH_MODES.ID_TOKEN, actor: "web", uid: UID });
});

test("a token that only carries `sub` still resolves to the same uid", async () => {
  const result = await call({ headers: { authorization: "Bearer sub-only-token" } });
  assert.equal(result.ok, true);
  assert.equal(result.uid, UID);
});

test("another perfectly valid Google account is still refused — this is a single-user app", async () => {
  const result = await call({ headers: { authorization: "Bearer other-token" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403, "authenticated but not authorised");
});

test("an expired or forged token is a 401, and the reason is not swallowed", async () => {
  const result = await call({ headers: { authorization: "Bearer garbage" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(result.error, /expired/);
});

test("a token with no uid claim at all is refused", async () => {
  const result = await call({ headers: { authorization: "Bearer anonymous-token" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("the uid NEVER comes from the request body", async () => {
  const rawBody = JSON.stringify({ action: "get_balance", uid: "attacker-uid", payload: { uid: "attacker-uid" } });
  const result = await call({ rawBody, headers: { authorization: "Bearer good-token" } });
  assert.equal(result.uid, UID, "the body may say anything; only the verified claim counts");
});

// --- Cyberboss: HMAC --------------------------------------------------------

test("a correctly signed request is admitted as the cyberboss actor", async () => {
  const timestamp = String(Date.now());
  const result = await call({
    headers: { "x-catkeeper-signature": sign(BODY, timestamp), "x-catkeeper-timestamp": timestamp },
  });
  assert.deepEqual(result, { ok: true, mode: AUTH_MODES.HMAC, actor: "cyberboss", uid: UID });
});

test("a signature computed over a different body does not open the door", async () => {
  const timestamp = String(Date.now());
  const result = await call({
    rawBody: JSON.stringify({ action: "redeem_shop_item", payload: { itemId: "expensive" } }),
    headers: { "x-catkeeper-signature": sign(BODY, timestamp), "x-catkeeper-timestamp": timestamp },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(result.error, /signature/);
});

test("a replayed request from six minutes ago is outside the window", async () => {
  const stale = String(Date.now() - 6 * 60 * 1000);
  const result = await call({
    headers: { "x-catkeeper-signature": sign(BODY, stale), "x-catkeeper-timestamp": stale },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(result.error, /timestamp/);
});

test("a signature with no timestamp is refused before the HMAC is even checked", async () => {
  let hmacCalled = false;
  const result = await call({
    headers: { "x-catkeeper-signature": "deadbeef" },
    verifyHmac: () => {
      hmacCalled = true;
      return true;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(hmacCalled, false);
});

test("a signature signed with the wrong secret is refused", async () => {
  const timestamp = String(Date.now());
  const result = await call({
    headers: { "x-catkeeper-signature": sign(BODY, timestamp, "wrong-secret"), "x-catkeeper-timestamp": timestamp },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

// --- refusals ---------------------------------------------------------------

test("presenting both credentials at once is ambiguous and refused", async () => {
  const timestamp = String(Date.now());
  const result = await call({
    headers: {
      authorization: "Bearer good-token",
      "x-catkeeper-signature": sign(BODY, timestamp),
      "x-catkeeper-timestamp": timestamp,
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400, "refuse rather than silently picking one identity over the other");
});

test("no credentials at all is a 401, not an anonymous read", async () => {
  const result = await call({ headers: {} });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(result.error, /missing credentials/);
});

test("a misconfigured server fails closed rather than guessing a uid", async () => {
  const result = await call({ expectedUid: "", headers: { authorization: "Bearer good-token" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.match(result.error, /CATKEEPER_USER_UID/);
});

test("a missing shop secret fails closed on the HMAC path", async () => {
  const timestamp = String(Date.now());
  const result = await call({
    secret: "",
    headers: { "x-catkeeper-signature": sign(BODY, timestamp), "x-catkeeper-timestamp": timestamp },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test("a deployment without token verification wired up refuses tokens instead of trusting them", async () => {
  const result = await call({ verifyIdToken: null, headers: { authorization: "Bearer good-token" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test("calling with no arguments at all is refused", async () => {
  const result = await resolveRewardShopCaller();
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});
