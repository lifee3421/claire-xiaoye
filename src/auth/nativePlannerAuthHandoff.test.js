import assert from "node:assert/strict";
import test from "node:test";
import { createNativePlannerAuthHandoff, NativePlannerAuthState } from "./nativePlannerAuthHandoff.js";

function fakeWindow() {
  const listeners = new Set();
  const calls = [];
  return {
    location: { protocol: "https:", origin: "https://planner.test", pathname: "/today" },
    crypto: { getRandomValues(values) { values.fill(7); return values; } },
    SnowDustPlannerAuth: {
      requestLogin(nonce) { calls.push(["request", nonce]); },
      notifyLogout() { calls.push(["logout"]); },
    },
    calls,
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); },
    async emit(payload, origin = "https://planner.test") { await Promise.all([...listeners].map((listener) => listener({ data: payload, origin }))); },
  };
}

test("native credential is consumed once and replay is rejected", async () => {
  const windowRef = fakeWindow();
  const received = [];
  const handoff = createNativePlannerAuthHandoff({ windowRef, onCredential: async (token) => received.push(token) });
  handoff.start();
  assert.equal(handoff.requestLogin(), true);
  const nonce = windowRef.calls[0][1];
  await windowRef.emit({ type: "snowdust.planner.google-id-token.v1", nonce, idToken: "one-shot" });
  await windowRef.emit({ type: "snowdust.planner.google-id-token.v1", nonce, idToken: "replay" });
  assert.deepEqual(received, ["one-shot"]);
  assert.equal(handoff.getState(), NativePlannerAuthState.CONSUMED);
});

test("wrong origin, wrong route, and malformed credentials fail closed", async () => {
  const windowRef = fakeWindow();
  const received = [];
  const handoff = createNativePlannerAuthHandoff({ windowRef, onCredential: async (token) => received.push(token) });
  handoff.start();
  assert.equal(handoff.requestLogin(), true);
  const nonce = windowRef.calls[0][1];
  await windowRef.emit({ type: "snowdust.planner.google-id-token.v1", nonce, idToken: "wrong-origin" }, "https://other.test");
  await windowRef.emit({ type: "snowdust.planner.google-id-token.v1", nonce, idToken: "" });
  assert.deepEqual(received, []);
  windowRef.location.pathname = "/not-today";
  assert.equal(createNativePlannerAuthHandoff({ windowRef }).requestLogin(), false);
});

test("logout clears pending native state without silently requesting another credential", () => {
  const windowRef = fakeWindow();
  const handoff = createNativePlannerAuthHandoff({ windowRef, onCredential: async () => {} });
  handoff.start();
  handoff.requestLogin();
  handoff.notifyLogout();
  assert.equal(handoff.getState(), NativePlannerAuthState.IDLE);
  assert.deepEqual(windowRef.calls.map((call) => call[0]), ["request", "logout"]);
});

test("native credential failure changes state without exposing a credential", async () => {
  const windowRef = fakeWindow();
  const handoff = createNativePlannerAuthHandoff({ windowRef, onCredential: async () => assert.fail("must not receive") });
  handoff.start();
  handoff.requestLogin();
  await windowRef.emit({ type: "snowdust.planner.auth-error.v1", nonce: windowRef.calls[0][1] });
  assert.equal(handoff.getState(), NativePlannerAuthState.FAILED);
});
