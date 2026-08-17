import test from "node:test";
import assert from "node:assert/strict";
import { createNativePlannerAuthHandoff, NativePlannerAuthState } from "./auth/nativePlannerAuthHandoff.js";

function fakeWindow() {
  const listeners = new Map();
  let requestCount = 0;
  let lastNonce = null;
  const windowRef = {
    location: { protocol: "https:", pathname: "/today", origin: "https://claire-xiaoye.vercel.app" },
    crypto: { getRandomValues(values) { values.set([1, 2, 3, 4]); return values; } },
    SnowDustPlannerAuth: {
      requestLogin(nonce) { requestCount += 1; lastNonce = nonce; },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    dispatchMessage(data) { return listeners.get("message")?.({ origin: windowRef.location.origin, data }); },
    get requestCount() { return requestCount; },
    get lastNonce() { return lastNonce; },
  };
  return windowRef;
}

test("native planner auth can retry after native failure", async () => {
  const windowRef = fakeWindow();
  const states = [];
  const handoff = createNativePlannerAuthHandoff({ windowRef, onCredential: async () => {}, onStateChange: (state) => states.push(state) });
  handoff.start();
  assert.equal(handoff.requestLogin(), true);
  const firstNonce = windowRef.lastNonce;
  await windowRef.dispatchMessage({ type: "snowdust.planner.auth-error.v1", nonce: firstNonce });
  assert.equal(handoff.getState(), NativePlannerAuthState.FAILED);
  assert.equal(handoff.requestLogin(), true);
  assert.equal(windowRef.requestCount, 2);
  assert.equal(handoff.getState(), NativePlannerAuthState.LOGIN_REQUESTED);
  handoff.stop();
});

test("native planner auth consumes one matching ID token", async () => {
  const windowRef = fakeWindow();
  const tokens = [];
  const handoff = createNativePlannerAuthHandoff({ windowRef, onCredential: async (token) => tokens.push(token) });
  handoff.start();
  handoff.requestLogin();
  const nonce = windowRef.lastNonce;
  await windowRef.dispatchMessage({ type: "snowdust.planner.google-id-token.v1", nonce, idToken: "id-token" });
  assert.deepEqual(tokens, ["id-token"]);
  assert.equal(handoff.getState(), NativePlannerAuthState.CONSUMED);
  await windowRef.dispatchMessage({ type: "snowdust.planner.google-id-token.v1", nonce, idToken: "replay" });
  assert.deepEqual(tokens, ["id-token"]);
  handoff.stop();
});
