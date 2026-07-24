import test from "node:test";
import assert from "node:assert/strict";

// A real runtime module-load check: firebase-admin was previously only
// referenced by import statements and never actually verified to be an
// installed, resolvable production dependency (package.json alone doesn't
// guarantee `npm install`/`npm ci` actually pulled it in, or that Vercel's
// Node runtime can resolve it). This test dynamically imports the real
// handler module — if firebase-admin (or any other import here) were
// missing, this import itself throws MODULE_NOT_FOUND before the test body
// even runs. Deliberately does NOT call the handler (that needs real
// Firestore credentials) — this only proves the module graph resolves.
test("api/focus-review-sync.js and its firebase-admin imports load without MODULE_NOT_FOUND", async () => {
  const mod = await import("./focus-review-sync.js");
  assert.equal(typeof mod.default, "function", "the handler must be the default export");
  assert.deepEqual(mod.config, { api: { bodyParser: false } });
});

test("firebase-admin/app and firebase-admin/firestore resolve directly (the exact subpath imports the handler uses)", async () => {
  const appMod = await import("firebase-admin/app");
  const firestoreMod = await import("firebase-admin/firestore");
  assert.equal(typeof appMod.initializeApp, "function");
  assert.equal(typeof appMod.cert, "function");
  assert.equal(typeof appMod.getApps, "function");
  assert.equal(typeof firestoreMod.getFirestore, "function");
});
