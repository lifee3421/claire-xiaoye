import test from "node:test";
import assert from "node:assert/strict";

// See api/focus-review-sync.load.test.js for why this exists: a real
// runtime module-load check, not just a package.json listing check.
// Deliberately does NOT call the handler (that needs real Firestore
// credentials) — this only proves the module graph resolves.
test("api/exercise-record-sync.js and its firebase-admin imports load without MODULE_NOT_FOUND", async () => {
  const mod = await import("./exercise-record-sync.js");
  assert.equal(typeof mod.default, "function", "the handler must be the default export");
  assert.deepEqual(mod.config, { api: { bodyParser: false } });
});
